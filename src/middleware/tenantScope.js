/**
 * Reads tenantId from the verified JWT payload (set by authenticate)
 * and attaches it to the request. All controllers use req.tenantId —
 * never trusting tenantId from req.body or req.params.
 */
function tenantScope(httpRequest, httpResponse, nextMiddleware) {
  httpRequest.tenantId = httpRequest.user.tenantId;
  nextMiddleware();
}

module.exports = tenantScope;
