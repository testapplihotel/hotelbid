const { getBrowser, closeBrowser } = require('./browser');
const { withRetry, randomUserAgent } = require('./base-scraper');

// Hotel IDs from daka90's internal database (searchEngineCombos_hotelsIsrael.js)
// Area 76 = Eilat, Hotel 17787 = Isrotel Sport Club
const KNOWN_HOTELS = {
  'isrotel sport club': { hotelId: 17787, areaId: 76 },
  'ספורט קלאב ישרוטל': { hotelId: 17787, areaId: 76 },
};

function findHotelId(hotelName) {
  const lower = hotelName.toLowerCase();
  for (const [key, val] of Object.entries(KNOWN_HOTELS)) {
    if (lower.includes(key) || key.includes(lower.split(' ')[0].toLowerCase())) {
      return val;
    }
  }
  return null;
}

// Build room occupancy code: "220" = 2 adults, 2 children, 0 infants
function buildRoomOccCode(adults, children) {
  return `${adults}${children}0`;
}

// Format date as DD-MM-YYYY (daka90 format)
function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

async function scrapeDaka90({ hotelName, checkIn, checkOut, adults, children }) {
  const hotelInfo = findHotelId(hotelName);

  return withRetry(async () => {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });

      const checkInFmt = formatDate(checkIn);
      const checkOutFmt = formatDate(checkOut);
      const roomOcc = buildRoomOccCode(adults, children);

      let url;
      if (hotelInfo) {
        // Direct search with known hotel ID
        url = `https://www.daka90.co.il/HotelsIsrael/HotelsIsraelSearchResults.aspx?areaId=${hotelInfo.areaId}&hotelId=${hotelInfo.hotelId}&checkInDate=${checkInFmt}&checkOutDate=${checkOutFmt}&roomOccCode=${roomOcc}`;
      } else {
        // Area-wide search for Eilat
        url = `https://www.daka90.co.il/HotelsIsrael/HotelsIsraelSearchResults.aspx?areaId=76&hotelId=0&checkInDate=${checkInFmt}&checkOutDate=${checkOutFmt}&roomOccCode=${roomOcc}`;
      }

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      const results = await page.evaluate((targetHotel) => {
        const prices = [];
        // Daka90 shows hotel results in cards/rows with price
        const cards = document.querySelectorAll('[class*="hotel"], [class*="result"], [class*="deal"], [class*="item"], .searchResultItem, .hotelItem');
        cards.forEach(card => {
          const titleEl = card.querySelector('[class*="title"], [class*="name"], [class*="hotelName"], h2, h3, h4, a');
          const priceEl = card.querySelector('[class*="price"], [class*="Price"], [class*="cost"], .priceValue');
          if (priceEl) {
            const title = titleEl ? titleEl.textContent.trim() : '';
            const priceText = priceEl.textContent.replace(/[^\d.,]/g, '').replace(',', '');
            const price = parseFloat(priceText);
            if (price > 50 && price < 100000) {
              prices.push({ hotel: title, price });
            }
          }
        });

        // Fallback: scan all price-like elements
        if (prices.length === 0) {
          const allPrices = document.querySelectorAll('[class*="price"], [class*="Price"], .priceValue');
          allPrices.forEach(el => {
            const text = el.textContent.replace(/[^\d.,]/g, '').replace(',', '');
            const price = parseFloat(text);
            if (price > 50 && price < 100000) {
              prices.push({ hotel: targetHotel, price });
            }
          });
        }

        return prices;
      }, hotelName);

      const hasFreeCancel = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('ביטול חינם') || text.includes('free cancellation') || text.includes('ביטול ללא');
      });

      const pageUrl = page.url();
      await closeBrowser(browser);

      return results.map(r => ({
        source: 'daka90.co.il',
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
  }, { source: 'daka90.co.il' }) || [];
}

module.exports = { scrapeDaka90 };
