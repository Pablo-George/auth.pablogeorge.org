'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, comparePassword } = require('../utils/password');

router.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('register', { error: null, values: {} });
});

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.render('register', { error: 'All fields are required.', values: { name, email } });
  }
  if (password.length < 8) {
    return res.render('register', { error: 'Password must be at least 8 characters.', values: { name, email } });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('register', { error: 'Invalid email address.', values: { name, email } });
  }

  try {
    const hash = await hashPassword(password);
    const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(
      email.toLowerCase().trim(), hash, name.trim()
    );
    req.session.regenerate((err) => {
      if (err) return res.render('register', { error: 'Registration failed. Please try again.', values: { name, email } });
      req.session.userId = result.lastInsertRowid;
      res.redirect('/dashboard');
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.render('register', { error: 'An account with that email already exists.', values: { name, email } });
    }
    throw err;
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null, values: {} });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Email and password are required.', values: { email } });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  const valid = user && await comparePassword(password, user.password_hash);
  if (!valid) {
    return res.render('login', { error: 'Invalid email or password.', values: { email } });
  }

  req.session.regenerate((err) => {
    if (err) return res.render('login', { error: 'Login failed. Please try again.', values: { email } });
    req.session.userId = user.id;
    res.redirect('/dashboard');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
