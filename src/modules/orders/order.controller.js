const { validationResult } = require('express-validator');
const MenuItem = require('../menuItems/menuItem.model');
const Order = require('./order.model');
const { redisClient } = require('../../../config/redis');
const { kafkaProducer } = require('../../../config/kafka');
const { emitNewOrder, emitOrderReady, emitOrderPaid } = require('../../sockets/socketManager');

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getCurrentWeekString() {
  const currentDate = new Date();
  const startOfCurrentYear = new Date(currentDate.getFullYear(), 0, 1);
  const weekNumber = Math.ceil(
    ((currentDate - startOfCurrentYear) / 86400000 + startOfCurrentYear.getDay() + 1) / 7
  );
  return `${currentDate.getFullYear()}-${String(weekNumber).padStart(2, '0')}`;
}

function getCurrentMonthString() {
  const currentDate = new Date();
  return `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
}

async function createOrder(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const { items: requestedOrderItems } = httpRequest.body;

    const requestedMenuItemIdentifiers = requestedOrderItems.map(
      (requestedItem) => requestedItem.menuItemId
    );

    const fetchedMenuItems = await MenuItem.find({
      _id: { $in: requestedMenuItemIdentifiers },
      tenantId: httpRequest.tenantId
    });

    if (fetchedMenuItems.length !== requestedMenuItemIdentifiers.length) {
      return httpResponse.status(400).json({
        message: 'One or more menu items were not found in this restaurant'
      });
    }

    const unavailableMenuItems = fetchedMenuItems.filter((menuItem) => !menuItem.isAvailable);
    if (unavailableMenuItems.length > 0) {
      const unavailableItemNames = unavailableMenuItems.map((menuItem) => menuItem.name).join(', ');
      return httpResponse.status(400).json({
        message: `The following menu items are currently unavailable: ${unavailableItemNames}`
      });
    }

    // Build a lookup map to match fetched items back to requested quantities
    const menuItemLookupMap = new Map(
      fetchedMenuItems.map((menuItem) => [menuItem._id.toString(), menuItem])
    );

    // Snapshot name, price, category from DB — do not trust values from req.body
    const snapshotOrderItems = requestedOrderItems.map((requestedItem) => {
      const matchedMenuItem = menuItemLookupMap.get(requestedItem.menuItemId.toString());
      return {
        menuItemId: matchedMenuItem._id,
        name: matchedMenuItem.name,
        price: matchedMenuItem.price,
        category: matchedMenuItem.category,
        quantity: requestedItem.quantity
      };
    });

    const computedTotalAmount = snapshotOrderItems.reduce(
      (runningTotal, orderItem) => runningTotal + orderItem.price * orderItem.quantity,
      0
    );

    const todayDateString = getTodayDateString();
    const dailyOrderNumberKey = `ordernum:daily:${httpRequest.tenantId}:${todayDateString}`;
    const newOrderSequenceNumber = await redisClient.incr(dailyOrderNumberKey);

    // Set 25-hour TTL on first creation (not reset on subsequent increments)
    if (newOrderSequenceNumber === 1) {
      await redisClient.expire(dailyOrderNumberKey, 25 * 60 * 60);
    }

    const savedOrder = await new Order({
      tenantId: httpRequest.tenantId,
      orderNumber: newOrderSequenceNumber,
      items: snapshotOrderItems,
      totalAmount: computedTotalAmount,
      status: 'Received',
      cashierId: httpRequest.user._id
    }).save();

    emitNewOrder(httpRequest.tenantId.toString(), savedOrder);

    return httpResponse.status(201).json({ order: savedOrder });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function listActiveOrders(httpRequest, httpResponse, nextMiddleware) {
  try {
    const activeOrders = await Order.find({
      tenantId: httpRequest.tenantId,
      status: { $in: ['Received', 'Preparing', 'Ready'] }
    }).sort({ createdAt: 1 }); // oldest first for kitchen processing sequence

    return httpResponse.status(200).json({ orders: activeOrders });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function listOrderHistory(httpRequest, httpResponse, nextMiddleware) {
  try {
    const pageNumber = parseInt(httpRequest.query.page, 10) || 1;
    const pageLimit = parseInt(httpRequest.query.limit, 10) || 20;

    const dateRangeFilter = {};
    if (httpRequest.query.from) {
      dateRangeFilter.$gte = new Date(httpRequest.query.from);
    }
    if (httpRequest.query.to) {
      dateRangeFilter.$lte = new Date(httpRequest.query.to);
    }

    const orderQueryFilter = { tenantId: httpRequest.tenantId };
    if (Object.keys(dateRangeFilter).length > 0) {
      orderQueryFilter.createdAt = dateRangeFilter;
    }

    const [foundOrders, totalOrderCount] = await Promise.all([
      Order.find(orderQueryFilter)
        .sort({ createdAt: -1 })
        .skip((pageNumber - 1) * pageLimit)
        .limit(pageLimit),
      Order.countDocuments(orderQueryFilter)
    ]);

    return httpResponse.status(200).json({
      orders: foundOrders,
      page: pageNumber,
      limit: pageLimit,
      total: totalOrderCount
    });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function updateOrderStatus(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const targetOrderIdentifier = httpRequest.params.id;
    const { status: requestedNewStatus } = httpRequest.body;

    const foundOrder = await Order.findOne({
      _id: targetOrderIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundOrder) {
      return httpResponse.status(404).json({ message: 'Order not found' });
    }

    // Enforce the strict state machine
    const validTransitions = { Received: 'Preparing', Preparing: 'Ready' };
    if (validTransitions[foundOrder.status] !== requestedNewStatus) {
      return httpResponse.status(400).json({
        message: `Cannot transition order status from '${foundOrder.status}' to '${requestedNewStatus}'`
      });
    }

    // Assign the chef on their first interaction with the order
    if (!foundOrder.chefId) {
      foundOrder.chefId = httpRequest.user._id;
    }

    foundOrder.status = requestedNewStatus;
    const savedOrder = await foundOrder.save();

    if (requestedNewStatus === 'Ready') {
      emitOrderReady(httpRequest.tenantId.toString(), savedOrder);
    }

    return httpResponse.status(200).json({ order: savedOrder });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function payOrder(httpRequest, httpResponse, nextMiddleware) {
  try {
    const targetOrderIdentifier = httpRequest.params.id;

    const foundOrder = await Order.findOne({
      _id: targetOrderIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundOrder) {
      return httpResponse.status(404).json({ message: 'Order not found' });
    }

    if (foundOrder.status !== 'Ready') {
      return httpResponse.status(400).json({
        message: 'Only orders with status Ready can be marked as paid'
      });
    }

    foundOrder.status = 'Paid';
    const savedOrder = await foundOrder.save();

    const todayDateString = getTodayDateString();
    const tenantIdentifierString = httpRequest.tenantId.toString();
    const cashierIdentifierString = savedOrder.cashierId.toString();

    const orderPaidPayload = {
      orderId: savedOrder._id.toString(),
      tenantId: tenantIdentifierString,
      totalAmount: savedOrder.totalAmount,
      items: savedOrder.items.map((item) => ({
        category: item.category,
        price: item.price,
        quantity: item.quantity
      })),
      cashierId: cashierIdentifierString,
      chefId: savedOrder.chefId ? savedOrder.chefId.toString() : null,
      todayDateString,
      currentWeekString: getCurrentWeekString(),
      currentMonthString: getCurrentMonthString()
    };

    try {
      await kafkaProducer.send({
        topic: 'order.paid',
        messages: [{ key: tenantIdentifierString, value: JSON.stringify(orderPaidPayload) }]
      });
    } catch (kafkaProduceError) {
      console.error(
        'Kafka produce failed after order payment — analytics consumer will not receive this event:',
        kafkaProduceError.message
      );
    }

    emitOrderPaid(httpRequest.tenantId.toString(), savedOrder._id.toString());

    return httpResponse.status(200).json({ message: 'Order marked as paid', order: savedOrder });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

module.exports = {
  createOrder,
  listActiveOrders,
  listOrderHistory,
  updateOrderStatus,
  payOrder
};
