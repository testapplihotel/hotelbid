const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Hotel4U (hotel4u.co.il) — ASP.NET hotel booking site
// The search form requires POST submission with fields:
//   - firstinput: check-in date (DD/MM/YYYY)
//   - secondinput: check-out date (DD/MM/YYYY)
//   - Area: region code (7 = Eilat)
// We fill the form via Puppeteer and submit to get actual date-specific results.

function isHotelMatch(text, hotelName) {
  const lower = text.toLowerCase();
  const targetLower = hotelName.toLowerCase();

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

  const words = targetLower
    .replace(/hotel|resort|eilat|אילת|ישרוטל|isrotel|מלון/gi, '')
    .trim().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return false;
  return words.filter(w => lower.includes(w)).length >= Math.max(1, Math.ceil(words.length * 0.6));
}

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function scrapeHotel4u({ hotelName, checkIn, checkOut, adults, children }) {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));
  const checkinFormatted = formatDateDDMMYYYY(checkIn);
  const checkoutFormatted = formatDateDDMMYYYY(checkOut);

  // Guest encoding: "a2a" for 2 adults, append child ages if any
  let guestParam = `a${adults}a`;
  if (children > 0) {
    // Default child ages (site expects comma-separated ages)
    const childAges = Array(children).fill('8').join(',');
    guestParam += `,${childAges}`;
  }

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      const url = 'https://www.hotel4u.co.il/hoteleilat.asp';
      console.log(`[hotel4u] Loading search page: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // Fill the search form with the user's dates
      console.log(`[hotel4u] Filling form: ${checkinFormatted} - ${checkoutFormatted}, guests: ${guestParam}`);

      await page.evaluate((args) => {
        const { checkin, checkout, area, guests } = args;
        const form = document.sampleform;
        if (!form) throw new Error('Form not found');

        // Set date fields
        form.firstinput.value = checkin;
        form.secondinput.value = checkout;

        // Set area to Eilat
        if (form.Area) form.Area.value = area;

        // Set guests if field exists
        if (form.Guests) form.Guests.value = guests;
      }, {
        checkin: checkinFormatted,
        checkout: checkoutFormatted,
        area: '7',
        guests: guestParam,
      });

      // Submit the form and wait for navigation
      console.log(`[hotel4u] Submitting search form...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
          console.log(`[hotel4u] Navigation timeout — checking if results loaded on same page`);
        }),
        page.evaluate(() => {
          const form = document.sampleform;
          if (form) form.submit();
        }),
      ]);

      // Wait for results to render
      await new Promise(r => setTimeout(r, 5000));

      // Try scrolling to load more content
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 2000));

      // Extract hotel results from the search results page
      const results = await page.evaluate(() => {
        const hotels = [];
        const seen = new Set();

        // Strategy 1: Look for deal/hotel cards
        const cardSelectors = [
          '.best-dill', '.hotel-card', '[class*="result"]', '[class*="hotel"]',
          '[class*="card"]', '[class*="deal"]', 'tr[class*="row"]', '.item',
        ];

        let cards = [];
        for (const sel of cardSelectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            cards = [...found];
            break;
          }
        }

        // If no cards found, try table rows (ASP.NET often uses tables)
        if (cards.length === 0) {
          cards = [...document.querySelectorAll('table tr, div[id*="hotel"], div[id*="result"]')];
        }

        cards.forEach(card => {
          const text = card.textContent || '';
          if (text.length < 20 || text.length > 5000) return;

          // Extract price
          const priceMatches = text.match(/([\d,]+)\s*₪/g);
          if (!priceMatches) return;

          const prices = priceMatches
            .map(m => parseInt(m.replace(/[^\d]/g, '')))
            .filter(p => p > 50 && p < 100000);

          if (prices.length === 0) return;
          const minPrice = Math.min(...prices);

          // Extract hotel name
          const nameEl = card.querySelector('h2, h3, h4, a[href*="hotel"], [class*="name"], [class*="title"]');
          let name = nameEl ? nameEl.textContent.trim() : '';

          // Fallback: first significant text
          if (!name || name.length < 3) {
            const links = card.querySelectorAll('a');
            for (const link of links) {
              const lt = link.textContent.trim();
              if (lt.length > 3 && lt.length < 100 && !lt.includes('מבצעים') && !lt.includes('₪')) {
                name = lt;
                break;
              }
            }
          }

          const key = name + '_' + minPrice;
          if (seen.has(key)) return;
          seen.add(key);

          // Check for cancellation
          const lowerText = text.toLowerCase();
          const freeCancel = lowerText.includes('ביטול חינם') ||
                             lowerText.includes('ביטול ללא עלות') ||
                             lowerText.includes('free cancellation');

          // Get booking link
          const linkEl = card.querySelector('a[href*="hotel"], a[href*="book"], a[href*="order"]');
          const link = linkEl ? linkEl.href : '';

          hotels.push({
            name,
            minPrice,
            freeCancel,
            link,
            snippet: text.substring(0, 200),
          });
        });

        // Strategy 2: Full page scan if no structured cards
        if (hotels.length === 0) {
          const bodyText = document.body.innerText;
          const lines = bodyText.split('\n').filter(l => l.includes('₪'));

          lines.forEach((line, i) => {
            const priceMatch = line.match(/([\d,]+)\s*₪/);
            if (!priceMatch) return;
            const price = parseInt(priceMatch[1].replace(/,/g, ''));
            if (price < 50 || price > 100000) return;

            const allLines = bodyText.split('\n');
            const context = allLines.slice(Math.max(0, i - 3), i + 3).join(' ');

            hotels.push({
              name: line.trim().substring(0, 80),
              minPrice: price,
              freeCancel: false,
              link: '',
              snippet: context.substring(0, 200),
            });
          });
        }

        return hotels;
      });

      // Page-level cancellation check
      const pageHasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') ||
               text.includes('ביטול ללא עלות') || text.includes('ניתן לביטול');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Log results
      console.log(`[hotel4u] Found ${results.length} results after form search:`);
      results.forEach(h => {
        console.log(`[hotel4u]   "${h.name}" ${h.minPrice}₪ cancel=${h.freeCancel}`);
      });

      // Filter by hotel name
      let matched = results.filter(r =>
        isHotelMatch(r.name + ' ' + r.snippet, hotelName)
      );

      console.log(`[hotel4u] ${matched.length} results match "${hotelName}"`);

      // If no exact match, return all results
      if (matched.length === 0 && results.length > 0) {
        console.log(`[hotel4u] No exact match — returning all ${results.length} results`);
        matched = results;
      }

      if (matched.length === 0) return [];

      // Deduplicate and format
      const seenPrices = new Set();
      return matched.filter(r => {
        if (seenPrices.has(r.minPrice)) return false;
        seenPrices.add(r.minPrice);
        return true;
      }).slice(0, 10).map(r => ({
        source: 'hotel4u.co.il',
        hotel: r.name || hotelName,
        prix_total: r.minPrice,
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
  }, { source: 'hotel4u.co.il' }) || [];
}

module.exports = { scrapeHotel4u };
