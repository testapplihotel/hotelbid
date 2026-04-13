const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Isrotel search results page:
//   https://www.isrotel.co.il/searchresult/?checkin=DD/MM/YYYY&checkout=DD/MM/YYYY&adults=N&children=N&hotel=CODE
// This returns server-rendered HTML with room prices (per night per couple).
// The page also lazy-loads more rooms via searchPopularRooms() JS function.

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

        // Look for room/price cards — Isrotel uses price elements with ₪
        // Pattern from screenshot: "17,373 ← 16,459 ₪" (original ← discounted)
        // or just "1,024 ₪"
        const priceElements = document.querySelectorAll(
          '[class*="price"], [class*="Price"], [class*="rate"], [class*="cost"], ' +
          '[class*="room-result"], [class*="search-result"], [class*="result-item"]'
        );

        const allPrices = [];

        priceElements.forEach(el => {
          const text = el.textContent || '';
          // Find all ₪ prices in this element
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

        // Also scan the full page body for prices
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

        // Find room cards with name + price
        const cards = document.querySelectorAll(
          '[class*="room"], [class*="result"], [class*="card"], [class*="offer"]'
        );
        cards.forEach(card => {
          const cardText = card.textContent || '';
          const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4');
          const roomName = nameEl ? nameEl.textContent.trim() : '';

          // Find the discounted/final price (usually the last ₪ price or the highlighted one)
          const priceMatches = cardText.match(/([\d,]+)\s*₪/g);
          if (priceMatches && roomName) {
            // If multiple prices, the last or smallest is typically the discounted price
            const cardPrices = priceMatches.map(m => parseInt(m.replace(/[^\d]/g, '')))
              .filter(p => p > 200 && p < 100000);

            if (cardPrices.length > 0) {
              // The actual price is usually the smaller one (discounted)
              const finalPrice = Math.min(...cardPrices);
              rooms.push({ name: roomName, pricePerNight: finalPrice, totalPrice: finalPrice * nights });
            }
          }
        });

        // Deduplicate prices
        const uniquePrices = [...new Set(allPrices)].sort((a, b) => a - b);

        return { rooms, allPrices: uniquePrices };
      }, nights);

      // Check for free cancellation
      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') || text.includes('ביטול ללא');
      });

      await closeBrowser(browser);

      // The search results page shows ALL Isrotel hotels.
      // Filter to only our target hotel by matching the hotel code name.
      const targetKeywords = [];
      for (const [key, code] of Object.entries(HOTEL_CODES)) {
        if (code === hotelCode) targetKeywords.push(key);
      }

      const output = [];

      if (results.rooms.length > 0) {
        // Filter rooms to only our target hotel
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
              free_cancellation: hasFreeCancel,
              lien_reservation: searchUrl,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // If we didn't find specific room matches, the raw prices may include our hotel
      if (output.length === 0 && results.allPrices.length > 0) {
        // Use the median price as a reasonable estimate
        const mid = Math.floor(results.allPrices.length / 2);
        const total = results.allPrices[mid] * nights;
        if (total > 500 && total < 200000) {
          output.push({
            source: 'isrotel.co.il',
            hotel: hotelName,
            prix_total: total,
            devise: 'ILS',
            free_cancellation: hasFreeCancel,
            lien_reservation: searchUrl,
            timestamp: new Date().toISOString(),
            _note: 'estimated from search results page',
          });
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
