const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

async function scrapeFattal({ hotelName, checkIn, checkOut, adults, children }) {
  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      // Fattal uses a search/booking engine
      const url = `https://www.fattal.co.il/searchroom?checkin=${checkIn}&checkout=${checkOut}&adults=${adults}&children=${children}&hotel=eilat`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      const results = await page.evaluate((targetHotel) => {
        const prices = [];
        // Look for hotel cards/results with prices
        const cards = document.querySelectorAll('[class*="hotel"], [class*="room"], [class*="result"]');
        cards.forEach(card => {
          const name = card.querySelector('[class*="name"], [class*="title"], h2, h3');
          const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
          if (name && priceEl) {
            const hotelText = name.textContent.trim();
            const priceText = priceEl.textContent.replace(/[^\d.,]/g, '').replace(',', '');
            const price = parseFloat(priceText);
            if (price > 100) {
              prices.push({ hotel: hotelText, price });
            }
          }
        });

        // Fallback: look for any price on page
        if (prices.length === 0) {
          const allPrices = document.querySelectorAll('[class*="price"], [class*="Price"]');
          allPrices.forEach(el => {
            const text = el.textContent.replace(/[^\d.,]/g, '').replace(',', '');
            const price = parseFloat(text);
            if (price > 100 && price < 100000) {
              prices.push({ hotel: targetHotel, price });
            }
          });
        }
        return prices;
      }, hotelName);

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('free cancellation') || text.includes('ביטול חינם') || text.includes('ביטול ללא');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      return results.map(r => ({
        source: 'fattal.co.il',
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
  }, { source: 'fattal.co.il' }) || [];
}

module.exports = { scrapeFattal };
