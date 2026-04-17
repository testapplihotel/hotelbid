const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Eshet Tours (eshet.com) — Israeli OTA
// The Eilat page shows promotional deal cards.
// CRITICAL: This page does NOT accept date parameters — it shows current promos.
// We MUST extract dates from each deal card and validate against the target dates.

function isHotelMatch(text, hotelName) {
  const lower = text.toLowerCase();
  const targetLower = hotelName.toLowerCase();

  if (targetLower.includes('sport club') || targetLower.includes('ספורט קלאב')) {
    return lower.includes('sport club') || lower.includes('ספורט קלאב');
  }
  if (targetLower.includes('royal beach') || targetLower.includes('רויאל ביץ')) {
    return lower.includes('royal beach') || lower.includes('רויאל ביץ');
  }
  if (targetLower.includes('king solomon') || targetLower.includes('המלך שלמה')) {
    return lower.includes('king solomon') || lower.includes('המלך שלמה');
  }
  if (targetLower.includes('laguna') || targetLower.includes('לגונה')) {
    return lower.includes('laguna') || lower.includes('לגונה');
  }

  const significantWords = targetLower
    .replace(/hotel|resort|eilat|אילת|ישרוטל|isrotel/gi, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (significantWords.length === 0) return false;
  const matchCount = significantWords.filter(w => lower.includes(w)).length;
  return matchCount >= Math.max(1, Math.ceil(significantWords.length * 0.6));
}

// Check if a deal's dates overlap with the target date range
function datesOverlap(dealDates, targetCheckIn, targetCheckOut) {
  if (dealDates.length < 2) return false;

  // Sort dates chronologically
  const sorted = dealDates.sort((a, b) => {
    const da = new Date(a.year, a.month - 1, a.day);
    const db = new Date(b.year, b.month - 1, b.day);
    return da - db;
  });

  const dealStart = new Date(sorted[0].year, sorted[0].month - 1, sorted[0].day);
  const dealEnd = new Date(sorted[sorted.length - 1].year, sorted[sorted.length - 1].month - 1, sorted[sorted.length - 1].day);

  // Deal must overlap with our target range
  return dealStart <= targetCheckOut && dealEnd >= targetCheckIn;
}

async function scrapeEshet({ hotelName, checkIn, checkOut, adults, children }) {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));
  const targetCheckIn = new Date(checkIn);
  const targetCheckOut = new Date(checkOut);
  const targetMonth = targetCheckIn.getMonth() + 1;
  const targetYear = targetCheckIn.getFullYear();

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      console.log(`[eshet] Navigating to Eilat hotels page`);
      await page.goto('https://www.eshet.com/domestichotels/eilat', {
        waitUntil: 'networkidle2', timeout: 30000
      });
      await new Promise(r => setTimeout(r, 5000));

      // Extract deal cards with dates
      const results = await page.evaluate((args) => {
        const { targetMonth, targetYear } = args;
        const deals = [];

        // Parse dates from text: DD.MM.YY, DD/MM/YYYY, DD.MM.YYYY
        function parseDates(text) {
          const patterns = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/g);
          if (!patterns) return [];
          return patterns.map(d => {
            const parts = d.split(/[./]/);
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            let year = parseInt(parts[2]);
            if (year < 100) year += 2000;
            return { day, month, year, raw: d };
          });
        }

        // Scan all deal-like sections
        const containers = document.querySelectorAll(
          '[class*="promo"], [class*="card"], [class*="deal"], [class*="package"], [class*="offer"], ' +
          'article, [class*="item"]'
        );

        containers.forEach(container => {
          const text = container.textContent || '';
          if (text.length < 30 || text.length > 3000) return;

          // Must have a price
          const priceMatches = text.match(/([\d,]+)\s*₪/g);
          if (!priceMatches) return;

          // Extract dates
          const dates = parseDates(text);

          // Check date validity
          const hasCorrectMonth = dates.some(d => d.month === targetMonth && d.year === targetYear);
          const hasWrongMonth = dates.length > 0 && dates.every(d => d.month !== targetMonth || d.year !== targetYear);

          // Extract hotel name
          const nameEl = container.querySelector('h2, h3, h4, [class*="name"], [class*="title"]');
          const hotelLabel = nameEl ? nameEl.textContent.trim() : '';

          const prices = priceMatches
            .map(m => parseInt(m.replace(/[^\d]/g, '')))
            .filter(p => p > 100 && p < 50000);

          if (prices.length === 0) return;

          deals.push({
            hotel: hotelLabel,
            prices,
            dates: dates.map(d => d.raw),
            datesData: dates,
            hasCorrectMonth,
            hasWrongMonth,
            cardText: text.substring(0, 300),
          });
        });

        return deals;
      }, { targetMonth, targetYear });

      // Check for free cancellation
      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') ||
               text.includes('ביטול ללא עלות') || text.includes('ניתן לביטול');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Log all deals for transparency
      console.log(`[eshet] Found ${results.length} deal cards:`);
      results.forEach(d => {
        const dateStr = d.dates.length > 0 ? `dates=[${d.dates.join(',')}]` : 'no dates';
        const flag = d.hasWrongMonth ? 'WRONG_DATES' : (d.hasCorrectMonth ? 'CORRECT' : 'NO_DATES');
        console.log(`[eshet]   "${d.hotel.substring(0, 40)}" prices=${d.prices} ${dateStr} ${flag}`);
      });

      // Filter: hotel match + date validation
      const matched = results.filter(r => {
        const textToCheck = r.hotel + ' ' + (r.cardText || '');
        if (!isHotelMatch(textToCheck, hotelName)) return false;

        // REJECT if dates are clearly wrong
        if (r.hasWrongMonth) {
          console.log(`[eshet] REJECTED "${r.hotel}" — dates ${r.dates.join(',')} don't match target ${targetMonth}/${targetYear}`);
          return false;
        }

        return true;
      });

      console.log(`[eshet] ${matched.length} deals match hotel AND dates for "${hotelName}"`);

      if (matched.length === 0) return [];

      // Deduplicate
      const seen = new Set();
      return matched.filter(r => {
        const price = Math.min(...r.prices);
        const total = price * nights;
        if (seen.has(total)) return false;
        seen.add(total);
        return true;
      }).map(r => {
        const price = Math.min(...r.prices);
        const total = price * nights;
        return {
          source: 'eshet.com',
          hotel: hotelName,
          prix_total: total,
          devise: 'ILS',
          free_cancellation: hasFreeCancel,
          lien_reservation: pageUrl,
          timestamp: new Date().toISOString(),
          date_verified: r.hasCorrectMonth,
          dates_shown: r.dates.join(' - '),
        };
      });
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'eshet.com' }) || [];
}

module.exports = { scrapeEshet };
