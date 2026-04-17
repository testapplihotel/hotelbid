const puppeteer = require('puppeteer');

/**
 * Returns a Puppeteer browser instance.
 * - If BROWSERLESS_KEY is set, connects to Browserless.io (cloud browser).
 * - Otherwise, launches a local Chromium instance.
 *
 * Each call returns a fresh browser. The caller should call closeBrowser()
 * when done to properly disconnect or close.
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
      console.warn('[browser] Falling back to local Chromium...');
      return puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
  }
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

/**
 * Properly closes/disconnects the browser.
 * - Browserless connections should use disconnect() to release the session
 *   without killing the remote browser process.
 * - Local browsers should use close().
 */
async function closeBrowser(browser) {
  try {
    // Check if this is a remote (Browserless) or local browser
    // Remote browsers have a wsEndpoint containing 'browserless'
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
