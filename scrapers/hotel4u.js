const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Hotel4U (hotel4u.co.il) — ASP.NET site
// Uses CheckSearch() function, guest format: "a2a,10,8" (2 adults, kids ages 10,8)
// Search goes to SearchAnswerbar.asp or hoteleilat.asp
// Direct hotel pages: /hotel/[hotel-name].asp

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function scrapeHotel4u({ hotelName, checkIn, checkOut, adults, children }) {
  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      // Go to Eilat hotels page
      const url = 'https://www.hotel4u.co.il/hoteleilat.asp';
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      // Try to fill and submit the search form
      await page.evaluate((checkIn, checkOut, adults, children) => {
        // Set date inputs
        const dateInputs = document.querySelectorAll('input[type="text"], input[name*="date"], input[id*="date"]');
        dateInputs.forEach(input => {
          const name = (input.name || input.id || '').toLowerCase();
          if (name.includes('checkin') || name.includes('date-range200') || name.includes('from')) {
            input.value = checkIn;
          }
          if (name.includes('checkout') || name.includes('date-range201') || name.includes('to')) {
            input.value = checkOut;
          }
        });

        // Set guest counts via select elements
        const selects = document.querySelectorAll('select');
        selects.forEach(sel => {
          const name = (sel.name || sel.id || '').toLowerCase();
          if (name.includes('adult')) sel.value = String(adults);
          if (name.includes('child') || name.includes('kid')) sel.value = String(children);
        });
      }, formatDateDDMMYYYY(checkIn), formatDateDDMMYYYY(checkOut), adults, children);

      // Submit search
      const searchBtn = await page.$('input[type="submit"], button[type="submit"], .btn-search, [onclick*="CheckSearch"]');
      if (searchBtn) {
        await searchBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      }

      await new Promise(r => setTimeout(r, 5000));

      const results = await page.evaluate((targetHotel) => {
        const prices = [];
        const targetLower = targetHotel.toLowerCase();

        // Hotel4U shows deal cards
        const cards = document.querySelectorAll('[class*="deal"], [class*="hotel"], [class*="item"], [class*="result"], [class*="card"], .offer, .deal');
        cards.forEach(card => {
          const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4, a[class*="title"]');
          const priceEl = card.querySelector('[class*="price"], [class*="Price"], [class*="cost"]');
          if (priceEl) {
            const name = nameEl ? nameEl.textContent.trim() : '';
            const priceText = priceEl.textContent.replace(/[^\d.,]/g, '').replace(',', '');
            const price = parseFloat(priceText);
            if (price > 50 && price < 100000) {
              const nameLower = name.toLowerCase();
              const isMatch = nameLower.includes('sport') || nameLower.includes('ספורט') ||
                             nameLower.includes('isrotel') || nameLower.includes('ישרוטל');
              prices.push({ hotel: name, price, match: isMatch });
            }
          }
        });

        return prices;
      }, hotelName);

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      const matched = results.filter(r => r.match);
      const output = matched.length > 0 ? matched : results.slice(0, 5);

      return output.map(r => ({
        source: 'hotel4u.co.il',
        hotel: r.hotel || hotelName,
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
  }, { source: 'hotel4u.co.il' }) || [];
}

module.exports = { scrapeHotel4u };
