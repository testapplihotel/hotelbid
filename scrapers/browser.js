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
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${token}`,
    });
    return browser;
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
  const token = process.env.BROWSERLESS_KEY;
  if (token) {
    browser.disconnect();
  } else {
    await browser.close();
  }
}

module.exports = { getBrowser, closeBrowser };
