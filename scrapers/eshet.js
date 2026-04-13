const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Eshet Tours (eshet.com) — Next.js SPA, major Israeli OTA
// The Eilat page shows promotional deal cards for various hotels.
// Each promo card has: hotel name, price (per night per couple), dates, meal plan.
// Card class pattern: _desktop-module__promo-*
// We need to find the parent card, extract hotel name, and only keep Sport Club matches.

async function scrapeEshet({ hotelName, checkIn, checkOut, adults, children }) {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      // Intercept Next.js data responses
      const apiResults = [];
      page.on('response', async (response) => {
        const url = response.url();
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json') && (url.includes('_next/data') || url.includes('api'))) {
            const json = await response.json();
            apiResults.push({ url, data: json });
          }
        } catch (e) {}
      });

      console.log(`[eshet] Navigating to Eilat hotels page`);
      await page.goto('https://www.eshet.com/domestichotels/eilat', {
        waitUntil: 'networkidle2', timeout: 30000
      });
      await new Promise(r => setTimeout(r, 5000));

      // Extract promotional cards with hotel name matching
      const results = await page.evaluate((targetHotel, nights) => {
        const prices = [];
        const targetLower = targetHotel.toLowerCase();

        // Get the full page text and split into sections by looking for promo containers
        // Each promo card parent contains: hotel name + price + dates + meal plan
        const promoContainers = document.querySelectorAll('[class*="promo-price-container"]');

        promoContainers.forEach(container => {
          // Walk up to find the parent card that contains the hotel name
          let parent = container;
          for (let i = 0; i < 10 && parent.parentElement; i++) {
            parent = parent.parentElement;
            // Check if this parent contains hotel identification
            const text = parent.textContent || '';
            if (text.length > 200 && text.length < 2000) break;
          }

          const cardText = parent.textContent || '';
          const cardLower = cardText.toLowerCase();

          // Check if this card is for our target hotel
          const isMatch = cardLower.includes('sport') || cardLower.includes('ספורט קלאב') ||
                         (cardLower.includes('ישרוטל') && cardLower.includes('ספורט'));

          // Extract price from the promo container
          const priceEl = container.querySelector('[class*="promo-price___"]');
          if (priceEl) {
            const priceText = priceEl.textContent.replace(/[^\d]/g, '');
            const pricePerNight = parseInt(priceText);
            if (pricePerNight > 100 && pricePerNight < 10000) {
              // These are per-night per-couple prices
              const hotelName = cardText.substring(0, 100).trim().split('\n')[0] || 'Eshet Deal';
              prices.push({
                hotel: hotelName,
                pricePerNight,
                totalPrice: pricePerNight * nights,
                match: isMatch,
                context: cardText.substring(0, 200),
              });
            }
          }
        });

        // Also check for any specific Sport Club links/sections on the page
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(link => {
          const href = link.href || '';
          const text = link.textContent || '';
          if ((text.includes('ספורט קלאב') || text.includes('Sport Club') || href.includes('sport-club')) &&
              !prices.some(p => p.match)) {
            // Found a Sport Club link — extract nearby prices
            const parent = link.closest('[class*="card"], [class*="item"], [class*="deal"], section, article') || link.parentElement;
            if (parent) {
              const priceMatch = parent.textContent.match(/(\d{1,3}(?:,\d{3})*)\s*₪/);
              if (priceMatch) {
                const price = parseInt(priceMatch[1].replace(/,/g, ''));
                if (price > 100) {
                  prices.push({
                    hotel: 'ישרוטל ספורט קלאב',
                    pricePerNight: price,
                    totalPrice: price * nights,
                    match: true,
                    context: parent.textContent.substring(0, 200),
                  });
                }
              }
            }
          }
        });

        return prices;
      }, hotelName, nights);

      // Check API responses for hotel data
      let apiPrices = [];
      for (const { data } of apiResults) {
        const found = extractPricesFromJson(data, hotelName, nights);
        apiPrices.push(...found);
      }

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') || text.includes('ביטול ללא עלות');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Combine page and API results, prefer matched
      const allResults = [...results, ...apiPrices];
      const matched = allResults.filter(r => r.match);
      const output = matched.length > 0 ? matched : [];

      // Deduplicate by total price
      const seen = new Set();
      const deduped = output.filter(r => {
        const key = r.totalPrice || r.price;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return deduped.map(r => ({
        source: 'eshet.com',
        hotel: r.hotel || hotelName,
        prix_total: r.totalPrice || r.price,
        devise: 'ILS',
        free_cancellation: hasFreeCancel,
        lien_reservation: pageUrl,
        timestamp: new Date().toISOString(),
        _note: 'promotional price, may not match exact dates',
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'eshet.com' }) || [];
}

function extractPricesFromJson(data, targetHotel, nights) {
  const results = [];
  const targetLower = targetHotel.toLowerCase();

  function traverse(obj, depth = 0) {
    if (depth > 8 || !obj || typeof obj !== 'object') return;

    const name = obj.name || obj.hotelName || obj.title || obj.hotel_name || '';
    const nameLower = (typeof name === 'string' ? name : '').toLowerCase();
    const isMatch = nameLower.includes('sport') || nameLower.includes('ספורט') ||
                   (nameLower.includes('ישרוטל') && nameLower.includes('ספורט'));

    if (isMatch) {
      const price = obj.price || obj.totalPrice || obj.total_price || obj.rate || 0;
      if (typeof price === 'number' && price > 100) {
        results.push({ hotel: name, price, totalPrice: price > 5000 ? price : price * nights, match: true });
      }
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => traverse(item, depth + 1));
    } else {
      Object.values(obj).forEach(val => {
        if (typeof val === 'object' && val !== null) traverse(val, depth + 1);
      });
    }
  }

  traverse(data);
  return results;
}

module.exports = { scrapeEshet };
