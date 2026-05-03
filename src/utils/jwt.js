'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ISSUER = process.env.JWT_ISSUER || 'http://localhost:3000';
const ACCESS_TOKEN_TTL = 3600; // 1 hour in seconds

function signAccessToken(user, scope) {
  return jwt.sign(
    { sub: user.id, email: user.email, scope, type: 'access' },
    SECRET,
    { issuer: ISSUER, expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' }
  );
}

function signIdToken(user, clientId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      aud: clientId,
      iss: ISSUER,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    },
    SECRET,
    { algorithm: 'HS256' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET, { issuer: ISSUER });
}

module.exports = { signAccessToken, signIdToken, verifyToken, ACCESS_TOKEN_TTL };
