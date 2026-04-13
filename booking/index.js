const { getDb } = require('../db/database');
const { sendBookingConfirmation } = require('../mailer');

async function attemptBooking(alert, priceResult) {
  const db = getDb();

  console.log(`[booking] Attempting booking for alert #${alert.id}`);
  console.log(`[booking] Source: ${priceResult.source}, Price: ${priceResult.prix_total} ILS`);

  // Verify free cancellation
  if (!priceResult.free_cancellation) {
    console.log('[booking] ABORT — no free cancellation on this offer');
    return { success: false, reason: 'no_free_cancellation' };
  }

  // Verify price is still below target
  if (priceResult.prix_total > alert.target_price) {
    console.log(`[booking] ABORT — price ${priceResult.prix_total} > target ${alert.target_price}`);
    return { success: false, reason: 'price_above_target' };
  }

  // Record the booking
  const result = db.prepare(`
    INSERT INTO bookings (alert_id, source, price, url, confirmation_status)
    VALUES (?, ?, ?, ?, 'confirmed')
  `).run(alert.id, priceResult.source, priceResult.prix_total, priceResult.lien_reservation);

  // Update alert status
  db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('booked', alert.id);

  console.log(`[booking] Booking #${result.lastInsertRowid} created — redirecting user to: ${priceResult.lien_reservation}`);

  // Send email notification
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(alert.user_id);
  if (user) {
    await sendBookingConfirmation(user, alert, {
      price: priceResult.prix_total,
      source: priceResult.source,
      url: priceResult.lien_reservation,
    });
  }

  return {
    success: true,
    bookingId: result.lastInsertRowid,
    url: priceResult.lien_reservation,
    price: priceResult.prix_total,
    source: priceResult.source,
  };
}

module.exports = { attemptBooking };
