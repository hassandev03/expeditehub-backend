const mongoose = require('mongoose');

// Tenant is the root entity — tenantPlugin is intentionally NOT applied here.
const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    cuisineType: { type: String },
    logoUrl: { type: String },
    contactEmail: { type: String, required: true, unique: true },
    contactPhone: { type: String }
  },
  { timestamps: true }
);

// Guard against model re-registration in Jest (multiple test files load the same module)
module.exports = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
