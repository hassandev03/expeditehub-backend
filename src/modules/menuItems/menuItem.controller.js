const { validationResult } = require('express-validator');
const MenuItem = require('./menuItem.model');
const { redisClient } = require('../../../config/redis');
const { emitMenuInvalidation, emitItemUnavailable } = require('../../sockets/socketManager');

async function createMenuItem(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const { name, description, price, category, isAvailable, imageUrl } = httpRequest.body;

    const savedMenuItem = await new MenuItem({
      tenantId: httpRequest.tenantId,
      name,
      description,
      price,
      category,
      isAvailable,
      imageUrl
    }).save();

    return httpResponse.status(201).json({ menuItem: savedMenuItem });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function listMenuItems(httpRequest, httpResponse, nextMiddleware) {
  try {
    const tenantMenuCacheKey = `menu:${httpRequest.tenantId}`;

    // Only serve from cache when no filters are applied (cached data is the full menu)
    const hasQueryFilters = httpRequest.query.category || httpRequest.query.isAvailable !== undefined;

    if (!hasQueryFilters) {
      const cachedMenuData = await redisClient.get(tenantMenuCacheKey);
      if (cachedMenuData) {
        return httpResponse.status(200).json({ menuItems: JSON.parse(cachedMenuData) });
      }
    }

    const queryFilter = { tenantId: httpRequest.tenantId };
    if (httpRequest.query.category) {
      queryFilter.category = httpRequest.query.category;
    }
    if (httpRequest.query.isAvailable !== undefined) {
      queryFilter.isAvailable = httpRequest.query.isAvailable === 'true';
    }

    const foundMenuItems = await MenuItem.find(queryFilter);

    // Cache the full menu when no filters were applied
    if (!hasQueryFilters) {
      try {
        await redisClient.set(tenantMenuCacheKey, JSON.stringify(foundMenuItems), 'EX', 3600);
      } catch (redisCacheWriteError) {
        console.error('Failed to write menu cache to Redis:', redisCacheWriteError.message);
      }
    }

    return httpResponse.status(200).json({ menuItems: foundMenuItems });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function getMenuItem(httpRequest, httpResponse, nextMiddleware) {
  try {
    const targetMenuItemIdentifier = httpRequest.params.id;

    const foundMenuItem = await MenuItem.findOne({
      _id: targetMenuItemIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundMenuItem) {
      return httpResponse.status(404).json({ message: 'Menu item not found' });
    }

    return httpResponse.status(200).json({ menuItem: foundMenuItem });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function updateMenuItem(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const targetMenuItemIdentifier = httpRequest.params.id;

    const foundMenuItem = await MenuItem.findOne({
      _id: targetMenuItemIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundMenuItem) {
      return httpResponse.status(404).json({ message: 'Menu item not found' });
    }

    const hasPriceChanged =
      httpRequest.body.price !== undefined && httpRequest.body.price !== foundMenuItem.price;

    const allowedUpdateFields = ['name', 'description', 'price', 'category', 'isAvailable', 'imageUrl'];
    for (const fieldName of allowedUpdateFields) {
      if (httpRequest.body[fieldName] !== undefined) {
        foundMenuItem[fieldName] = httpRequest.body[fieldName];
      }
    }

    // Step 4a: MongoDB must succeed first — if it fails, do not proceed to Redis or socket
    let savedMenuItem;
    try {
      savedMenuItem = await foundMenuItem.save();
    } catch (mongoSaveError) {
      return httpResponse.status(500).json({ message: 'Failed to save menu item updates' });
    }

    // Step 4b: Refresh Redis cache — failure is logged but does not affect the response
    try {
      const refreshedMenuItems = await MenuItem.find({ tenantId: httpRequest.tenantId });
      await redisClient.set(
        `menu:${httpRequest.tenantId}`,
        JSON.stringify(refreshedMenuItems),
        'EX',
        3600
      );
    } catch (redisCacheRefreshError) {
      console.error('Failed to refresh menu cache in Redis:', redisCacheRefreshError.message);
    }

    // Step 4c: Notify cashier clients to re-fetch if price changed
    if (hasPriceChanged) {
      emitMenuInvalidation(httpRequest.tenantId.toString());
    }

    return httpResponse.status(200).json({ menuItem: savedMenuItem });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function toggleAvailability(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const targetMenuItemIdentifier = httpRequest.params.id;

    const foundMenuItem = await MenuItem.findOne({
      _id: targetMenuItemIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundMenuItem) {
      return httpResponse.status(404).json({ message: 'Menu item not found' });
    }

    foundMenuItem.isAvailable = httpRequest.body.isAvailable;

    let savedMenuItem;
    try {
      savedMenuItem = await foundMenuItem.save();
    } catch (mongoSaveError) {
      return httpResponse.status(500).json({ message: 'Failed to update menu item availability' });
    }

    try {
      const refreshedMenuItems = await MenuItem.find({ tenantId: httpRequest.tenantId });
      await redisClient.set(
        `menu:${httpRequest.tenantId}`,
        JSON.stringify(refreshedMenuItems),
        'EX',
        3600
      );
    } catch (redisCacheRefreshError) {
      console.error('Failed to refresh menu cache in Redis:', redisCacheRefreshError.message);
    }

    // Only emit when a chef marks an item unavailable (admin changes are silent)
    if (httpRequest.user.role === 'chef' && httpRequest.body.isAvailable === false) {
      emitItemUnavailable(
        httpRequest.tenantId.toString(),
        savedMenuItem._id.toString(),
        savedMenuItem.name
      );
    }

    return httpResponse.status(200).json({ menuItem: savedMenuItem });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function deleteMenuItem(httpRequest, httpResponse, nextMiddleware) {
  try {
    const targetMenuItemIdentifier = httpRequest.params.id;

    const deletedMenuItem = await MenuItem.findOneAndDelete({
      _id: targetMenuItemIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!deletedMenuItem) {
      return httpResponse.status(404).json({ message: 'Menu item not found' });
    }

    try {
      await redisClient.del(`menu:${httpRequest.tenantId}`);
    } catch (redisCacheDeleteError) {
      console.error('Failed to invalidate menu cache in Redis:', redisCacheDeleteError.message);
    }

    return httpResponse.status(200).json({ message: 'Menu item deleted' });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

module.exports = {
  createMenuItem,
  listMenuItems,
  getMenuItem,
  updateMenuItem,
  toggleAvailability,
  deleteMenuItem
};
