const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Isrotel search results page:
//   https://www.isrotel.co.il/searchresult/?checkin=DD/MM/YYYY&checkout=DD/MM/YYYY&adults=N&children=N&hotel=CODE
//
// IMPORTANT: The search results page may show promotional deals for OTHER dates
// and OTHER hotels instead of (or alongside) actual results. The scraper must:
//   1. Verify that prices belong to the REQUESTED dates, not promo dates
//   2. Verify that the hotel shown matches the target hotel
//   3. Reject any card showing dates outside the search range

const HOTEL_CODES = {
  'sport club': 'SP',
  'ספורט קלאב': 'SP',
  'royal beach': 'RB',
  'רויאל ביץ': 'RB',
  'king solomon': 'KS',
  'המלך שלמה': 'KS',
  'laguna': 'LG',
  'לגונה': 'LG',
  'riviera': 'RV',
  'ריביירה': 'RV',
  'dead sea': 'DS',
  'ים המלח': 'DS',
};

const HOTEL_NAMES_HE = {
  'SP': ['ספורט קלאב', 'sport club'],
  'RB': ['רויאל ביץ', 'royal beach'],
  'KS': ['המלך שלמה', 'king solomon'],
  'LG': ['לגונה', 'laguna'],
  'RV': ['ריביירה', 'riviera'],
  'DS': ['ים המלח', 'dead sea'],
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

  // Extract target month/year for date validation
  const targetCheckIn = new Date(checkIn);
  const targetCheckOut = new Date(checkOut);
  const targetMonth = targetCheckIn.getMonth() + 1; // 1-12
  const targetYear = targetCheckIn.getFullYear();

  const searchUrl = `https://www.isrotel.co.il/searchresult/?checkin=${checkinFormatted}&checkout=${checkoutFormatted}&adults=${adults}&children=${children}&hotel=${hotelCode}`;

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      console.log(`[isrotel] Navigating: ${hotelCode}, ${checkinFormatted}-${checkoutFormatted} (${nights} nights)`);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      // Extract results with strict date and hotel validation
      const targetHotelNames = HOTEL_NAMES_HE[hotelCode] || [];
      const results = await page.evaluate((args) => {
        const { nights, targetMonth, targetYear, targetHotelNames, hotelCode } = args;

        // Helper: parse date strings like "18.04.26", "18/04/2026", "01.08.2026"
        function parseDateFromText(text) {
          // Match DD.MM.YY or DD.MM.YYYY or DD/MM/YY or DD/MM/YYYY
          const datePatterns = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/g);
          if (!datePatterns) return [];
          return datePatterns.map(d => {
            const parts = d.split(/[./]/);
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            let year = parseInt(parts[2]);
            if (year < 100) year += 2000;
            return { day, month, year, raw: d };
          });
        }

        // Helper: check if a hotel name in text matches our target
        function isTargetHotel(text) {
          const lower = text.toLowerCase();
          return targetHotelNames.some(name => lower.includes(name.toLowerCase()));
        }

        // Scan all card-like containers on the page
        const allCards = document.querySelectorAll(
          '[class*="result"], [class*="card"], [class*="offer"], [class*="room"], ' +
          '[class*="deal"], [class*="package"], [class*="am-"]'
        );

        const validResults = [];
        const debugInfo = [];

        allCards.forEach(card => {
          const cardText = card.textContent || '';
          if (cardText.length < 20 || cardText.length > 5000) return;

          // Extract price
          const priceMatches = cardText.match(/([\d,]+)\s*₪/g);
          if (!priceMatches) return;

          // Extract dates from this card
          const dates = parseDateFromText(cardText);

          // Check if any date in this card matches our target month
          const hasCorrectDates = dates.length === 0 || dates.some(d =>
            d.month === targetMonth && d.year === targetYear
          );

          // Check if dates are WRONG (showing a different month)
          const hasWrongDates = dates.length > 0 && dates.every(d =>
            d.month !== targetMonth || d.year !== targetYear
          );

          // Extract hotel/room name
          const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="title"]');
          const cardName = nameEl ? nameEl.textContent.trim() : '';

          // Get prices
          const prices = priceMatches
            .map(m => parseInt(m.replace(/[^\d]/g, '')))
            .filter(p => p > 50 && p < 100000);

          if (prices.length === 0) return;

          debugInfo.push({
            name: cardName.substring(0, 60),
            prices,
            dates: dates.map(d => d.raw),
            hasCorrectDates,
            hasWrongDates,
            isTarget: isTargetHotel(cardText),
          });

          // REJECT if dates are clearly wrong (different month/year)
          if (hasWrongDates) return;

          // Accept if hotel matches OR if no hotel filter needed (single hotel search)
          const minPrice = Math.min(...prices);
          validResults.push({
            name: cardName,
            pricePerNight: minPrice,
            totalPrice: minPrice * nights,
            isTarget: isTargetHotel(cardText),
          });
        });

        return { validResults, debugInfo };
      }, { nights, targetMonth, targetYear, targetHotelNames, hotelCode });

      console.log(`[isrotel] Debug — ${results.debugInfo.length} cards scanned:`);
      results.debugInfo.forEach(d => {
        const dateStr = d.dates.length > 0 ? `dates=[${d.dates.join(',')}]` : 'no dates';
        const flag = d.hasWrongDates ? 'WRONG_DATES' : (d.hasCorrectDates ? 'OK' : 'no_dates');
        console.log(`[isrotel]   "${d.name}" prices=${d.prices} ${dateStr} ${flag} target=${d.isTarget}`);
      });

      // Check for non-refundable markers
      const hasNonRefundable = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ללא ביטול') || text.includes('לא ניתן לביטול') || text.includes('non-refundable');
      });

      await closeBrowser(browser);

      const freeCancellation = !hasNonRefundable;

      // Filter: prefer results that match our target hotel
      let validRooms = results.validResults.filter(r => r.isTarget);

      // If no hotel-specific matches, use all valid (date-filtered) results
      if (validRooms.length === 0) {
        validRooms = results.validResults;
      }

      if (validRooms.length === 0) {
        console.log(`[isrotel] No valid prices for ${hotelCode} in ${targetMonth}/${targetYear}`);
        return [];
      }

      // Deduplicate and return
      const seen = new Set();
      const output = [];
      for (const room of validRooms) {
        if (!seen.has(room.totalPrice) && room.totalPrice > 500) {
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

      console.log(`[isrotel] Returning ${output.length} validated price(s) for ${targetMonth}/${targetYear}`);
      return output;
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'isrotel.co.il' }) || [];
}

module.exports = { scrapeIsrotel };
