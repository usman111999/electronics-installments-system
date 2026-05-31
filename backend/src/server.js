require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const branchesRoutes = require('./routes/branches');
const usersRoutes = require('./routes/users');
const productsRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const customersRoutes = require('./routes/customers');
const ordersRoutes = require('./routes/orders');
const installmentsRoutes = require('./routes/installments');
const activityLogsRoutes = require('./routes/activityLogs');
const statsRoutes = require('./routes/stats');
const whatsappRoutes = require('./routes/whatsapp');
const uploadsRoutes = require('./routes/uploads');
const devicesRoutes = require('./routes/devices');
const superAdminRoutes = require('./routes/superAdmin');
const rolesRoutes = require('./routes/roles');

const { startScheduler } = require('./services/scheduler');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
// Capture the raw body alongside JSON parsing — the /devices/heartbeat endpoint
// needs the exact bytes the device signed in order to verify the HMAC. The
// verify hook gets the raw buffer before JSON.parse and we stash it on req.
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    if (req.url && req.url.startsWith('/api/devices/heartbeat')) {
      req.rawBody = buf.toString('utf8');
    }
  },
}));
app.use(morgan('dev'));

// Generic API rate limit — keep it generous; only the login route is tight
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, skip: (req) => req.path.startsWith('/auth/me') }));
// Only the login attempt itself is throttled aggressively (brute-force defence)
app.use('/api/auth/login', rateLimit({ windowMs: 60 * 1000, limit: 20 }));

// Health probe — kept extremely cheap so external keep-alive pings (UptimeRobot
// at 5-min intervals on Render's free tier, etc.) don't waste a request slot.
// Exposes uptime so you can see how long since last cold-start when debugging.
const SERVER_BOOTED_AT = Date.now();
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    uptime_s: Math.floor((Date.now() - SERVER_BOOTED_AT) / 1000),
    env: process.env.NODE_ENV || 'development',
  });
});
// Render's load balancer pings the root path for warmup checks; respond fast.
app.get('/', (_req, res) => res.type('text/plain').send('eis-backend ok'));

app.use('/api/auth', authRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/installments', installmentsRoutes);
app.use('/api/activity-logs', activityLogsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/roles', rolesRoutes);

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// Dev-environment safety warning when the real FCM push channel is active.
// Lock/unlock requests will fan out to ANY real device enrolled against this
// Firebase project — easy to brick a customer's phone from a dev laptop.
if (process.env.DEVICE_LOCK_PROVIDER === 'fcm' && process.env.NODE_ENV !== 'production') {
  const hasSa = process.env.FCM_SERVICE_ACCOUNT_JSON_PATH || process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (hasSa) {
    console.warn(`\n[fcm] ⚠️  Live FCM provider enabled in NODE_ENV=${process.env.NODE_ENV || 'undefined'}.`);
    console.warn('[fcm] ⚠️  /api/orders/:id/lock|unlock will dispatch to REAL enrolled devices.');
    console.warn('[fcm] ⚠️  Set DEVICE_LOCK_PROVIDER=none (or unset) when not testing against real devices.\n');
  }
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'test') startScheduler();
});
