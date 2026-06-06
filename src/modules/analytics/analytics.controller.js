const Employee = require('../employees/employee.model');
const Order = require('../orders/order.model');
const { redisClient } = require('../../../config/redis');

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
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

async function getSummary(httpRequest, httpResponse, nextMiddleware) {
  try {
    const tenantIdentifierString = httpRequest.tenantId.toString();
    const todayDateString = getTodayDateString();
    const currentWeekString = getCurrentWeekString();
    const currentMonthString = getCurrentMonthString();

    const summaryRedisPipeline = redisClient.pipeline();
    summaryRedisPipeline.get(`revenue:daily:${tenantIdentifierString}:${todayDateString}`);
    summaryRedisPipeline.get(`orders:daily:${tenantIdentifierString}:${todayDateString}`);
    summaryRedisPipeline.get(`revenue:weekly:${tenantIdentifierString}:${currentWeekString}`);
    summaryRedisPipeline.get(`orders:weekly:${tenantIdentifierString}:${currentWeekString}`);
    summaryRedisPipeline.get(`revenue:monthly:${tenantIdentifierString}:${currentMonthString}`);
    summaryRedisPipeline.get(`orders:monthly:${tenantIdentifierString}:${currentMonthString}`);

    const pipelineResults = await summaryRedisPipeline.exec();

    const [
      [, dailyRevenue],
      [, dailyOrders],
      [, weeklyRevenue],
      [, weeklyOrders],
      [, monthlyRevenue],
      [, monthlyOrders]
    ] = pipelineResults;

    return httpResponse.status(200).json({
      today: {
        revenue: parseFloat(dailyRevenue) || 0,
        orders: parseInt(dailyOrders, 10) || 0
      },
      week: {
        revenue: parseFloat(weeklyRevenue) || 0,
        orders: parseInt(weeklyOrders, 10) || 0
      },
      month: {
        revenue: parseFloat(monthlyRevenue) || 0,
        orders: parseInt(monthlyOrders, 10) || 0
      }
    });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function getByCategory(httpRequest, httpResponse, nextMiddleware) {
  try {
    const tenantIdentifierString = httpRequest.tenantId.toString();
    const todayDateString = getTodayDateString();

    // Note: KEYS is acceptable at semester-project scale; use SCAN in production
    const categoryRevenueKeys = await redisClient.keys(
      `revenue:category:${tenantIdentifierString}:*:${todayDateString}`
    );

    if (categoryRevenueKeys.length === 0) {
      return httpResponse.status(200).json({ categories: [] });
    }

    const categoryRevenuePipeline = redisClient.pipeline();
    for (const categoryKey of categoryRevenueKeys) {
      categoryRevenuePipeline.get(categoryKey);
    }
    const categoryRevenueResults = await categoryRevenuePipeline.exec();

    // Key format: revenue:category:{tenantId}:{categoryName}:{date}
    const categoriesWithRevenue = categoryRevenueKeys.map((categoryKey, keyIndex) => {
      const keySegments = categoryKey.split(':');
      const extractedCategoryName = keySegments[3];
      const [, rawCategoryRevenue] = categoryRevenueResults[keyIndex];
      return {
        name: extractedCategoryName,
        revenue: parseFloat(rawCategoryRevenue) || 0
      };
    });

    return httpResponse.status(200).json({ categories: categoriesWithRevenue });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function getByCashier(httpRequest, httpResponse, nextMiddleware) {
  try {
    const tenantIdentifierString = httpRequest.tenantId.toString();
    const todayDateString = getTodayDateString();

    // Key format: orders:cashier:{tenantId}:{cashierId}:{date}
    const cashierOrderCountKeys = await redisClient.keys(
      `orders:cashier:${tenantIdentifierString}:*:${todayDateString}`
    );

    if (cashierOrderCountKeys.length === 0) {
      return httpResponse.status(200).json({ cashiers: [] });
    }

    const extractedCashierIdentifiers = cashierOrderCountKeys.map((cashierKey) => {
      const keySegments = cashierKey.split(':');
      return keySegments[3];
    });

    const cashierMetricsPipeline = redisClient.pipeline();
    for (const cashierIdentifier of extractedCashierIdentifiers) {
      cashierMetricsPipeline.get(
        `orders:cashier:${tenantIdentifierString}:${cashierIdentifier}:${todayDateString}`
      );
      cashierMetricsPipeline.get(
        `revenue:cashier:${tenantIdentifierString}:${cashierIdentifier}:${todayDateString}`
      );
    }
    const cashierMetricsResults = await cashierMetricsPipeline.exec();

    const foundCashierEmployees = await Employee.find({
      _id: { $in: extractedCashierIdentifiers }
    }).select('fullName');

    const cashierEmployeeNameMap = new Map(
      foundCashierEmployees.map((employee) => [employee._id.toString(), employee.fullName])
    );

    const cashiersWithMetrics = extractedCashierIdentifiers.map((cashierIdentifier, cashierIndex) => {
      const [, rawOrderCount] = cashierMetricsResults[cashierIndex * 2];
      const [, rawRevenue] = cashierMetricsResults[cashierIndex * 2 + 1];
      return {
        cashierId: cashierIdentifier,
        fullName: cashierEmployeeNameMap.get(cashierIdentifier) || 'Unknown',
        orders: parseInt(rawOrderCount, 10) || 0,
        revenue: parseFloat(rawRevenue) || 0
      };
    });

    return httpResponse.status(200).json({ cashiers: cashiersWithMetrics });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function getByChef(httpRequest, httpResponse, nextMiddleware) {
  try {
    const tenantIdentifierString = httpRequest.tenantId.toString();
    const todayDateString = getTodayDateString();

    // Key format: orders:chef:{tenantId}:{chefId}:{date}
    const chefOrderCountKeys = await redisClient.keys(
      `orders:chef:${tenantIdentifierString}:*:${todayDateString}`
    );

    if (chefOrderCountKeys.length === 0) {
      return httpResponse.status(200).json({ chefs: [] });
    }

    const extractedChefIdentifiers = chefOrderCountKeys.map((chefKey) => {
      const keySegments = chefKey.split(':');
      return keySegments[3];
    });

    const chefOrderCountPipeline = redisClient.pipeline();
    for (const chefIdentifier of extractedChefIdentifiers) {
      chefOrderCountPipeline.get(
        `orders:chef:${tenantIdentifierString}:${chefIdentifier}:${todayDateString}`
      );
    }
    const chefOrderCountResults = await chefOrderCountPipeline.exec();

    const foundChefEmployees = await Employee.find({
      _id: { $in: extractedChefIdentifiers }
    }).select('fullName');

    const chefEmployeeNameMap = new Map(
      foundChefEmployees.map((employee) => [employee._id.toString(), employee.fullName])
    );

    const chefsWithMetrics = extractedChefIdentifiers.map((chefIdentifier, chefIndex) => {
      const [, rawOrderCount] = chefOrderCountResults[chefIndex];
      return {
        chefId: chefIdentifier,
        fullName: chefEmployeeNameMap.get(chefIdentifier) || 'Unknown',
        orders: parseInt(rawOrderCount, 10) || 0
      };
    });

    return httpResponse.status(200).json({ chefs: chefsWithMetrics });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function getActiveOrdersCount(httpRequest, httpResponse, nextMiddleware) {
  try {
    const activeOrderCount = await Order.countDocuments({
      tenantId: httpRequest.tenantId,
      status: { $in: ['Received', 'Preparing'] }
    });

    return httpResponse.status(200).json({ count: activeOrderCount });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

module.exports = {
  getSummary,
  getByCategory,
  getByCashier,
  getByChef,
  getActiveOrdersCount
};
