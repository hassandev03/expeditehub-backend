const jwt = require('jsonwebtoken');
const { redisClient } = require('../../config/redis');

let socketIOInstance = null;

/**
 * Initialises Socket.IO on the HTTP server. Called once from server.js.
 * Controllers call the named emit functions below — they never import io directly.
 */
function initSocket(httpServer) {
  const { Server } = require('socket.io');

  socketIOInstance = new Server(httpServer, {
    cors: { origin: '*' }
  });

  socketIOInstance.on('connection', (connectedSocket) => {
    connectedSocket.on('join', async () => {
      const handshakeAuthToken = connectedSocket.handshake.auth.token;
      if (!handshakeAuthToken) {
        connectedSocket.disconnect();
        return;
      }

      let decodedSocketPayload;
      try {
        decodedSocketPayload = jwt.verify(handshakeAuthToken, process.env.ACCESS_TOKEN_SECRET);
      } catch (tokenVerificationError) {
        connectedSocket.disconnect();
        return;
      }

      const blacklistedEntry = await redisClient.get(`blacklist:${decodedSocketPayload.jti}`);
      if (blacklistedEntry) {
        connectedSocket.disconnect();
        return;
      }

      // Room name is derived from the verified token, not from client-provided data
      const verifiedRoomName = `${decodedSocketPayload.role}:${decodedSocketPayload.tenantId}`;
      connectedSocket.join(verifiedRoomName);
    });
  });

  return socketIOInstance;
}

function emitNewOrder(tenantId, newOrderDocument) {
  if (!socketIOInstance) return;
  socketIOInstance.to(`chef:${tenantId}`).emit('new_order', newOrderDocument);
}

function emitOrderReady(tenantId, readyOrderDocument) {
  if (!socketIOInstance) return;
  socketIOInstance.to(`cashier:${tenantId}`).emit('order_ready', {
    orderId: readyOrderDocument._id,
    orderNumber: readyOrderDocument.orderNumber
  });
}

function emitItemUnavailable(tenantId, menuItemId, itemName) {
  if (!socketIOInstance) return;
  const unavailablePayload = { menuItemId, itemName };
  socketIOInstance.to(`cashier:${tenantId}`).emit('item_unavailable', unavailablePayload);
  socketIOInstance.to(`admin:${tenantId}`).emit('item_unavailable', unavailablePayload);
}

function emitMenuInvalidation(tenantId) {
  if (!socketIOInstance) return;
  socketIOInstance.to(`cashier:${tenantId}`).emit('menu_updated', { tenantId });
}

function emitDelayedOrderAlert(tenantId, orderId) {
  if (!socketIOInstance) return;
  socketIOInstance.to(`chef:${tenantId}`).emit('order_delayed', { orderId });
}

function emitOrderPaid(tenantId, orderId) {
  if (!socketIOInstance) return;
  socketIOInstance.to(`chef:${tenantId}`).emit('order_paid', { orderId });
}

module.exports = {
  initSocket,
  emitNewOrder,
  emitOrderReady,
  emitItemUnavailable,
  emitMenuInvalidation,
  emitDelayedOrderAlert,
  emitOrderPaid
};
