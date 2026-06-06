const mongoose = require('mongoose');
const tenantPlugin = require('../../plugins/tenantPlugin');

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    isAvailable: { type: Boolean, required: true, default: true },
    imageUrl: { type: String }
  },
  { timestamps: true }
);

menuItemSchema.plugin(tenantPlugin);

module.exports = mongoose.models.MenuItem || mongoose.model('MenuItem', menuItemSchema);
