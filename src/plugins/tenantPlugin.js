const mongoose = require('mongoose');

/**
 * Mongoose plugin that injects a tenantId field into any schema it is applied to.
 * Applied explicitly in each model file (except Tenant, which is the root entity).
 */
function tenantPlugin(schema) {
  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: 'Tenant'
    }
  });
}

module.exports = tenantPlugin;
