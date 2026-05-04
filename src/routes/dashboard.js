'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/', (req, res) => {
  const apps = db.prepare('SELECT * FROM applications WHERE owner_id = ? ORDER BY created_at DESC').all(req.session.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const imported = req.query.imported ? parseInt(req.query.imported, 10) : null;
  res.render('dashboard/index', { apps, user, imported });
});

router.get('/apps/export', (req, res) => {
  const apps = db.prepare('SELECT * FROM applications WHERE owner_id = ? ORDER BY created_at DESC').all(req.session.userId);
  const exported = apps.map((a) => ({
    name: a.name,
    client_id: a.client_id,
    client_secret: a.client_secret,
    redirect_uris: a.redirect_uris.split(',').map((u) => u.trim()),
    logo_url: a.logo_url || null,
    brand_color: a.brand_color || '#4f46e5',
    requires_payment: !!a.requires_payment,
    payment_amount: a.payment_amount || null,
    payment_app_id: a.payment_app_id || null,
    payment_api_key: a.payment_api_key || null,
  }));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="apps.json"');
  res.send(JSON.stringify(exported, null, 2));
});

router.post('/apps/import', (req, res) => {
  let apps;
  try {
    apps = JSON.parse(req.body.json);
    if (!Array.isArray(apps)) throw new Error('Expected an array');
  } catch {
    const existing = db.prepare('SELECT * FROM applications WHERE owner_id = ? ORDER BY created_at DESC').all(req.session.userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    return res.render('dashboard/index', { apps: existing, user, importError: 'Invalid JSON — paste the contents of your exported apps.json file.' });
  }

  const insert = db.prepare(`
    INSERT INTO applications
      (name, client_id, client_secret, redirect_uris, owner_id, logo_url, brand_color,
       requires_payment, payment_amount, payment_app_id, payment_api_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      name = excluded.name,
      client_secret = excluded.client_secret,
      redirect_uris = excluded.redirect_uris,
      logo_url = excluded.logo_url,
      brand_color = excluded.brand_color,
      requires_payment = excluded.requires_payment,
      payment_amount = excluded.payment_amount,
      payment_app_id = excluded.payment_app_id,
      payment_api_key = excluded.payment_api_key
  `);

  let count = 0;
  const importMany = db.transaction((list) => {
    for (const a of list) {
      if (!a.client_id || !a.client_secret || !a.name || !a.redirect_uris?.length) continue;
      insert.run(
        a.name, a.client_id, a.client_secret,
        Array.isArray(a.redirect_uris) ? a.redirect_uris.join(',') : a.redirect_uris,
        req.session.userId,
        a.logo_url || null,
        /^#[0-9a-fA-F]{6}$/.test(a.brand_color) ? a.brand_color : '#4f46e5',
        a.requires_payment ? 1 : 0,
        a.payment_amount || null,
        a.payment_app_id || null,
        a.payment_api_key || null,
      );
      count++;
    }
  });
  importMany(apps);

  res.redirect(`/dashboard?imported=${count}`);
});

router.get('/apps/new', (req, res) => {
  res.render('dashboard/new-app', { error: null, values: {} });
});

router.post('/apps/new', (req, res) => {
  const { name, redirect_uris, logo_url, brand_color, requires_payment, payment_amount, payment_app_id, payment_api_key } = req.body;
  const wantsPayment = requires_payment === '1';

  if (!name || !name.trim()) {
    return res.render('dashboard/new-app', { error: 'Application name is required.', values: req.body });
  }
  if (!redirect_uris || !redirect_uris.trim()) {
    return res.render('dashboard/new-app', { error: 'At least one redirect URI is required.', values: req.body });
  }

  const uris = redirect_uris.split('\n').map((u) => u.trim()).filter(Boolean);
  for (const uri of uris) {
    try {
      new URL(uri);
    } catch {
      return res.render('dashboard/new-app', { error: `Invalid URI: ${uri}`, values: req.body });
    }
  }

  if (wantsPayment) {
    if (!payment_amount || isNaN(parseFloat(payment_amount)) || parseFloat(payment_amount) < 0.5) {
      return res.render('dashboard/new-app', { error: 'Payment amount must be at least $0.50.', values: req.body });
    }
    if (!payment_app_id || !payment_app_id.trim()) {
      return res.render('dashboard/new-app', { error: 'Payment App ID is required when payment is enabled.', values: req.body });
    }
    if (!payment_api_key || !payment_api_key.trim()) {
      return res.render('dashboard/new-app', { error: 'Payment API Key is required when payment is enabled.', values: req.body });
    }
  }

  const clientId = crypto.randomBytes(16).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('hex');

  const color = /^#[0-9a-fA-F]{6}$/.test(brand_color) ? brand_color : '#4f46e5';

  const result = db.prepare(
    `INSERT INTO applications
      (name, client_id, client_secret, redirect_uris, owner_id, logo_url, brand_color,
       requires_payment, payment_amount, payment_app_id, payment_api_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name.trim(), clientId, clientSecret, uris.join(','), req.session.userId,
    logo_url && logo_url.trim() ? logo_url.trim() : null,
    color,
    wantsPayment ? 1 : 0,
    wantsPayment ? parseFloat(payment_amount) : null,
    wantsPayment ? payment_app_id.trim() : null,
    wantsPayment ? payment_api_key.trim() : null,
  );

  res.redirect(`/dashboard/apps/${result.lastInsertRowid}?new=1`);
});

router.get('/apps/:id', (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND owner_id = ?').get(req.params.id, req.session.userId);
  if (!app) return res.status(404).render('error', { title: 'Not Found', message: 'Application not found.' });

  const showSecret = req.query.new === '1';
  const redirectUris = app.redirect_uris.split(',').map((u) => u.trim());
  res.render('dashboard/app-detail', { app, redirectUris, showSecret });
});

router.post('/apps/:id/redirect-uris', (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND owner_id = ?').get(req.params.id, req.session.userId);
  if (!app) return res.status(404).render('error', { title: 'Not Found', message: 'Application not found.' });

  const uris = (req.body.redirect_uris || '').split('\n').map((u) => u.trim()).filter(Boolean);
  if (uris.length === 0) {
    const redirectUris = app.redirect_uris.split(',').map((u) => u.trim());
    return res.render('dashboard/app-detail', { app, redirectUris, showSecret: false, error: 'At least one redirect URI is required.' });
  }
  for (const uri of uris) {
    try { new URL(uri); } catch {
      const redirectUris = app.redirect_uris.split(',').map((u) => u.trim());
      return res.render('dashboard/app-detail', { app, redirectUris, showSecret: false, error: `Invalid URI: ${uri}` });
    }
  }

  db.prepare('UPDATE applications SET redirect_uris = ? WHERE id = ?').run(uris.join(','), app.id);
  res.redirect(`/dashboard/apps/${app.id}`);
});

router.post('/apps/:id/delete', (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND owner_id = ?').get(req.params.id, req.session.userId);
  if (!app) return res.status(404).render('error', { title: 'Not Found', message: 'Application not found.' });

  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);
  res.redirect('/dashboard');
});

module.exports = router;
