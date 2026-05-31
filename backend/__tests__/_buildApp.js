// Test-only helper: builds a fresh Express app with the same wiring as
// src/server.js but WITHOUT calling app.listen() and WITHOUT starting the
// node-cron scheduler. We rebuild it (instead of importing server.js) so the
// real server.js stays untouched and supertest can attach to a pure express
// instance.
//
// Note: this file is `require`d AFTER tests have already set up their
// jest.mock(...) statements (which Jest hoists), so when src/routes/* is
// pulled in here the mocked modules are wired up automatically.

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Disable helmet's content-security-policy in tests to keep responses cheap
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      if (req.url && req.url.startsWith('/api/devices/heartbeat')) {
        req.rawBody = buf.toString('utf8');
      }
    },
  }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Routes — load these AFTER the json middleware so rawBody capture works
  app.use('/api/devices', require('../src/routes/devices'));
  app.use('/api/orders', require('../src/routes/orders'));
  app.use('/api/installments', require('../src/routes/installments'));

  app.use((err, _req, res, _next) => {
    console.error('[test-app:error]', err);
    res.status(500).json({ error: err.message || 'Server error' });
  });

  return app;
}

module.exports = { buildApp };
