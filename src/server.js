'use strict';

require('./db'); // run migrations before starting

const app = require('./app');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const server = app.listen(PORT, HOST, () => {
  console.log(`Auth server running at http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
