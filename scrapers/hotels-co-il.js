const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// hotels.co.il — ColdFusion-based Israeli hotel aggregator
// Direct hotel page: hotel.cfm?hotelid=738 (Isrotel Sport Club)
// Search results: results.cfm with date/guest params
// Reservation engine: res.hotels.co.il

const KNOWN_HOTELS = {
  'sport club': 738,
  'ספורט קלאב': 738,
  'isrotel sport': 738,
  'ישרוטל ספורט': 738,
};

function findHotelId(hotelName) {
  const lower = hotelName.toLowerCase();
  for (const [key, id] of Object.entries(KNOWN_HOTELS)) {
    if (lower.includes(key)) return id;
  }
  return null;
}

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function scrapeHotelsCoIl({ hotelName, checkIn, checkOut, adults, children }) {
  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      const hotelId = findHotelId(hotelName);
      const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

      // Intercept any API/AJAX responses that might contain prices
      const interceptedPrices = [];
      page.on('response', async (resp) => {
        const url = resp.url();
        if (url.includes('price') || url.includes('rate') || url.includes('avail') || url.includes('room') || url.includes('.cfm')) {
          try {
            const text = await resp.text();
            // Look for ILS prices in responses
            const matches = text.match(/(\d{1,3}(?:,\d{3})*)\s*(?:₪|ש"ח|ILS|NIS)/g);
            if (matches) {
              matches.forEach(m => {
                const num = parseInt(m.replace(/[^\d]/g, ''));
                if (num > 100 && num < 100000) interceptedPrices.push(num);
              });
            }
          } catch (e) {}
        }
      });

      // Strategy 1: Direct hotel page with hotelid
      if (hotelId) {
        const directUrl = `https://www.hotels.co.il/hotelsmain/hotels/hotel.cfm?hotelid=${hotelId}`;
        console.log(`[hotels.co.il] Navigating to direct hotel page: hotelid=${hotelId}`);
        await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Try to set dates in any date picker on the hotel page
        await page.evaluate((checkIn, checkOut, adults, children) => {
          // Look for date inputs by various selectors
          const allInputs = document.querySelectorAll('input');
          allInputs.forEach(input => {
            const id = (input.id || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            const ph = (input.placeholder || '').toLowerCase();
            if (id.includes('checkin') || name.includes('checkin') || name.includes('fromdate') ||
                ph.includes('כניסה') || ph.includes('הגעה') || ph.includes('check-in')) {
              input.value = checkIn;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (id.includes('checkout') || name.includes('checkout') || name.includes('todate') ||
                ph.includes('יציאה') || ph.includes('עזיבה') || ph.includes('check-out')) {
              input.value = checkOut;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          });
        }, checkIn, checkOut, adults, children);

        // Try clicking search/check availability button (wrapped in try-catch — some pages don't have clickable buttons)
        try {
          const searchBtn = await page.$('[type="submit"], .search-button, .btn-search, [class*="search"], [value*="חפש"], [value*="בדוק"]');
          if (searchBtn) {
            await Promise.race([
              searchBtn.click().then(() =>
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
              ),
              new Promise(r => setTimeout(r, 10000)),
            ]);
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (e) {
          console.log(`[hotels.co.il] Button click failed, continuing to results page`);
        }
      }

      // Strategy 2: Try submitting the booking form on the hotel page
      // The form action is booking_redirect.html — it may redirect to the hotel's booking engine
      if (hotelId) {
        try {
          await page.evaluate((checkIn, checkOut, adults, children) => {
            const form = document.querySelector('#booking_res');
            if (form) {
              // Fill hidden fields if they exist
              const inputs = form.querySelectorAll('input, select');
              inputs.forEach(input => {
                const name = (input.name || '').toLowerCase();
                if (name.includes('checkin') || name.includes('fromdate') || name.includes('arrival')) {
                  input.value = checkIn;
                }
                if (name.includes('checkout') || name.includes('todate') || name.includes('departure')) {
                  input.value = checkOut;
                }
                if (name.includes('adult')) input.value = String(adults);
                if (name.includes('child') || name.includes('kid')) input.value = String(children);
              });
              // Set select elements for guest counts
              const selects = form.querySelectorAll('select');
              selects.forEach(sel => {
                const name = (sel.name || sel.id || '').toLowerCase();
                if (name.includes('adult')) sel.value = String(adults);
                if (name.includes('child')) sel.value = String(children);
              });
            }
          }, checkIn, checkOut, adults, children);

          // Submit the form and follow redirect
          const submitBtn = await page.$('#booking_res [type="submit"], #booking_res button, #booking_res input[type="button"]');
          if (submitBtn) {
            await Promise.race([
              submitBtn.click().then(() =>
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
              ),
              new Promise(r => setTimeout(r, 15000)),
            ]);
            await new Promise(r => setTimeout(r, 5000));
          }
        } catch (e) {
          console.log(`[hotels.co.il] Form submission failed: ${e.message}`);
        }
      }

      // Extract prices from the page
      const results = await page.evaluate((targetHotel) => {
        const prices = [];
        const targetLower = targetHotel.toLowerCase();

        // Generic approach: find all elements that look like hotel listings
        const allElements = document.querySelectorAll('*');
        const priceRegex = /(\d{1,3}(?:,\d{3})*)\s*(?:₪|ש"ח)/;

        // Look for hotel cards/rows
        const cards = document.querySelectorAll(
          '[class*="hotel"], [class*="result"], [class*="item"], .hotelBox, .hotel-card, ' +
          'tr[class*="hotel"], div[class*="row"], [class*="listing"], [class*="deal"]'
        );

        cards.forEach(card => {
          const cardText = card.textContent || '';
          const nameParts = card.querySelectorAll('a, h2, h3, h4, [class*="name"], [class*="title"]');
          let hotelNameFound = '';
          nameParts.forEach(el => {
            const t = el.textContent.trim();
            if (t.length > 3 && t.length < 100) hotelNameFound = t;
          });

          const priceMatch = cardText.match(priceRegex);
          if (priceMatch) {
            const price = parseInt(priceMatch[1].replace(/,/g, ''));
            if (price > 100 && price < 100000) {
              const nameLower = (hotelNameFound + ' ' + cardText.substring(0, 200)).toLowerCase();
              const isMatch = nameLower.includes('sport') || nameLower.includes('ספורט') ||
                             nameLower.includes('isrotel') || nameLower.includes('ישרוטל');
              prices.push({ hotel: hotelNameFound || 'Unknown', price, match: isMatch });
            }
          }
        });

        // Fallback: scan ALL price-like elements on the page
        if (prices.length === 0) {
          const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"], [class*="cost"], [class*="rate"]');
          priceEls.forEach(el => {
            const text = el.textContent.trim();
            const match = text.match(/(\d{1,3}(?:,\d{3})*)\s*(?:₪|ש"ח)/);
            if (match) {
              const price = parseInt(match[1].replace(/,/g, ''));
              if (price > 100 && price < 100000) {
                prices.push({ hotel: targetHotel, price, match: true });
              }
            }
          });
        }

        // Also check for prices in plain text format (NIS number pattern)
        if (prices.length === 0) {
          const bodyText = document.body.innerText;
          const allMatches = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*₪/g);
          if (allMatches) {
            allMatches.forEach(m => {
              const price = parseInt(m.replace(/[^\d]/g, ''));
              if (price > 200 && price < 50000) {
                prices.push({ hotel: targetHotel, price, match: true });
              }
            });
          }
        }

        return prices;
      }, hotelName);

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') || text.includes('ביטול ללא');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Combine page prices with intercepted prices
      const allPrices = [...results];
      for (const p of interceptedPrices) {
        if (!allPrices.some(r => r.price === p)) {
          allPrices.push({ hotel: hotelName, price: p, match: true });
        }
      }

      // Prefer matched results
      const matched = allPrices.filter(r => r.match);
      const output = matched.length > 0 ? matched : allPrices.slice(0, 5);

      // Deduplicate by price
      const seen = new Set();
      const deduped = output.filter(r => {
        if (seen.has(r.price)) return false;
        seen.add(r.price);
        return true;
      });

      return deduped.map(r => ({
        source: 'hotels.co.il',
        hotel: r.hotel,
        prix_total: r.price,
        devise: 'ILS',
        free_cancellation: hasFreeCancel,
        lien_reservation: hotelId
          ? `https://www.hotels.co.il/hotelsmain/hotels/hotel.cfm?hotelid=${hotelId}`
          : pageUrl,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'hotels.co.il' }) || [];
}

module.exports = { scrapeHotelsCoIl };
