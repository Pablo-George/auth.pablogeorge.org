'use strict';

const bcrypt = require('bcryptjs');

const ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, comparePassword };
