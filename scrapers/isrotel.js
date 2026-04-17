const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Isrotel search results page:
//   https://www.isrotel.co.il/searchresult/?checkin=DD/MM/YYYY&checkout=DD/MM/YYYY&adults=N&children=N&hotel=CODE
// DOM uses "am-*" class prefix (e.g., am-room-dropdown-header, am-filter-*).
// Prices shown as "325\n₪" (per night per couple). Multiply by nights for total.

const HOTEL_CODES = {
  'sport club': 'SP',
  'ספורט קלאב': 'SP',
  'royal beach': 'RB',
  'רויאל ביץ': 'RB',
  'king solomon': 'KS',
  'המלך שלמה': 'KS',
  'laguna': 'LG',
  'לגונה': 'LG',
};

function findHotelCode(hotelName) {
  const lower = hotelName.toLowerCase();
  for (const [key, code] of Object.entries(HOTEL_CODES)) {
    if (lower.includes(key)) return code;
  }
  return null;
}

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function scrapeIsrotel({ hotelName, checkIn, checkOut, adults, children }) {
  const hotelCode = findHotelCode(hotelName) || 'SP';
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

  const checkinFormatted = formatDateDDMMYYYY(checkIn);
  const checkoutFormatted = formatDateDDMMYYYY(checkOut);

  const searchUrl = `https://www.isrotel.co.il/searchresult/?checkin=${checkinFormatted}&checkout=${checkoutFormatted}&adults=${adults}&children=${children}&hotel=${hotelCode}`;

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      console.log(`[isrotel] Navigating to search results: ${hotelCode}, ${checkinFormatted}-${checkoutFormatted}`);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      // Extract room prices from the search results page
      const results = await page.evaluate((nights) => {
        const rooms = [];

        // Strategy 1: Isrotel uses "am-*" class-prefixed elements
        const priceElements = document.querySelectorAll(
          '[class*="price"], [class*="Price"], [class*="rate"], [class*="cost"], ' +
          '[class*="am-"], [class*="room-result"], [class*="search-result"]'
        );

        const allPrices = [];

        priceElements.forEach(el => {
          const text = el.textContent || '';
          // Prices appear as "325\n₪" or "1,024 ₪" — match across whitespace/newlines
          const matches = text.match(/([\d,]+)\s*₪/g);
          if (matches) {
            matches.forEach(m => {
              const price = parseInt(m.replace(/[^\d]/g, ''));
              if (price > 50 && price < 100000) {
                allPrices.push(price);
              }
            });
          }
        });

        // Strategy 2: scan full body text for ₪ prices (handles newlines)
        if (allPrices.length === 0) {
          const bodyText = document.body.innerText;
          const bodyMatches = bodyText.match(/([\d,]+)\s*₪/g);
          if (bodyMatches) {
            bodyMatches.forEach(m => {
              const price = parseInt(m.replace(/[^\d]/g, ''));
              if (price > 200 && price < 100000) {
                allPrices.push(price);
              }
            });
          }
        }

        // Strategy 3: find room cards with name + price
        const cards = document.querySelectorAll(
          '[class*="room"], [class*="result"], [class*="card"], [class*="offer"], [class*="am-"]'
        );
        cards.forEach(card => {
          const cardText = card.textContent || '';
          const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4');
          const roomName = nameEl ? nameEl.textContent.trim() : '';

          const priceMatches = cardText.match(/([\d,]+)\s*₪/g);
          if (priceMatches && roomName) {
            const cardPrices = priceMatches.map(m => parseInt(m.replace(/[^\d]/g, '')))
              .filter(p => p > 200 && p < 100000);

            if (cardPrices.length > 0) {
              const finalPrice = Math.min(...cardPrices);
              rooms.push({ name: roomName, pricePerNight: finalPrice, totalPrice: finalPrice * nights });
            }
          }
        });

        // Deduplicate prices
        const uniquePrices = [...new Set(allPrices)].sort((a, b) => a - b);

        return { rooms, allPrices: uniquePrices };
      }, nights);

      // Check for explicit non-refundable markers
      const hasNonRefundable = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ללא ביטול') || text.includes('לא ניתן לביטול') || text.includes('non-refundable');
      });

      await closeBrowser(browser);

      // Isrotel's standard publicly-listed rates on their website include free cancellation.
      // The search results page does NOT display cancellation text — the policy is shown
      // only on the room detail/booking step.
      // We default to true (Isrotel's flexible rate policy) unless non-refundable markers found.
      const freeCancellation = !hasNonRefundable;

      // Filter to only our target hotel by matching the hotel code name.
      const targetKeywords = [];
      for (const [key, code] of Object.entries(HOTEL_CODES)) {
        if (code === hotelCode) targetKeywords.push(key);
      }

      const output = [];

      if (results.rooms.length > 0) {
        const targetRooms = results.rooms.filter(room => {
          const nameLower = room.name.toLowerCase();
          return targetKeywords.some(kw => nameLower.includes(kw));
        });

        console.log(`[isrotel] Found ${results.rooms.length} total rooms, ${targetRooms.length} match ${hotelCode}`);

        const roomsToUse = targetRooms.length > 0 ? targetRooms : [];

        const seen = new Set();
        for (const room of roomsToUse) {
          if (!seen.has(room.totalPrice)) {
            seen.add(room.totalPrice);
            output.push({
              source: 'isrotel.co.il',
              hotel: hotelName,
              prix_total: room.totalPrice,
              devise: 'ILS',
              free_cancellation: freeCancellation,
              lien_reservation: searchUrl,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Fallback: use sorted unique prices from the page
      if (output.length === 0 && results.allPrices.length > 0) {
        // Use per-night prices, pick lowest reasonable ones
        const reasonable = results.allPrices.filter(p => p >= 200);
        if (reasonable.length > 0) {
          // Return up to 3 price points (cheapest, median, most expensive)
          const indices = [0, Math.floor(reasonable.length / 2), reasonable.length - 1];
          const seen = new Set();
          for (const idx of indices) {
            const total = reasonable[idx] * nights;
            if (total > 500 && total < 200000 && !seen.has(total)) {
              seen.add(total);
              output.push({
                source: 'isrotel.co.il',
                hotel: hotelName,
                prix_total: total,
                devise: 'ILS',
                free_cancellation: freeCancellation,
                lien_reservation: searchUrl,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }

      return output;
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'isrotel.co.il' }) || [];
}

module.exports = { scrapeIsrotel };
