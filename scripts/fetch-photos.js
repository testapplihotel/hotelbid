const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const HOTELS_PATH = path.join(__dirname, '..', 'data', 'hotels.json');

// Scrape hotel images from chain websites
async function fetchIsrotelPhotos() {
  const photos = {};
  const urls = [
    'https://www.isrotel.co.il/isrotel-hotels/eilat-hotels/',
    'https://www.isrotel.co.il/isrotel-hotels/dead-sea-hotels/',
    'https://www.isrotel.co.il/isrotel-hotels/tel-aviv-hotels/',
    'https://www.isrotel.co.il/isrotel-hotels/jerusalem-hotels/',
    'https://www.isrotel.co.il/isrotel-hotels/north-hotels/',
    'https://www.isrotel.co.il/isrotel-hotels/south-hotels/',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } });
      const html = await res.text();
      const $ = cheerio.load(html);

      // Isrotel uses lazy-loaded images with data-src or src
      $('img').each((i, el) => {
        const src = $(el).attr('data-src') || $(el).attr('src') || '';
        const alt = ($(el).attr('alt') || '').toLowerCase();
        if (src && src.includes('media.isrotel')) {
          // Map alt text to hotel names
          if (alt) photos[alt] = src.startsWith('//') ? 'https:' + src : src;
        }
      });

      // Also look for background images in style attributes
      $('[style*="background"]').each((i, el) => {
        const style = $(el).attr('style') || '';
        const match = style.match(/url\(['"]?(https?:\/\/media\.isrotel[^'")\s]+)/);
        if (match) {
          const text = $(el).text().toLowerCase().trim().substring(0, 80);
          if (text) photos[text] = match[1];
        }
      });
    } catch (e) {
      console.log('  Failed:', url, e.message);
    }
  }

  return photos;
}

async function fetchFattalPhotos() {
  const photos = {};
  try {
    const res = await fetch('https://www.fattal.co.il/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    $('img').each((i, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src') || '';
      const alt = ($(el).attr('alt') || '').toLowerCase();
      if (src && alt && (src.includes('cloudfront') || src.includes('fattal'))) {
        photos[alt] = src.startsWith('//') ? 'https:' + src : src;
      }
    });
  } catch (e) {
    console.log('  Failed fattal:', e.message);
  }
  return photos;
}

async function fetchDanPhotos() {
  const photos = {};
  try {
    const res = await fetch('https://www.danhotels.com/Hotels', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    $('img').each((i, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src') || '';
      const alt = ($(el).attr('alt') || '').toLowerCase();
      if (src && alt && (src.includes('danhotels') || src.includes('cdn'))) {
        photos[alt] = src.startsWith('//') ? 'https:' + src : src;
      }
    });
  } catch (e) {
    console.log('  Failed dan:', e.message);
  }
  return photos;
}

// Match scraped photos to our hotel list using fuzzy matching
function matchPhoto(hotelName, hotelNameHe, allPhotos) {
  const nameLower = hotelName.toLowerCase();
  const nameHeLower = hotelNameHe.toLowerCase();

  // Extract key words from hotel name
  const keywords = nameLower
    .replace(/hotel|resort|spa|israel/gi, '')
    .split(/[\s,]+/)
    .filter(w => w.length > 2);

  for (const [alt, url] of Object.entries(allPhotos)) {
    const altLower = alt.toLowerCase();

    // Direct name match
    if (altLower.includes(nameLower) || nameLower.includes(altLower)) return url;
    if (altLower.includes(nameHeLower) || nameHeLower.includes(altLower)) return url;

    // Keyword match (2+ keywords must match)
    let matched = 0;
    for (const kw of keywords) {
      if (altLower.includes(kw)) matched++;
    }
    if (matched >= 2) return url;
  }

  return null;
}

async function main() {
  console.log('Fetching hotel photos from chain websites...\n');

  console.log('Scraping Isrotel...');
  const isrotelPhotos = await fetchIsrotelPhotos();
  console.log(`  Found ${Object.keys(isrotelPhotos).length} images`);

  console.log('Scraping Fattal...');
  const fattalPhotos = await fetchFattalPhotos();
  console.log(`  Found ${Object.keys(fattalPhotos).length} images`);

  console.log('Scraping Dan...');
  const danPhotos = await fetchDanPhotos();
  console.log(`  Found ${Object.keys(danPhotos).length} images`);

  const allPhotos = { ...isrotelPhotos, ...fattalPhotos, ...danPhotos };
  console.log(`\nTotal scraped images: ${Object.keys(allPhotos).length}`);

  // Load hotels.json and match photos
  const hotels = JSON.parse(fs.readFileSync(HOTELS_PATH, 'utf8'));
  let matched = 0;

  for (const hotel of hotels) {
    const photo = matchPhoto(hotel.name, hotel.nameHe, allPhotos);
    if (photo) {
      hotel.photo = photo;
      matched++;
    }
  }

  console.log(`Matched ${matched}/${hotels.length} hotels with photos`);

  // Save updated hotels.json
  fs.writeFileSync(HOTELS_PATH, JSON.stringify(hotels, null, 2) + '\n');
  console.log('Saved to hotels.json');

  // Print unmatched hotels
  const unmatched = hotels.filter(h => !h.photo);
  if (unmatched.length > 0) {
    console.log('\nUnmatched hotels:');
    unmatched.forEach(h => console.log(`  - ${h.name}`));
  }
}

main().catch(console.error);
