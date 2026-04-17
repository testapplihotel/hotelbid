const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Hotel4U (hotel4u.co.il) — ASP.NET deals site
// The Eilat page (hoteleilat.asp) shows current deal cards.
// DOM structure: .best-dill cards containing:
//   - .best-deal-img-cover (price overlay, format "3,076₪")
//   - First <a> link = hotel name
// Deals are date-specific promotions — may not always have every hotel.

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

      // Extract deal cards using the confirmed DOM structure
      const results = await page.evaluate(() => {
        const deals = [];
        const cards = document.querySelectorAll('.best-dill');

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

          deals.push({
            hotel: hotelLabel,
            price,
            cardText: cardText.substring(0, 300),
          });
        });

        return deals;
      });

      // Check for free cancellation
      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') ||
               text.includes('ביטול ללא עלות') || text.includes('ניתן לביטול');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      // Filter for target hotel
      const matched = results.filter(r => isHotelMatch(r.hotel + ' ' + r.cardText, hotelName));

      console.log(`[hotel4u] Found ${results.length} deals, ${matched.length} match "${hotelName}"`);

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
      }));
    } catch (err) {
      await closeBrowser(browser);
      throw err;
    }
  }, { source: 'hotel4u.co.il' }) || [];
}

module.exports = { scrapeHotel4u };
