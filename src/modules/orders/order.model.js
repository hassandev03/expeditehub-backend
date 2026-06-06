const mongoose = require('mongoose');
const tenantPlugin = require('../../plugins/tenantPlugin');

const orderItemSubdocumentSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'MenuItem' },
    name: { type: String, required: true },    // snapshotted at order creation
    price: { type: Number, required: true },   // snapshotted at order creation
    category: { type: String, required: true }, // snapshotted — needed for per-category Redis counters
    quantity: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: Number, required: true },
    items: { type: [orderItemSubdocumentSchema], required: true },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      default: 'Received',
      enum: ['Received', 'Preparing', 'Ready', 'Paid']
    },
    cashierId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Employee' },
    chefId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'Employee' }
  },
  { timestamps: true }
);

orderSchema.plugin(tenantPlugin);

// Compound index supports: chef's active orders query + overdue order cron job query
orderSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
