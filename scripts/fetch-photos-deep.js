const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const HOTELS_PATH = path.join(__dirname, '..', 'data', 'hotels.json');

async function fetchOgImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Try og:image first
    let img = $('meta[property="og:image"]').attr('content');
    if (img) return img.startsWith('//') ? 'https:' + img : img;

    // Try twitter:image
    img = $('meta[name="twitter:image"]').attr('content');
    if (img) return img.startsWith('//') ? 'https:' + img : img;

    // Try first large image
    const imgs = [];
    $('img').each((i, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src') || '';
      const width = parseInt($(el).attr('width') || '0');
      if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('sprite') &&
          !src.includes('pixel') && !src.includes('svg') && src.length > 20) {
        imgs.push({ src: src.startsWith('//') ? 'https:' + src : src, width });
      }
    });

    // Prefer wide images (hotel photos are usually landscape)
    const sorted = imgs.sort((a, b) => b.width - a.width);
    return sorted[0]?.src || null;
  } catch (e) {
    return null;
  }
}

// Direct hotel page URLs for major chains
const HOTEL_PAGES = {
  // Dan Hotels
  'Dan Eilat': 'https://www.danhotels.com/EilatHotels/DanEilat',
  'Dan Panorama Eilat': 'https://www.danhotels.com/EilatHotels/DanPanoramaEilat',
  'Dan Jerusalem': 'https://www.danhotels.com/JerusalemHotels/DanJerusalem',
  'Dan Panorama Jerusalem': 'https://www.danhotels.com/JerusalemHotels/DanPanoramaJerusalem',
  'Dan Tel Aviv': 'https://www.danhotels.com/TelAvivHotels/DanTelAviv',
  'Dan Panorama Tel Aviv': 'https://www.danhotels.com/TelAvivHotels/DanPanoramaTelAviv',
  'Dan Carmel Haifa': 'https://www.danhotels.com/HaifaHotels/DanCarmelHaifa',
  'Dan Panorama Haifa': 'https://www.danhotels.com/HaifaHotels/DanPanoramaHaifa',
  'Dan Accadia Herzliya': 'https://www.danhotels.com/HerzliyaHotels/DanAccadiaHerzliya',
  'Dan Caesarea': 'https://www.danhotels.com/CaesareaHotels/DanCaesarea',
  'King David Jerusalem': 'https://www.danhotels.com/JerusalemHotels/TheKingDavidJerusalem',
  'Link Hotel & Hub Tel Aviv': 'https://www.danhotels.com/TelAvivHotels/LinkHotelAndHub',

  // Brown Hotels
  'Brown Beach House Tel Aviv': 'https://www.brownhotels.com/beach-house',
  'Brown TLV Urban Hotel': 'https://www.brownhotels.com/brown-tlv',
  'Brown Seaside Tel Aviv': 'https://www.brownhotels.com/seaside',
  'Dave Gordon Tel Aviv': 'https://www.brownhotels.com/dave-gordon',
  'Brown JLM Hotel Jerusalem': 'https://www.brownhotels.com/jlm',

  // Astral Hotels
  'Astral Village Eilat': 'https://www.astral-hotels.com/en/astral-village-hotel-eilat',
  'Astral Nirvana Eilat': 'https://www.astral-hotels.com/en/astral-nirvana-suites-hotel-eilat',
  'Astral Palma Eilat': 'https://www.astral-hotels.com/en/astral-palma-hotel-eilat',
  'Astral Coral Eilat': 'https://www.astral-hotels.com/en/astral-coral-hotel-eilat',
  'Astral Seaside Eilat': 'https://www.astral-hotels.com/en/astral-seaside-hotel-eilat',

  // Fattal/Leonardo direct pages
  'Leonardo Hotel Eilat': 'https://www.fattal.co.il/leonardo-hotel-eilat',
  'Leonardo Privilege Eilat': 'https://www.fattal.co.il/leonardo-privilege-eilat',
  'Leonardo Plaza Eilat': 'https://www.fattal.co.il/leonardo-plaza-eilat',
  'Leonardo Club Eilat': 'https://www.fattal.co.il/leonardo-club-eilat-all-inclusive',
  'U Magic Palace Eilat': 'https://www.fattal.co.il/u-magic-palace-eilat',
  'U Splash Resort Eilat': 'https://www.fattal.co.il/u-splash-resort-eilat',
  'U Coral Beach Club Eilat': 'https://www.fattal.co.il/u-coral-beach-club-eilat',
  'Herods Palace Eilat': 'https://www.fattal.co.il/herods-palace-eilat',
  'Herods Vitalis Spa Eilat': 'https://www.fattal.co.il/herods-vitalis-spa-hotel-eilat',
  'NYX Hotel Eilat': 'https://www.fattal.co.il/nyx-hotel-eilat',
  'Leonardo Dead Sea': 'https://www.fattal.co.il/leonardo-club-dead-sea',
  'Leonardo Privilege Dead Sea': 'https://www.fattal.co.il/leonardo-privilege-dead-sea',
  'Leonardo Club Dead Sea': 'https://www.fattal.co.il/leonardo-club-dead-sea',
  'Leonardo Plaza Dead Sea': 'https://www.fattal.co.il/leonardo-plaza-dead-sea',
  'Herods Dead Sea': 'https://www.fattal.co.il/herods-dead-sea',
  'Leonardo Plaza Jerusalem': 'https://www.fattal.co.il/leonardo-plaza-jerusalem',
  'Leonardo Jerusalem': 'https://www.fattal.co.il/leonardo-jerusalem',
  'NYX Hotel Tel Aviv': 'https://www.fattal.co.il/nyx-tel-aviv',
  'Leonardo Art Tel Aviv': 'https://www.fattal.co.il/leonardo-art-tel-aviv',
  'Leonardo City Tower Tel Aviv': 'https://www.fattal.co.il/leonardo-city-tower-tel-aviv',
  'Leonardo Beach Tel Aviv': 'https://www.fattal.co.il/leonardo-beach-tel-aviv',
  'Leonardo Tiberias': 'https://www.fattal.co.il/leonardo-tiberias',
  'Leonardo Plaza Haifa': 'https://www.fattal.co.il/leonardo-plaza-haifa',
  'Leonardo Ashkelon': 'https://www.fattal.co.il/leonardo-ashkelon',
  'Leonardo Negev Beer Sheva': 'https://www.fattal.co.il/leonardo-negev-beer-sheva',
  'Leonardo Plaza Netanya': 'https://www.fattal.co.il/leonardo-plaza-netanya',

  // Other major hotels
  'Hilton Eilat Queen of Sheba': 'https://www.hilton.com/en/hotels/ethqbhi-hilton-eilat-queen-of-sheba/',
  'Hilton Tel Aviv': 'https://www.hilton.com/en/hotels/tlvhitw-hilton-tel-aviv/',
  'Waldorf Astoria Jerusalem': 'https://www.hilton.com/en/hotels/tlvwawa-waldorf-astoria-jerusalem/',
  'Crowne Plaza Eilat': 'https://www.ihg.com/crowneplaza/hotels/us/en/eilat/ethei/hoteldetail',
  'Crowne Plaza Dead Sea': 'https://www.ihg.com/crowneplaza/hotels/us/en/dead-sea/dsair/hoteldetail',
  'Mamilla Hotel Jerusalem': 'https://www.mamillahotel.com/',
  'Carlton Tel Aviv': 'https://www.carlton.co.il/',
  'Setai Tel Aviv': 'https://www.thesetaihotels.com/en/tel-aviv',
};

async function main() {
  const hotels = JSON.parse(fs.readFileSync(HOTELS_PATH, 'utf8'));
  const needPhotos = hotels.filter(h => !h.photo);
  console.log(`${needPhotos.length} hotels need photos. Fetching from hotel pages...\n`);

  let fetched = 0;
  for (const hotel of needPhotos) {
    const url = HOTEL_PAGES[hotel.name];
    if (!url) continue;

    process.stdout.write(`  ${hotel.name}... `);
    const photo = await fetchOgImage(url);
    if (photo) {
      hotel.photo = photo;
      fetched++;
      console.log('OK');
    } else {
      console.log('no image found');
    }

    // Be nice to servers
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nFetched ${fetched} additional photos`);

  const still = hotels.filter(h => !h.photo);
  console.log(`Hotels still without photos: ${still.length}`);
  still.forEach(h => console.log(`  - ${h.name}`));

  fs.writeFileSync(HOTELS_PATH, JSON.stringify(hotels, null, 2) + '\n');
  console.log('\nSaved to hotels.json');
}

main().catch(console.error);
