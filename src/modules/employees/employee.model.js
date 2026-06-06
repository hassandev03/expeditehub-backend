const mongoose = require('mongoose');
const tenantPlugin = require('../../plugins/tenantPlugin');

const employeeSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    // select:false prevents password from being returned in queries by default.
    // Use .select('+password') explicitly when comparing passwords.
    password: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ['admin', 'chef', 'cashier'] },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true }
);

// tenantPlugin adds tenantId (required, indexed, ref:Tenant) before the compound index is defined
employeeSchema.plugin(tenantPlugin);

// Compound unique index: two employees in different tenants can share an email;
// within the same tenant, emails must be unique.
employeeSchema.index({ tenantId: 1, email: 1 }, { unique: true });

module.exports = mongoose.models.Employee || mongoose.model('Employee', employeeSchema);
