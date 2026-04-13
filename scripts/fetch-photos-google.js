const fs = require('fs');
const path = require('path');

const HOTELS_PATH = path.join(__dirname, '..', 'data', 'hotels.json');
const SERPAPI_KEY = 'd01d94864c5c7b47d93cf50907f1521232cec64dac576925dba056453b047259';

async function fetchGoogleImage(hotelName) {
  const query = `${hotelName} hotel Israel exterior`;
  const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&num=3&api_key=${SERPAPI_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  API error: ${res.status}`);
      return null;
    }
    const data = await res.json();

    if (data.images_results && data.images_results.length > 0) {
      // Pick first result with a reasonable image
      for (const img of data.images_results.slice(0, 3)) {
        const src = img.original || img.thumbnail;
        if (src && !src.includes('tripadvisor') && !src.includes('booking.com/avatar')) {
          return src;
        }
      }
      // Fallback to first result
      return data.images_results[0].original || data.images_results[0].thumbnail;
    }
    return null;
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    return null;
  }
}

async function main() {
  const hotels = JSON.parse(fs.readFileSync(HOTELS_PATH, 'utf8'));
  const needPhotos = hotels.filter(h => !h.photo);
  console.log(`${needPhotos.length} hotels need photos. Using Google Images via SerpApi...\n`);

  // Check remaining API credits first
  try {
    const accountRes = await fetch(`https://serpapi.com/account.json?api_key=${SERPAPI_KEY}`);
    const account = await accountRes.json();
    console.log(`SerpApi credits remaining: ${account.total_searches_left}\n`);
    if (account.total_searches_left < needPhotos.length) {
      console.log(`WARNING: Only ${account.total_searches_left} credits left, need ${needPhotos.length}`);
      console.log(`Will fetch as many as possible.\n`);
    }
  } catch (e) {
    console.log('Could not check API credits\n');
  }

  let fetched = 0;
  for (const hotel of needPhotos) {
    process.stdout.write(`  ${hotel.name}... `);
    const photo = await fetchGoogleImage(hotel.name);
    if (photo) {
      hotel.photo = photo;
      fetched++;
      console.log('OK');
    } else {
      console.log('no image');
    }

    // Respect rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nFetched ${fetched}/${needPhotos.length} photos`);

  const still = hotels.filter(h => !h.photo);
  if (still.length > 0) {
    console.log(`\nStill missing: ${still.length}`);
    still.forEach(h => console.log(`  - ${h.name}`));
  }

  fs.writeFileSync(HOTELS_PATH, JSON.stringify(hotels, null, 2) + '\n');
  console.log('\nSaved to hotels.json');
}

main().catch(console.error);
