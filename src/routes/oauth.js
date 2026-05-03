'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { signAccessToken, signIdToken, verifyToken, ACCESS_TOKEN_TTL } = require('../utils/jwt');
const { buildCheckoutUrl } = require('../utils/payment');

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'https://payment.pablogeorge.org';

const SCOPE_LABELS = {
  openid: 'Know who you are',
  profile: 'Access your name',
  email: 'Access your email address',
};

// GET /oauth/authorize — validate params, store pendingAuth, show consent or redirect to login
router.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state } = req.query;

  // Validate client and redirect_uri first (never redirect on these errors)
  const app = db.prepare('SELECT * FROM applications WHERE client_id = ?').get(client_id);
  if (!app) {
    return res.status(400).render('error', { title: 'Invalid Client', message: 'Unknown client_id.' });
  }

  const allowedUris = app.redirect_uris.split(',').map((u) => u.trim());
  if (!redirect_uri || !allowedUris.includes(redirect_uri)) {
    return res.status(400).render('error', { title: 'Invalid Redirect URI', message: 'The redirect_uri does not match any registered URIs for this application.' });
  }

  // Now safe to redirect errors back to the client
  if (response_type !== 'code') {
    return res.redirect(`${redirect_uri}?error=unsupported_response_type&state=${encodeURIComponent(state || '')}`);
  }
  if (!state) {
    return res.redirect(`${redirect_uri}?error=invalid_request&error_description=state_required`);
  }

  const normalizedScope = scope || 'openid';
  req.session.pendingAuth = { client_id, redirect_uri, scope: normalizedScope, state, app_name: app.name };

  if (!req.session.userId) {
    return res.redirect('/login');
  }

  // Payment gate: if this app requires payment, check whether the user has already paid
  if (app.requires_payment) {
    const paid = db.prepare(
      'SELECT id FROM user_app_payments WHERE user_id = ? AND client_id = ?'
    ).get(req.session.userId, client_id);

    if (!paid) {
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const checkoutUrl = buildCheckoutUrl(PAYMENT_SERVICE_URL, {
        appId: app.payment_app_id,
        apiKey: app.payment_api_key,
        amount: app.payment_amount,
        returnUrl: `${baseUrl}/oauth/payment-callback`,
        clientTransactionId: `${req.session.userId}`,
      });
      return res.redirect(checkoutUrl);
    }
  }

  const scopeList = normalizedScope.split(' ').map((s) => ({ key: s, label: SCOPE_LABELS[s] || s }));
  res.render('authorize', { app_name: app.name, scope_list: scopeList, pendingAuth: req.session.pendingAuth });
});

// POST /oauth/authorize — user approved, issue code and redirect
router.post('/authorize', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  const pending = req.session.pendingAuth;
  if (!pending) {
    return res.status(400).render('error', { title: 'Session Expired', message: 'Authorization session expired. Please try again.' });
  }

  delete req.session.pendingAuth;

  // User clicked deny
  if (req.body.action === 'deny') {
    return res.redirect(`${pending.redirect_uri}?error=access_denied&state=${encodeURIComponent(pending.state)}`);
  }

  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  db.prepare(
    'INSERT INTO authorization_codes (code, user_id, client_id, redirect_uri, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(code, req.session.userId, pending.client_id, pending.redirect_uri, pending.scope, expiresAt);

  res.redirect(`${pending.redirect_uri}?code=${code}&state=${encodeURIComponent(pending.state)}`);
});

// POST /oauth/token — exchange authorization code for tokens
router.post('/token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'application/json');

  // Authenticate client — accept body params or HTTP Basic auth
  let clientId, clientSecret;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    clientId = decoded.slice(0, sep);
    clientSecret = decoded.slice(sep + 1);
  } else {
    clientId = req.body.client_id;
    clientSecret = req.body.client_secret;
  }

  const app = db.prepare('SELECT * FROM applications WHERE client_id = ?').get(clientId);
  if (!app || app.client_secret !== clientSecret) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Client authentication failed.' });
  }

  const { grant_type, code, redirect_uri, refresh_token: incomingRefresh } = req.body;

  if (grant_type === 'authorization_code') {
    if (!code) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code.' });
    }

    const row = db.prepare('SELECT * FROM authorization_codes WHERE code = ?').get(code);
    if (!row || row.used || Date.now() > row.expires_at || row.client_id !== clientId) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' });
    }
    if (row.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' });
    }

    // Mark used immediately
    db.prepare('UPDATE authorization_codes SET used = 1 WHERE id = ?').run(row.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found.' });
    }

    const accessToken = signAccessToken(user, row.scope);
    const idToken = signIdToken(user, clientId);
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    db.prepare(
      'INSERT INTO refresh_tokens (token, user_id, client_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(refreshToken, user.id, clientId, row.scope, refreshExpiry);

    return res.json({
      access_token: accessToken,
      id_token: idToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope: row.scope,
    });
  }

  if (grant_type === 'refresh_token') {
    if (!incomingRefresh) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token.' });
    }

    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(incomingRefresh);
    if (!row || row.revoked || Date.now() > row.expires_at || row.client_id !== clientId) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found.' });
    }

    const accessToken = signAccessToken(user, row.scope);
    const idToken = signIdToken(user, clientId);

    return res.json({
      access_token: accessToken,
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope: row.scope,
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

// GET /oauth/payment-callback — return URL from the payment service
router.get('/payment-callback', (req, res) => {
  const { status, transaction_id } = req.query;

  if (!req.session.userId || !req.session.pendingAuth) {
    return res.status(400).render('error', {
      title: 'Session Expired',
      message: 'Your session expired during payment. Please return to the application and try again.',
    });
  }

  const pending = req.session.pendingAuth;

  if (status !== 'success') {
    delete req.session.pendingAuth;
    return res.redirect(
      `${pending.redirect_uri}?error=payment_required&state=${encodeURIComponent(pending.state)}`
    );
  }

  // Record the payment so this user won't be charged again for this app
  try {
    db.prepare(
      'INSERT OR IGNORE INTO user_app_payments (user_id, client_id, transaction_id) VALUES (?, ?, ?)'
    ).run(req.session.userId, pending.client_id, transaction_id || '');
  } catch {
    // Already recorded — safe to continue
  }

  // Resume the OAuth flow — pendingAuth is still in session
  res.redirect('/oauth/authorize?' + new URLSearchParams({
    client_id: pending.client_id,
    redirect_uri: pending.redirect_uri,
    response_type: 'code',
    scope: pending.scope,
    state: pending.state,
  }));
});

// GET /oauth/userinfo — validate Bearer token and return user profile
router.get('/userinfo', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', 'Bearer realm="auth-server"');
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing Bearer token.' });
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    return res.status(401).json({ error: 'invalid_token', error_description: 'Token is invalid or expired.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) {
    return res.status(404).json({ error: 'user_not_found' });
  }

  res.json({ sub: user.id, email: user.email, name: user.name, created_at: user.created_at });
});

module.exports = router;
