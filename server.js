const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

const MASTER_PIN = process.env.MASTER_PIN || "9999";
let currentAdminPin = process.env.ADMIN_PIN || "1234";

let orders = [];
let inventory = [];

app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
});
app.use(limiter);

app.get('/', (req, res) => {
  res.json({ success: true, message: "SnackBox is running securely!" });
});

app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (pin === currentAdminPin || pin === MASTER_PIN) {
    return res.json({ success: true, message: "Access Granted" });
  }
  return res.status(401).json({ success: false, message: "Invalid PIN" });
});

app.post('/api/admin/reset-pin', (req, res) => {
  const { masterPin, newPin } = req.body;
  if (masterPin === MASTER_PIN) {
    currentAdminPin = newPin;
    return res.json({ success: true, message: "PIN reset successful!" });
  }
  return res.status(403).json({ success: false, message: "Unauthorized Master PIN" });
});

app.get('/api/orders', (req, res) => {
  res.json({ success: true, orders });
});

// CREATE: this route creates exactly ONE order.
app.post('/api/orders', (req, res) => {
  const newOrder = { id: Date.now(), ...req.body, status: req.body.status || 'Order Confirmed', createdAt: new Date().toISOString() };
  orders.push(newOrder);
  res.status(201).json({ success: true, order: newOrder });
});

// UPDATE: used by Admin to change status / customer-cancel lock.
app.put('/api/orders/:id', (req, res) => {
  const id = String(req.params.id);
  const index = orders.findIndex(o => String(o.id) === id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Order not found' });

  const allowed = {};
  if (req.body && typeof req.body.status === 'string') allowed.status = req.body.status;
  if (req.body && typeof req.body.isLockedByAdmin === 'boolean') allowed.isLockedByAdmin = req.body.isLockedByAdmin;
  orders[index] = { ...orders[index], ...allowed, updatedAt: new Date().toISOString() };
  res.json({ success: true, order: orders[index] });
});

// DELETE: used by Admin when an order is actually removed.
app.delete('/api/orders/:id', (req, res) => {
  const id = String(req.params.id);
  const before = orders.length;
  orders = orders.filter(o => String(o.id) !== id);
  if (orders.length === before) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, message: 'Order deleted' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
