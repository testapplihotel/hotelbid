const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Eshet Tours (eshet.com) — Next.js SPA, major Israeli OTA
// The Eilat page shows promotional deal cards for various hotels.
// Each promo card has: hotel name, price (per night per couple), dates, meal plan.

// Match specifically for the target hotel — avoid false positives
function isHotelMatch(text, hotelName) {
  const lower = text.toLowerCase();
  const targetLower = hotelName.toLowerCase();

  // Extract distinctive hotel identifier (e.g., "sport club" from "Isrotel Sport Club Eilat")
  // Check for specific name parts, not just brand
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

  // Generic fallback: require at least 2 significant words to match
  const significantWords = targetLower
    .replace(/hotel|resort|eilat|אילת|ישרוטל|isrotel/gi, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (significantWords.length === 0) return false;
  const matchCount = significantWords.filter(w => lower.includes(w)).length;
  return matchCount >= Math.max(1, Math.ceil(significantWords.length * 0.6));
}

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

      // Extract promotional cards with STRICT hotel name matching
      const results = await page.evaluate((targetHotel, nights) => {
        const prices = [];

        // Strategy 1: promo containers with parent card walk
        const promoContainers = document.querySelectorAll('[class*="promo-price-container"]');

        promoContainers.forEach(container => {
          // Walk up to find the IMMEDIATE parent card (limit to 5 levels, max 1000 chars)
          let parent = container;
          for (let i = 0; i < 5 && parent.parentElement; i++) {
            parent = parent.parentElement;
            const text = parent.textContent || '';
            if (text.length > 100 && text.length < 1000) break;
          }

          const cardText = parent.textContent || '';

          // Extract price from the promo container
          const priceEl = container.querySelector('[class*="promo-price___"]');
          if (priceEl) {
            const priceText = priceEl.textContent.replace(/[^\d]/g, '');
            const pricePerNight = parseInt(priceText);
            if (pricePerNight > 100 && pricePerNight < 10000) {
              const hotelLabel = cardText.substring(0, 80).trim().split('\n')[0] || 'Eshet Deal';
              prices.push({
                hotel: hotelLabel,
                pricePerNight,
                totalPrice: pricePerNight * nights,
                cardText: cardText.substring(0, 300),
              });
            }
          }
        });

        // Strategy 2: scan all links/sections for Sport Club
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(link => {
          const href = link.href || '';
          const text = link.textContent || '';
          if (text.includes('ספורט קלאב') || text.includes('Sport Club') || href.includes('sport-club')) {
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
                    cardText: parent.textContent.substring(0, 200),
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

      // Check for free cancellation terms on the page
      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') ||
               text.includes('ביטול ללא עלות') || text.includes('ניתן לביטול') ||
               text.includes('ביטול עד') || text.includes('גמישות ביטול');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Apply strict hotel matching to DOM-extracted results
      const allResults = [...results, ...apiPrices];
      const matched = allResults.filter(r => {
        const textToCheck = r.hotel + ' ' + (r.cardText || '');
        return isHotelMatch(textToCheck, hotelName);
      });

      console.log(`[eshet] Found ${allResults.length} total prices, ${matched.length} match "${hotelName}"`);

      // Deduplicate by total price
      const seen = new Set();
      const deduped = matched.filter(r => {
        const key = r.totalPrice || r.price;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return deduped.map(r => ({
        source: 'eshet.com',
        hotel: hotelName,
        prix_total: r.totalPrice || r.price,
        devise: 'ILS',
        free_cancellation: hasFreeCancel,
        lien_reservation: pageUrl,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'eshet.com' }) || [];
}

function extractPricesFromJson(data, targetHotel, nights) {
  const results = [];

  function traverse(obj, depth = 0) {
    if (depth > 8 || !obj || typeof obj !== 'object') return;

    const name = obj.name || obj.hotelName || obj.title || obj.hotel_name || '';
    const nameStr = typeof name === 'string' ? name : '';

    if (nameStr && isHotelMatch(nameStr, targetHotel)) {
      const price = obj.price || obj.totalPrice || obj.total_price || obj.rate || 0;
      if (typeof price === 'number' && price > 100) {
        results.push({
          hotel: nameStr,
          price,
          totalPrice: price > 5000 ? price : price * nights,
        });
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
