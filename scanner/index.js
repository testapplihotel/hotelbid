const cron = require('node-cron');
const { getDb } = require('../db/database');
const { scrapeAll, getBestPrice } = require('../scrapers');
const { attemptBooking } = require('../booking');

async function scanAlert(alert) {
  const db = getDb();
  console.log(`[scanner] Scanning alert #${alert.id}: ${alert.hotel_name} (${alert.check_in} → ${alert.check_out})`);

  const params = {
    hotelName: alert.hotel_name,
    checkIn: alert.check_in,
    checkOut: alert.check_out,
    adults: alert.adults,
    children: alert.children,
  };

  const scanStart = Date.now();
  const prices = await scrapeAll(params);
  const scanDuration = ((Date.now() - scanStart) / 1000).toFixed(1);

  // Log scan summary
  console.log(`\n[scanner] ===== SCAN SUMMARY for "${alert.hotel_name}" =====`);
  console.log(`[scanner] Duration: ${scanDuration}s | Results: ${prices.length} price(s)`);
  if (prices.length > 0) {
    prices.forEach(p => {
      const cancel = p.free_cancellation ? 'FREE CANCEL' : 'no cancel';
      console.log(`[scanner]   ${p.source.padEnd(20)} ${String(p.prix_total).padStart(6)} ILS  ${cancel}`);
    });
  } else {
    console.log('[scanner]   No prices found');
  }
  console.log(`[scanner] ==========================================\n`);

  // Save all prices to history
  const insertPrice = db.prepare(`
    INSERT INTO price_history (alert_id, source, price, free_cancellation, url, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const p of prices) {
    insertPrice.run(
      alert.id,
      p.source,
      p.prix_total,
      p.free_cancellation ? 1 : 0,
      p.lien_reservation,
      p.timestamp
    );
  }

  // Find best price with free cancellation
  const best = getBestPrice(prices, { freeCancellationOnly: true });

  if (best && best.prix_total <= alert.target_price) {
    console.log(`[scanner] MATCH! ${best.source}: ${best.prix_total} ILS <= target ${alert.target_price} ILS`);
    db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('price_found', alert.id);

    // Attempt booking
    await attemptBooking(alert, best);
  } else if (best) {
    console.log(`[scanner] Best price: ${best.prix_total} ILS from ${best.source} (target: ${alert.target_price} ILS)`);
  } else {
    console.log(`[scanner] No prices with free cancellation found`);
  }

  return { prices, best };
}

async function scanAllAlerts() {
  const db = getDb();
  const alerts = db.prepare("SELECT * FROM alerts WHERE status = 'watching' OR status = 'price_found'").all();

  if (alerts.length === 0) {
    console.log('[scanner] No active alerts to scan');
    return;
  }

  console.log(`[scanner] Scanning ${alerts.length} active alert(s)...`);
  const cycleStart = Date.now();

  for (const alert of alerts) {
    try {
      await scanAlert(alert);
    } catch (err) {
      console.error(`[scanner] Error scanning alert #${alert.id}:`, err.message);
    }
  }

  const cycleDuration = ((Date.now() - cycleStart) / 1000).toFixed(1);
  console.log(`[scanner] Cycle complete — ${alerts.length} alert(s) scanned in ${cycleDuration}s`);
}

function startCron() {
  // Run every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    console.log('[scanner] Cron triggered — starting scan cycle');
    await scanAllAlerts();
  });
  console.log('[scanner] Cron scheduler started — scanning every 2 hours');
}

module.exports = { scanAlert, scanAllAlerts, startCron };
