// Use puppeteer-core in production (no bundled Chromium — uses Browserless.io)
// Falls back to full puppeteer locally if available
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('puppeteer');
}

/**
 * Returns a Puppeteer browser instance.
 * - If BROWSERLESS_KEY is set, connects to Browserless.io (cloud browser).
 * - Otherwise, launches a local Chromium instance (dev only).
 */
async function getBrowser() {
  const token = process.env.BROWSERLESS_KEY;
  if (token) {
    try {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `wss://chrome.browserless.io?token=${token}`,
      });
      return browser;
    } catch (err) {
      console.warn(`[browser] Browserless.io connection failed: ${err.message}`);
      // In production, no local Chromium available — rethrow
      if (process.env.NODE_ENV === 'production') throw err;
      console.warn('[browser] Falling back to local Chromium...');
    }
  }
  // Local dev fallback — requires full puppeteer or system Chromium
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.CHROME_PATH || undefined,
  });
}

/**
 * Properly closes/disconnects the browser.
 */
async function closeBrowser(browser) {
  try {
    const wsEndpoint = browser.wsEndpoint?.() || '';
    if (wsEndpoint.includes('browserless')) {
      browser.disconnect();
    } else {
      await browser.close();
    }
  } catch {
    // Browser may already be closed/disconnected
  }
}

module.exports = { getBrowser, closeBrowser };
