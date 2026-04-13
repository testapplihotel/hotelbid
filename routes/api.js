const express = require('express');
const path = require('path');
const { getDb } = require('../db/database');
const { scanAlert } = require('../scanner');

const hotels = require(path.join(__dirname, '..', 'data', 'hotels.json'));

const router = express.Router();

// GET /api/alerts — list all alerts
router.get('/alerts', (req, res) => {
  const db = getDb();
  const alerts = db.prepare(`
    SELECT a.*, u.email, u.name as user_name
    FROM alerts a JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
  `).all();
  res.json(alerts);
});

// POST /api/alerts — create alert
router.post('/alerts', (req, res) => {
  const db = getDb();
  const { hotel_name, destination, check_in, check_out, adults, children, target_price, user_email } = req.body;

  if (!hotel_name || !check_in || !check_out || !target_price) {
    return res.status(400).json({ error: 'Missing required fields: hotel_name, check_in, check_out, target_price' });
  }

  // Get or create user
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(user_email || 'test@hotelbid.com');
  if (!user) {
    const result = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(user_email, user_email.split('@')[0]);
    user = { id: result.lastInsertRowid };
  }

  const result = db.prepare(`
    INSERT INTO alerts (user_id, hotel_name, destination, check_in, check_out, adults, children, target_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, hotel_name, destination || '', check_in, check_out, adults || 2, children || 0, target_price);

  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(alert);
});

// GET /api/alerts/:id
router.get('/alerts/:id', (req, res) => {
  const db = getDb();
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json(alert);
});

// PUT /api/alerts/:id
router.put('/alerts/:id', (req, res) => {
  const db = getDb();
  const { hotel_name, destination, check_in, check_out, adults, children, target_price, status } = req.body;
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  db.prepare(`
    UPDATE alerts SET hotel_name = ?, destination = ?, check_in = ?, check_out = ?,
    adults = ?, children = ?, target_price = ?, status = ? WHERE id = ?
  `).run(
    hotel_name || alert.hotel_name,
    destination || alert.destination,
    check_in || alert.check_in,
    check_out || alert.check_out,
    adults ?? alert.adults,
    children ?? alert.children,
    target_price || alert.target_price,
    status || alert.status,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/alerts/:id
router.delete('/alerts/:id', (req, res) => {
  const db = getDb();
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  db.prepare('DELETE FROM price_history WHERE alert_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bookings WHERE alert_id = ?').run(req.params.id);
  db.prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// GET /api/alerts/:id/prices — price history
router.get('/alerts/:id/prices', (req, res) => {
  const db = getDb();
  const prices = db.prepare(`
    SELECT * FROM price_history WHERE alert_id = ? ORDER BY scraped_at DESC
  `).all(req.params.id);
  res.json(prices);
});

// GET /api/bookings
router.get('/bookings', (req, res) => {
  const db = getDb();
  const bookings = db.prepare(`
    SELECT b.*, a.hotel_name, a.check_in, a.check_out, a.adults, a.children, a.target_price
    FROM bookings b JOIN alerts a ON b.alert_id = a.id
    ORDER BY b.booked_at DESC
  `).all();
  res.json(bookings);
});

// POST /api/scan/:alertId — manual scan trigger
router.post('/scan/:alertId', async (req, res) => {
  const db = getDb();
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.alertId);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  try {
    const result = await scanAlert(alert);
    res.json({
      alert_id: alert.id,
      prices_found: result.prices.length,
      best_price: result.best,
      prices: result.prices,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scraper-status — check which scrapers are up/down
router.get('/scraper-status', (req, res) => {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const stats = db.prepare(`
    SELECT source,
      COUNT(*) as total_calls,
      SUM(success) as successes,
      ROUND(AVG(duration_ms)) as avg_duration_ms,
      MAX(logged_at) as last_call
    FROM scraper_logs
    WHERE logged_at > ?
    GROUP BY source
  `).all(since);
  res.json(stats);
});

// GET /api/hotels?q=term — hotel autocomplete
router.get('/hotels', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  const results = hotels.filter(h =>
    h.name.toLowerCase().includes(q) ||
    h.nameHe.includes(q) ||
    h.chain.toLowerCase().includes(q) ||
    h.destination.toLowerCase().includes(q)
  ).slice(0, 12);

  res.json(results);
});

module.exports = router;
