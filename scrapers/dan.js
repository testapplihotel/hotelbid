const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

async function scrapeDan({ hotelName, checkIn, checkOut, adults, children }) {
  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      const url = `https://www.danhotels.com/deals?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&children=${children}&destination=eilat`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      const results = await page.evaluate(() => {
        const prices = [];
        const priceElements = document.querySelectorAll('[class*="price"], [class*="Price"], [class*="rate"]');
        priceElements.forEach(el => {
          const text = el.textContent.replace(/[^\d.,]/g, '').replace(',', '');
          const price = parseFloat(text);
          if (price > 100 && price < 100000) {
            prices.push(price);
          }
        });
        return prices;
      });

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('free cancellation') || text.includes('ביטול חינם');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      if (results.length === 0) return [];
      const lowest = Math.min(...results);

      return [{
        source: 'danhotels.com',
        hotel: hotelName,
        prix_total: lowest,
        devise: 'ILS',
        free_cancellation: hasFreeCancel,
        lien_reservation: pageUrl,
        timestamp: new Date().toISOString(),
      }];
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'danhotels.com' }) || [];
}

module.exports = { scrapeDan };
