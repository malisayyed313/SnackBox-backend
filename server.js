const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const MASTER_PIN = process.env.MASTER_PIN || '9999';
let currentAdminPin = process.env.ADMIN_PIN || '1234';

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(limiter);

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const dishSchema = new mongoose.Schema({
  clientId: { type: String, default: 'default', index: true },
  id: { type: String, unique: true, index: true },
  name: String, price: Number, stockQty: Number, category: String, img: String,
  active: { type: Boolean, default: true }, inStock: { type: Boolean, default: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  phone: { type: String, index: true },
  status: { type: String, index: true },
  isLockedByAdmin: Boolean,
  createdAt: Date
}, { timestamps: true });

const reviewSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  phone: { type: String, index: true },
  rating: Number,
  createdAt: Date
}, { timestamps: true });

const listSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: [] }
}, { timestamps: true });

const Settings = mongoose.model('SnackBoxSettings', settingsSchema);
const Dish = mongoose.model('SnackBoxDish', dishSchema);
const Order = mongoose.model('SnackBoxOrder', orderSchema);
const Review = mongoose.model('SnackBoxReview', reviewSchema);
const ListData = mongoose.model('SnackBoxListData', listSchema);

const DEFAULT_SETTINGS = {
  ordersOpen: true, allowCancel: true,
  kitchenWhatsapp: '919876543210', upiId: 'bistro@upi',
  shopName: 'BISTRO OASIS', shopTagline: 'Fresh & Hot Snacks',
  shopAddress: 'Kitchen Counter No. 1, Main Road', shopPhone: '+91 9876543210',
  shopFssai: 'FSSAI: 21520000000000',
  footerMsg: 'Thank you for ordering with us! Visit again.'
};
const DEFAULT_SLOTS = ['Evening Snacks (4:00 PM - 5:00 PM)', 'Late Evening (6:30 PM - 7:30 PM)'];
const DEFAULT_COUPONS = { SNACK10: 10, WELCOME20: 20 };
const DEFAULT_DISHES = [
  { id: '101', name: 'Special Chicken Cutlet (2 Pcs)', price: 90, category: 'Non-Veg', img: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=200', active: true, stockQty: 15, inStock: true },
  { id: '102', name: 'Paneer Samosa Combo', price: 60, category: 'Veg', img: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=200', active: true, stockQty: 20, inStock: true },
  { id: '103', name: 'Gulab Jamun (2 Pcs)', price: 40, category: 'Sweet', img: 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=200', active: true, stockQty: 10, inStock: true }
];

function normalizeId(v) { return String(v ?? ''); }
function cleanDoc(doc) { return doc?.data ? { ...doc.data, id: doc.id } : null; }

async function ensureDefaults() {
  const s = await Settings.findOne({ key: 'main' });
  if (!s) await Settings.create({ key: 'main', data: DEFAULT_SETTINGS });
  const slots = await ListData.findOne({ key: 'slots' });
  if (!slots) await ListData.create({ key: 'slots', data: DEFAULT_SLOTS });
  const coupons = await ListData.findOne({ key: 'coupons' });
  if (!coupons) await ListData.create({ key: 'coupons', data: DEFAULT_COUPONS });
}

async function getSettings() {
  const s = await Settings.findOne({ key: 'main' }).lean();
  return { ...DEFAULT_SETTINGS, ...(s?.data || {}) };
}
async function getDishes() {
  const rows = await Dish.find({ clientId: 'default' }).sort({ createdAt: 1 }).lean();
  return rows.map(r => cleanDoc(r));
}
async function getOrders() {
  const rows = await Order.find().sort({ createdAt: 1 }).lean();
  return rows.map(r => cleanDoc(r));
}
async function getReviews() {
  const rows = await Review.find().sort({ createdAt: 1 }).lean();
  return rows.map(r => cleanDoc(r));
}
async function getList(key, fallback) {
  const row = await ListData.findOne({ key }).lean();
  return row ? row.data : fallback;
}

app.get('/', (req, res) => res.json({ success: true, message: 'SnackBox is running securely!', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.get('/api/health', (req, res) => res.json({ success: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body || {};
  if (String(pin) === String(currentAdminPin) || String(pin) === String(MASTER_PIN)) return res.json({ success: true, message: 'Access Granted' });
  return res.status(401).json({ success: false, message: 'Invalid PIN' });
});
app.post('/api/admin/reset-pin', (req, res) => {
  const { masterPin, newPin } = req.body || {};
  if (String(masterPin) === String(MASTER_PIN) && String(newPin || '').length >= 4) {
    currentAdminPin = String(newPin);
    return res.json({ success: true, message: 'PIN reset successful!' });
  }
  return res.status(403).json({ success: false, message: 'Unauthorized Master PIN' });
});

// One central read for both apps. MongoDB is the source of truth.
app.get('/api/sync', async (req, res) => {
  try {
    const [settings, orders, dishes, reviews, slots, coupons] = await Promise.all([
      getSettings(), getOrders(), getDishes(), getReviews(), getList('slots', DEFAULT_SLOTS), getList('coupons', DEFAULT_COUPONS)
    ]);
    res.json({ success: true, settings, orders, dishes, reviews, slots, coupons, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error('SYNC ERROR', e);
    res.status(500).json({ success: false, message: 'Central sync failed.' });
  }
});

app.get('/api/settings', async (req, res) => res.json({ success: true, settings: await getSettings() }));
app.put('/api/settings', async (req, res) => {
  try {
    const settings = { ...(await getSettings()), ...(req.body || {}) };
    await Settings.findOneAndUpdate({ key: 'main' }, { key: 'main', data: settings }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ success: false, message: 'Settings save failed.' }); }
});

// Dishes: supports both the old full-array POST and individual CRUD.
app.get('/api/dishes', async (req, res) => res.json({ success: true, dishes: await getDishes() }));
app.post('/api/dishes', async (req, res) => {
  try {
    const payload = req.body;
    if (Array.isArray(payload)) {
      await Dish.deleteMany({ clientId: 'default' });
      if (payload.length) await Dish.insertMany(payload.map(d => ({ clientId: 'default', id: normalizeId(d.id || Date.now() + Math.random()), data: d, ...d, id: normalizeId(d.id || Date.now() + Math.random()) })));
      return res.json({ success: true, dishes: await getDishes() });
    }
    const d = payload || {};
    const id = normalizeId(d.id || Date.now());
    const row = await Dish.findOneAndUpdate({ id }, { ...d, id, clientId: 'default', data: d }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.status(201).json({ success: true, dish: cleanDoc(row) });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Dish save failed.' }); }
});
app.put('/api/dishes/:id', async (req, res) => {
  try { const row = await Dish.findOneAndUpdate({ id: normalizeId(req.params.id) }, { ...req.body, data: { ...(req.body || {}), id: normalizeId(req.params.id) } }, { new: true }); if (!row) return res.status(404).json({ success:false,message:'Dish not found.' }); res.json({success:true,dish:cleanDoc(row)}); }
  catch(e){res.status(500).json({success:false,message:'Dish update failed.'});}
});
app.delete('/api/dishes/:id', async (req, res) => { const r = await Dish.deleteOne({ id: normalizeId(req.params.id) }); if (!r.deletedCount) return res.status(404).json({success:false,message:'Dish not found.'}); res.json({success:true}); });

// Slots + coupons keep the existing UI's full-array POST behavior.
app.get('/api/slots', async (req, res) => res.json({ success:true, slots: await getList('slots', DEFAULT_SLOTS) }));
app.post('/api/slots', async (req, res) => { const slots = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.slots) ? req.body.slots : []); await ListData.findOneAndUpdate({key:'slots'},{key:'slots',data:slots},{upsert:true,new:true}); res.json({success:true,slots}); });
app.get('/api/coupons', async (req, res) => res.json({ success:true, coupons: await getList('coupons', DEFAULT_COUPONS) }));
app.post('/api/coupons', async (req, res) => { const coupons = req.body && !Array.isArray(req.body) ? (req.body.coupons || req.body) : {}; await ListData.findOneAndUpdate({key:'coupons'},{key:'coupons',data:coupons},{upsert:true,new:true}); res.json({success:true,coupons}); });

// Reviews: supports full-array replacement (old admin) and single review (new customer).
app.get('/api/reviews', async (req, res) => res.json({success:true,reviews:await getReviews()}));
app.post('/api/reviews', async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      await Review.deleteMany({});
      if (req.body.length) await Review.insertMany(req.body.map(r => ({id:normalizeId(r.id || Date.now()+Math.random()),phone:r.phone,rating:r.rating,createdAt:new Date(r.createdAt || Date.now()),data:r})));
    } else {
      const r=req.body||{}; const id=normalizeId(r.id||Date.now());
      await Review.findOneAndUpdate({id},{id,phone:r.phone,rating:r.rating,createdAt:new Date(r.createdAt||Date.now()),data:r},{upsert:true,new:true});
    }
    res.json({success:true,reviews:await getReviews()});
  } catch(e){console.error(e);res.status(500).json({success:false,message:'Review save failed.'});}
});
app.delete('/api/reviews/:id', async (req,res)=>{const r=await Review.deleteOne({id:normalizeId(req.params.id)});res.json({success:true,deleted:r.deletedCount||0});});

// Orders.
app.get('/api/orders', async (req,res)=>res.json({success:true,orders:await getOrders()}));
app.post('/api/orders', async (req,res)=>{
  try {
    const settings=await getSettings();
    if(!settings.ordersOpen) return res.status(409).json({success:false,code:'ORDERS_CLOSED',message:'Pre-orders are currently closed.'});
    const body=req.body||{}; const id=normalizeId(body.id||Date.now());
    const existing=await Order.findOne({id}); if(existing) return res.json({success:true,order:cleanDoc(existing),duplicate:true});
    const data={...body,id,status:body.status||'Order Confirmed',isLockedByAdmin:Boolean(body.isLockedByAdmin),createdAt:body.createdAt||new Date().toISOString()};
    const row=await Order.create({id,data,phone:data.phone,status:data.status,isLockedByAdmin:data.isLockedByAdmin,createdAt:new Date(data.createdAt)});
    res.status(201).json({success:true,order:cleanDoc(row)});
  }catch(e){console.error(e);res.status(500).json({success:false,message:'Order save failed.'});}
});
app.put('/api/orders/:id', async (req,res)=>{try{const id=normalizeId(req.params.id);const row=await Order.findOne({id});if(!row)return res.status(404).json({success:false,message:'Order not found.'});const data={...(row.data||{}),...(req.body||{}),id};row.data=data;row.phone=data.phone;row.status=data.status;row.isLockedByAdmin=data.isLockedByAdmin;await row.save();res.json({success:true,order:cleanDoc(row)});}catch(e){res.status(500).json({success:false,message:'Order update failed.'});}});
app.delete('/api/orders/:id', async (req,res)=>{const r=await Order.deleteOne({id:normalizeId(req.params.id)});if(!r.deletedCount)return res.status(404).json({success:false,message:'Order not found.'});res.json({success:true,message:'Order deleted.'});});

async function start(){
  if(!MONGODB_URI){ console.error('MONGODB_URI is missing. Add it in Render Environment Variables.'); process.exit(1); }
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await ensureDefaults();
  console.log('MongoDB connected');
  app.listen(PORT,()=>console.log(`SnackBox server running on port ${PORT}`));
}
start().catch(err=>{console.error('Startup failed:',err);process.exit(1);});
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
