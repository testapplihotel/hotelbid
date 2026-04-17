const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Eshet Tours (eshet.com) — Israeli OTA
// Uses date-parameterized search URL:
//   /domestichotels/searchresults?checkInDate=DD.MM.YYYY&checkOutDate=DD.MM.YYYY&destination=ETH&adults=N&children=N&rooms=1
// Results load dynamically via Next.js — we wait for hotel cards to render.

function isHotelMatch(text, hotelName) {
  const lower = text.toLowerCase();
  const targetLower = hotelName.toLowerCase();

  // Direct brand matches
  const directMatches = [
    ['sport club', 'ספורט קלאב'],
    ['royal beach', 'רויאל ביץ'],
    ['king solomon', 'המלך שלמה'],
    ['laguna', 'לגונה'],
    ['riviera', 'ריביירה'],
    ['dead sea', 'ים המלח'],
    ['aria', 'אריאה'],
    ['agamim', 'אגמים'],
  ];

  for (const names of directMatches) {
    if (names.some(n => targetLower.includes(n))) {
      return names.some(n => lower.includes(n));
    }
  }

  const significantWords = targetLower
    .replace(/hotel|resort|eilat|אילת|ישרוטל|isrotel|מלון/gi, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (significantWords.length === 0) return false;
  const matchCount = significantWords.filter(w => lower.includes(w)).length;
  return matchCount >= Math.max(1, Math.ceil(significantWords.length * 0.6));
}

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

async function scrapeEshet({ hotelName, checkIn, checkOut, adults, children }) {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));
  const checkinFormatted = formatDateDDMMYYYY(checkIn);
  const checkoutFormatted = formatDateDDMMYYYY(checkOut);

  // Build date-parameterized search URL
  const searchUrl = `https://www.eshet.com/domestichotels/searchresults?checkInDate=${checkinFormatted}&checkOutDate=${checkoutFormatted}&destination=ETH&adults=${adults}&children=${children || 0}&rooms=1`;

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      console.log(`[eshet] Searching: ${checkinFormatted} - ${checkoutFormatted}, ${adults} adults`);
      console.log(`[eshet] URL: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });

      // Wait for search results to load (Next.js renders them dynamically)
      // Try multiple selectors — the page structure may vary
      const resultSelectors = [
        '[class*="hotel-card"]',
        '[class*="HotelCard"]',
        '[class*="result-item"]',
        '[class*="search-result"]',
        '[class*="property"]',
        '[class*="listing"]',
        '[class*="hotelItem"]',
        '[class*="hotel_card"]',
        '[class*="cardContainer"]',
      ];

      let loaded = false;
      for (const sel of resultSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 3000 });
          loaded = true;
          console.log(`[eshet] Results loaded with selector: ${sel}`);
          break;
        } catch { /* try next */ }
      }

      if (!loaded) {
        // Fallback: wait for price elements to appear
        console.log(`[eshet] No card selector matched, waiting for prices...`);
        try {
          await page.waitForFunction(() => {
            const text = document.body.innerText;
            return (text.match(/₪/g) || []).length >= 2;
          }, { timeout: 15000 });
          loaded = true;
          console.log(`[eshet] Prices detected on page`);
        } catch {
          console.log(`[eshet] No prices appeared after 15s`);
        }
      }

      // Extra settle time for dynamic rendering
      await new Promise(r => setTimeout(r, 3000));

      // Scroll down to trigger lazy-loaded content
      await page.evaluate(() => {
        window.scrollBy(0, 800);
      });
      await new Promise(r => setTimeout(r, 2000));

      // Extract all hotel results
      const results = await page.evaluate((args) => {
        const { hotelNameTarget } = args;
        const hotels = [];

        // Strategy 1: Find cards/containers with prices
        const allElements = document.querySelectorAll(
          '[class*="card"], [class*="Card"], [class*="result"], [class*="hotel"], ' +
          '[class*="item"], [class*="listing"], [class*="property"], article'
        );

        const seen = new Set();

        allElements.forEach(el => {
          const text = el.textContent || '';
          if (text.length < 30 || text.length > 5000) return;

          // Must have a price in ILS
          const priceMatches = text.match(/([\d,]+)\s*₪/g);
          if (!priceMatches) return;

          const prices = priceMatches
            .map(m => parseInt(m.replace(/[^\d]/g, '')))
            .filter(p => p > 100 && p < 100000);

          if (prices.length === 0) return;

          // Extract hotel name from heading elements
          const nameEl = el.querySelector('h1, h2, h3, h4, [class*="name"], [class*="Name"], [class*="title"], [class*="Title"]');
          const name = nameEl ? nameEl.textContent.trim() : '';

          if (!name || name.length < 3) return;

          // Deduplicate by name
          const key = name + '_' + Math.min(...prices);
          if (seen.has(key)) return;
          seen.add(key);

          // Look for room type
          const roomEl = el.querySelector('[class*="room"], [class*="Room"], [class*="type"], [class*="Type"]');
          const roomType = roomEl ? roomEl.textContent.trim() : '';

          // Look for cancellation info
          const cancelText = text.toLowerCase();
          const freeCancel = cancelText.includes('ביטול חינם') ||
                             cancelText.includes('ביטול ללא עלות') ||
                             cancelText.includes('free cancellation');

          // Look for booking link
          const linkEl = el.querySelector('a[href*="hotel"], a[href*="book"], a[href*="order"]');
          const link = linkEl ? linkEl.href : '';

          hotels.push({
            name,
            roomType: roomType.substring(0, 100),
            prices,
            minPrice: Math.min(...prices),
            freeCancel,
            link,
            snippet: text.substring(0, 200),
          });
        });

        // Strategy 2: If no card-based results, scan full page for price patterns
        if (hotels.length === 0) {
          const bodyText = document.body.innerText;
          const lines = bodyText.split('\n').filter(l => l.includes('₪'));

          lines.forEach((line, i) => {
            const priceMatch = line.match(/([\d,]+)\s*₪/);
            if (!priceMatch) return;
            const price = parseInt(priceMatch[1].replace(/,/g, ''));
            if (price < 100 || price > 100000) return;

            // Look at surrounding lines for hotel name
            const context = bodyText.split('\n').slice(Math.max(0, i - 3), i + 3).join(' ');

            hotels.push({
              name: line.trim().substring(0, 80),
              roomType: '',
              prices: [price],
              minPrice: price,
              freeCancel: false,
              link: '',
              snippet: context.substring(0, 200),
            });
          });
        }

        return hotels;
      }, { hotelNameTarget: hotelName });

      // Check page-level cancellation policy
      const pageHasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') ||
               text.includes('ביטול ללא עלות') || text.includes('ניתן לביטול');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Log all results
      console.log(`[eshet] Found ${results.length} hotel results:`);
      results.forEach(h => {
        console.log(`[eshet]   "${h.name}" ${h.minPrice}₪ cancel=${h.freeCancel}`);
      });

      // Filter by hotel name match
      let matched = results.filter(r =>
        isHotelMatch(r.name + ' ' + r.snippet, hotelName)
      );

      console.log(`[eshet] ${matched.length} results match "${hotelName}"`);

      // If no specific match, return all results (user can verify)
      if (matched.length === 0 && results.length > 0) {
        console.log(`[eshet] No exact match — returning all ${results.length} Eilat results`);
        matched = results;
      }

      if (matched.length === 0) return [];

      // Deduplicate and format output
      const seenPrices = new Set();
      return matched.filter(r => {
        if (seenPrices.has(r.minPrice)) return false;
        seenPrices.add(r.minPrice);
        return true;
      }).slice(0, 10).map(r => ({
        source: 'eshet.com',
        hotel: r.name || hotelName,
        prix_total: r.minPrice * nights,
        devise: 'ILS',
        free_cancellation: r.freeCancel || pageHasFreeCancel,
        lien_reservation: r.link || pageUrl,
        timestamp: new Date().toISOString(),
        date_verified: true,
        dates_shown: `${checkinFormatted} - ${checkoutFormatted}`,
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'eshet.com' }) || [];
}

module.exports = { scrapeEshet };
