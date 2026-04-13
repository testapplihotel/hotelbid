const { getDb } = require('../db/database');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, { maxRetries = 3, baseDelay = 2000, source = 'unknown' } = {}) {
  const db = getDb();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      db.prepare('INSERT INTO scraper_logs (source, success, duration_ms) VALUES (?, 1, ?)').run(source, duration);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      db.prepare('INSERT INTO scraper_logs (source, success, duration_ms, error_message) VALUES (?, 0, ?, ?)').run(source, duration, err.message);
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[${source}] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${err.message}`);
        await sleep(delay);
      } else {
        console.error(`[${source}] All ${maxRetries + 1} attempts failed: ${err.message}`);
        return null;
      }
    }
  }
}

function isSourceDown(source, thresholdHours = 2) {
  const db = getDb();
  const since = new Date(Date.now() - thresholdHours * 3600 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as total, SUM(success) as successes
    FROM scraper_logs WHERE source = ? AND logged_at > ?
  `).get(source, since);
  return row.total > 0 && row.successes === 0;
}

module.exports = { randomUserAgent, withRetry, isSourceDown, sleep, USER_AGENTS };
