const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Hotel4U (hotel4u.co.il) — ASP.NET deals site
// CRITICAL: This page does NOT accept date parameters — it shows current deal cards.
// We MUST extract dates from each card and validate against the target dates.
// Deals that show dates outside our target range are REJECTED.

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

  const words = targetLower
    .replace(/hotel|resort|eilat|אילת|ישרוטל|isrotel|מלון/gi, '')
    .trim().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return false;
  return words.filter(w => lower.includes(w)).length >= Math.max(1, Math.ceil(words.length * 0.6));
}

async function scrapeHotel4u({ hotelName, checkIn, checkOut, adults, children }) {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));
  const targetCheckIn = new Date(checkIn);
  const targetMonth = targetCheckIn.getMonth() + 1;
  const targetYear = targetCheckIn.getFullYear();

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      const url = 'https://www.hotel4u.co.il/hoteleilat.asp';
      console.log(`[hotel4u] Navigating to Eilat deals page`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      // Extract deal cards with date validation
      const results = await page.evaluate((args) => {
        const { targetMonth, targetYear } = args;
        const deals = [];
        const cards = document.querySelectorAll('.best-dill');

        // Parse dates from text
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

        cards.forEach(card => {
          // Price is in .best-deal-img-cover
          const priceEl = card.querySelector('.best-deal-img-cover');
          if (!priceEl) return;

          const priceMatch = priceEl.textContent.match(/([\d,]+)₪/);
          if (!priceMatch) return;
          const price = parseInt(priceMatch[1].replace(/,/g, ''));
          if (price < 50 || price > 100000) return;

          // Hotel name is the first <a> link text
          const links = card.querySelectorAll('a');
          let hotelLabel = '';
          for (const link of links) {
            const text = link.textContent.trim();
            if (text.length > 3 && text.length < 100 && !text.includes('מבצעים')) {
              hotelLabel = text;
              break;
            }
          }

          const cardText = card.textContent.replace(/\s+/g, ' ').trim();

          // Extract dates from card
          const dates = parseDates(cardText);
          const hasCorrectMonth = dates.some(d => d.month === targetMonth && d.year === targetYear);
          const hasWrongMonth = dates.length > 0 && dates.every(d => d.month !== targetMonth || d.year !== targetYear);

          deals.push({
            hotel: hotelLabel,
            price,
            cardText: cardText.substring(0, 300),
            dates: dates.map(d => d.raw),
            hasCorrectMonth,
            hasWrongMonth,
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
      console.log(`[hotel4u] Found ${results.length} deal cards:`);
      results.forEach(d => {
        const dateStr = d.dates.length > 0 ? `dates=[${d.dates.join(',')}]` : 'no dates';
        const flag = d.hasWrongMonth ? 'WRONG_DATES' : (d.hasCorrectMonth ? 'CORRECT' : 'NO_DATES');
        console.log(`[hotel4u]   "${d.hotel}" ${d.price}₪ ${dateStr} ${flag}`);
      });

      // Filter: hotel match + date validation
      const matched = results.filter(r => {
        if (!isHotelMatch(r.hotel + ' ' + r.cardText, hotelName)) return false;

        // REJECT if dates are clearly wrong
        if (r.hasWrongMonth) {
          console.log(`[hotel4u] REJECTED "${r.hotel}" — dates ${r.dates.join(',')} don't match target ${targetMonth}/${targetYear}`);
          return false;
        }

        return true;
      });

      console.log(`[hotel4u] ${matched.length} deals match hotel AND dates for "${hotelName}"`);

      if (matched.length === 0) return [];

      // Deduplicate by price
      const seen = new Set();
      return matched.filter(r => {
        if (seen.has(r.price)) return false;
        seen.add(r.price);
        return true;
      }).map(r => ({
        source: 'hotel4u.co.il',
        hotel: r.hotel || hotelName,
        prix_total: r.price,
        devise: 'ILS',
        free_cancellation: hasFreeCancel,
        lien_reservation: pageUrl,
        timestamp: new Date().toISOString(),
        date_verified: r.hasCorrectMonth,
        dates_shown: r.dates.join(' - '),
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'hotel4u.co.il' }) || [];
}

module.exports = { scrapeHotel4u };
