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
  res.render('dashboard/index', { apps, user });
});

router.get('/apps/new', (req, res) => {
  res.render('dashboard/new-app', { error: null, values: {} });
});

router.post('/apps/new', (req, res) => {
  const { name, redirect_uris } = req.body;

  if (!name || !name.trim()) {
    return res.render('dashboard/new-app', { error: 'Application name is required.', values: { name, redirect_uris } });
  }
  if (!redirect_uris || !redirect_uris.trim()) {
    return res.render('dashboard/new-app', { error: 'At least one redirect URI is required.', values: { name, redirect_uris } });
  }

  const uris = redirect_uris.split('\n').map((u) => u.trim()).filter(Boolean);
  for (const uri of uris) {
    try {
      new URL(uri);
    } catch {
      return res.render('dashboard/new-app', { error: `Invalid URI: ${uri}`, values: { name, redirect_uris } });
    }
  }

  const clientId = crypto.randomBytes(16).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('hex');

  const result = db.prepare(
    'INSERT INTO applications (name, client_id, client_secret, redirect_uris, owner_id) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), clientId, clientSecret, uris.join(','), req.session.userId);

  res.redirect(`/dashboard/apps/${result.lastInsertRowid}?new=1`);
});

router.get('/apps/:id', (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND owner_id = ?').get(req.params.id, req.session.userId);
  if (!app) return res.status(404).render('error', { title: 'Not Found', message: 'Application not found.' });

  const showSecret = req.query.new === '1';
  const redirectUris = app.redirect_uris.split(',').map((u) => u.trim());
  res.render('dashboard/app-detail', { app, redirectUris, showSecret });
});

router.post('/apps/:id/delete', (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND owner_id = ?').get(req.params.id, req.session.userId);
  if (!app) return res.status(404).render('error', { title: 'Not Found', message: 'Application not found.' });

  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);
  res.redirect('/dashboard');
});

module.exports = router;
