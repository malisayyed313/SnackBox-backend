const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// Master PIN setup for emergency unlock
const MASTER_PIN = process.env.MASTER_PIN || "9999";
let currentAdminPin = process.env.ADMIN_PIN || "1234";

// In-Memory Data Storage (Temporary until MongoDB is connected)
let orders = [];
let inventory = [];

// Security Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate Limiter to prevent spam/attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 200 // Limit each IP to 200 requests per windowMs
});
app.use(limiter);

// --- ROUTES ---

// 1. Health Check
app.get('/', (req, res) => {
  res.json({ success: true, message: "Bistro Oasis Backend is running securely!" });
});

// 2. Admin PIN Verification (Includes Master PIN logic)
app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (pin === currentAdminPin || pin === MASTER_PIN) {
    return res.json({ success: true, message: "Access Granted" });
  }
  return res.status(401).json({ success: false, message: "Invalid PIN" });
});

// 3. Reset Admin PIN
app.post('/api/admin/reset-pin', (req, res) => {
  const { masterPin, newPin } = req.body;
  if (masterPin === MASTER_PIN) {
    currentAdminPin = newPin;
    return res.json({ success: true, message: "PIN reset successful!" });
  }
  return res.status(403).json({ success: false, message: "Unauthorized Master PIN" });
});

// 4. Get & Create Orders
app.get('/api/orders', (req, res) => res.json({ success: true, orders }));
app.post('/api/orders', (req, res) => {
  const newOrder = { id: Date.now(), ...req.body, status: 'Pending', createdAt: new Date() };
  orders.push(newOrder);
  res.status(201).json({ success: true, order: newOrder });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
