const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

async function scrapeTravelist({ hotelName, checkIn, checkOut, adults, children }) {
  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      const searchQuery = encodeURIComponent(hotelName);
      const url = `https://www.travelist.co.il/search?q=${searchQuery}&checkin=${checkIn}&checkout=${checkOut}&adults=${adults}&children=${children}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      const results = await page.evaluate(() => {
        const prices = [];
        const cards = document.querySelectorAll('[class*="deal"], [class*="result"], [class*="card"], [class*="package"]');
        cards.forEach(card => {
          const titleEl = card.querySelector('[class*="title"], [class*="name"], h2, h3');
          const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
          if (titleEl && priceEl) {
            const title = titleEl.textContent.trim();
            const priceText = priceEl.textContent.replace(/[^\d.,]/g, '').replace(',', '');
            const price = parseFloat(priceText);
            if (price > 100 && price < 100000) {
              prices.push({ hotel: title, price });
            }
          }
        });
        return prices;
      });

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      return results.map(r => ({
        source: 'travelist.co.il',
        hotel: r.hotel,
        prix_total: r.price,
        devise: 'ILS',
        free_cancellation: hasFreeCancel,
        lien_reservation: pageUrl,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'travelist.co.il' }) || [];
}

module.exports = { scrapeTravelist };
