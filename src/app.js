'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const SQLiteStore = require('connect-sqlite3')(session);

const authRoutes = require('./routes/auth');
const oauthRoutes = require('./routes/oauth');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..') }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use('/', authRoutes);
app.use('/oauth', oauthRoutes);
app.use('/dashboard', dashboardRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'The page you requested does not exist.' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).render('error', {
    title: 'Something Went Wrong',
    message: isDev ? err.message : 'Internal server error.',
  });
});

module.exports = app;
