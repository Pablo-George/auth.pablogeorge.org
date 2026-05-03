'use strict';

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

module.exports = requireAuth;
