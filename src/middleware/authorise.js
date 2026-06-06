/**
 * Factory function that returns a middleware checking whether the authenticated
 * user's role is in the list of allowed roles.
 *
 * Usage: authorise('admin')  or  authorise('admin', 'chef')
 */
function authorise(...allowedRoles) {
  return function checkUserAuthorisation(httpRequest, httpResponse, nextMiddleware) {
    if (!allowedRoles.includes(httpRequest.user.role)) {
      return httpResponse.status(403).json({ message: 'Insufficient permissions for this action' });
    }
    nextMiddleware();
  };
}

module.exports = authorise;
