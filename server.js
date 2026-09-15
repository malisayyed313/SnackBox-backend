const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

const MASTER_PIN = process.env.MASTER_PIN || '9999';
let currentAdminPin = process.env.ADMIN_PIN || '1234';

let orders = [];
let inventory = [];
let settings = {
  ordersOpen: true,
  allowCancel: true,
  kitchenWhatsapp: '919876543210',
  upiId: 'bistro@upi',
  shopName: 'BISTRO OASIS',
  shopTagline: 'Fresh & Hot Snacks',
  shopAddress: 'Kitchen Counter No. 1, Main Road',
  shopPhone: '+91 9876543210',
  shopFssai: 'FSSAI: 21520000000000',
  footerMsg: 'Thank you for ordering with us! Visit again.'
};

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// The Admin/Customer clients poll the API. 200/15 min was too low for normal polling.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(limiter);

app.get('/', (req, res) => {
  res.json({ success: true, message: 'SnackBox is running securely!' });
});

app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body || {};
  if (pin === currentAdminPin || pin === MASTER_PIN) {
    return res.json({ success: true, message: 'Access Granted' });
  }
  return res.status(401).json({ success: false, message: 'Invalid PIN' });
});

app.post('/api/admin/reset-pin', (req, res) => {
  const { masterPin, newPin } = req.body || {};
  if (masterPin === MASTER_PIN && String(newPin || '').length >= 4) {
    currentAdminPin = String(newPin);
    return res.json({ success: true, message: 'PIN reset successful!' });
  }
  return res.status(403).json({ success: false, message: 'Unauthorized Master PIN' });
});

// ---------- CENTRAL SETTINGS ----------
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings });
});

app.put('/api/settings', (req, res) => {
  settings = { ...settings, ...(req.body || {}) };
  res.json({ success: true, settings });
});

// ---------- CENTRAL ORDERS ----------
app.get('/api/orders', (req, res) => {
  res.json({ success: true, orders });
});

app.post('/api/orders', (req, res) => {
  if (!settings.ordersOpen) {
    return res.status(409).json({
      success: false,
      code: 'ORDERS_CLOSED',
      message: 'Pre-orders are currently closed.'
    });
  }

  const body = req.body || {};
  const newOrder = {
    ...body,
    id: body.id || Date.now(),
    status: body.status || 'Order Confirmed',
    isLockedByAdmin: Boolean(body.isLockedByAdmin),
    createdAt: body.createdAt || new Date().toISOString()
  };

  // Avoid accidental duplicate creation when a client retries the same order id.
  const duplicate = orders.find(o => String(o.id) === String(newOrder.id));
  if (duplicate) {
    return res.json({ success: true, order: duplicate, duplicate: true });
  }

  orders.push(newOrder);
  return res.status(201).json({ success: true, order: newOrder });
});

app.put('/api/orders/:id', (req, res) => {
  const index = orders.findIndex(o => String(o.id) === String(req.params.id));
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  // Only fields sent by Admin/Customer are changed; existing order data stays intact.
  orders[index] = { ...orders[index], ...(req.body || {}), id: orders[index].id };
  return res.json({ success: true, order: orders[index] });
});

app.delete('/api/orders/:id', (req, res) => {
  const before = orders.length;
  orders = orders.filter(o => String(o.id) !== String(req.params.id));
  if (orders.length === before) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }
  return res.json({ success: true, message: 'Order deleted.' });
});

// Legacy/simple data endpoints kept so existing UI actions do not fail outright.
app.post('/api/dishes', (req, res) => {
  inventory = Array.isArray(req.body) ? req.body : inventory;
  res.json({ success: true, dishes: inventory });
});
app.get('/api/dishes', (req, res) => res.json({ success: true, dishes: inventory }));

app.post('/api/reviews', (req, res) => {
  res.json({ success: true, reviews: Array.isArray(req.body) ? req.body : [] });
});

app.listen(PORT, () => {
  console.log(`SnackBox server running on port ${PORT}`);
});
