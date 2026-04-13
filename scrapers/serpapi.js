/**
 * SerpApi Google Hotels Scraper for HotelBid
 * ============================================
 *
 * This scraper uses the SerpApi service to query Google Hotels pricing.
 *
 * SETUP:
 *   1. Sign up at https://serpapi.com/users/sign_up
 *   2. Free plan includes 100 searches/month
 *   3. Find your API key at https://serpapi.com/manage-api-key
 *   4. Set the environment variable:
 *        export SERPAPI_KEY=your_key_here
 */

const { withRetry } = require('./base-scraper');

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate number of nights between two YYYY-MM-DD date strings.
 */
function calcNights(checkIn, checkOut) {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

/**
 * Normalise a hotel name for fuzzy comparison: lowercase, strip common
 * suffixes and extra whitespace.
 */
function normaliseName(name) {
  return name
    .toLowerCase()
    .replace(/hotel|resort|suites?|spa|&|and/gi, '')
    .replace(/[^a-z0-9\u0590-\u05FF ]/g, '') // keep Hebrew chars too
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well two hotel names match (0 = no match, higher = better).
 * Returns a value between 0 and 1.
 */
function nameMatchScore(query, candidate) {
  const nq = normaliseName(query);
  const nc = normaliseName(candidate);

  // Exact normalised match
  if (nq === nc) return 1;

  // One contains the other
  if (nc.includes(nq) || nq.includes(nc)) return 0.8;

  // Token overlap (Jaccard-like)
  const tokensQ = new Set(nq.split(' ').filter(Boolean));
  const tokensC = new Set(nc.split(' ').filter(Boolean));
  let overlap = 0;
  for (const t of tokensQ) {
    if (tokensC.has(t)) overlap++;
  }
  const union = new Set([...tokensQ, ...tokensC]).size;
  const score = union > 0 ? overlap / union : 0;

  return score >= 0.5 ? score : 0;
}

/**
 * Detect free-cancellation from various SerpApi property fields.
 */
function detectFreeCancellation(property) {
  // Direct flag
  if (property.free_cancellation === true) return true;

  // In amenities array
  if (Array.isArray(property.amenities)) {
    for (const a of property.amenities) {
      const val = typeof a === 'string' ? a : a?.text || '';
      if (/free cancellation|cancel/i.test(val)) return true;
    }
  }

  // In rate or deal descriptions
  const textFields = [
    property.deal,
    property.deal_description,
    property.rate_description,
    ...(Array.isArray(property.prices) ? property.prices.map(p => p.description) : []),
  ];
  for (const txt of textFields) {
    if (typeof txt === 'string' && /free cancellation/i.test(txt)) return true;
  }

  // In nearby_places or extracted texts
  if (typeof property.description === 'string' && /free cancellation/i.test(property.description)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// SerpApi fetch helper
// ---------------------------------------------------------------------------

/**
 * Make a single SerpApi request and return parsed JSON.
 * Throws on HTTP errors so withRetry can handle them.
 */
async function serpapiFetch(params) {
  const qs = new URLSearchParams(params);
  const url = `${SERPAPI_BASE}?${qs}`;
  const res = await fetch(url);

  if (res.status === 401 || res.status === 403) {
    throw new Error(`SerpApi authentication error (HTTP ${res.status}). Check your SERPAPI_KEY.`);
  }
  if (res.status === 429) {
    throw new Error('SerpApi quota exceeded (HTTP 429). Upgrade your plan or wait.');
  }
  if (!res.ok) {
    throw new Error(`SerpApi HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Step 1: Search for properties
// ---------------------------------------------------------------------------

/**
 * Run Google Hotels search and return the raw SerpApi JSON.
 */
async function searchProperties({ hotelName, checkIn, checkOut, adults, children }) {
  const params = {
    engine: 'google_hotels',
    q: hotelName,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults: String(adults || 2),
    currency: 'ILS',
    hl: 'he',
    gl: 'il',
    api_key: SERPAPI_KEY,
  };

  if (children && children > 0) {
    params.children = String(children);
    // SerpApi requires children_ages to match children count
    // Default to reasonable ages (5, 8, 10, 12) if not specified
    const defaultAges = [5, 8, 10, 12];
    params.children_ages = defaultAges.slice(0, children).join(',');
  }

  return serpapiFetch(params);
}

// ---------------------------------------------------------------------------
// Step 2: Get detailed pricing via property_token
// ---------------------------------------------------------------------------

/**
 * If a property_token is available, fetch detailed room-level pricing.
 * Returns the detailed JSON or null if not available / on error.
 */
async function fetchPropertyDetails(property, { hotelName, checkIn, checkOut, adults, children }) {
  const token = property.property_token || property.serpapi_property_details_link;
  if (!token) return null;

  try {
    const params = {
      engine: 'google_hotels',
      q: hotelName || property.name || 'hotel',
      currency: 'ILS',
      hl: 'he',
      gl: 'il',
      api_key: SERPAPI_KEY,
      check_in_date: checkIn,
      check_out_date: checkOut,
      adults: String(adults || 2),
    };

    if (children && children > 0) {
      params.children = String(children);
      const defaultAges = [5, 8, 10, 12];
      params.children_ages = defaultAges.slice(0, children).join(',');
    }

    // property_token is the standard parameter for the detail endpoint
    if (property.property_token) {
      params.property_token = property.property_token;
    }

    return await serpapiFetch(params);
  } catch (err) {
    console.warn(`[serpapi] Could not fetch property details: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

/**
 * Convert a SerpApi property into one or more HotelBid-standard result
 * objects. If detailed pricing is available, each room/rate option produces
 * a separate entry.
 */
function formatProperty(property, nights, detailedData) {
  const results = [];
  const now = new Date().toISOString();
  const freeCancellation = detectFreeCancellation(property);
  const hotelName = property.name || 'Unknown Hotel';
  const link =
    property.link ||
    property.serpapi_hotel_details_link ||
    `https://www.google.com/travel/hotels`;

  // --- Detailed room-level rates (from step-2 response) ---
  if (detailedData) {
    const prices = detailedData.prices || [];
    for (const rate of prices) {
      const total =
        rate.total_rate?.extracted_lowest ??
        rate.total_rate?.lowest ??
        (rate.rate_per_night?.extracted_lowest
          ? rate.rate_per_night.extracted_lowest * nights
          : null);

      if (total != null) {
        const rateCancel =
          freeCancellation ||
          (typeof rate.cancellation === 'string' && /free/i.test(rate.cancellation)) ||
          rate.free_cancellation === true;

        results.push({
          source: 'google_hotels',
          hotel: hotelName,
          prix_total: total,
          devise: 'ILS',
          free_cancellation: rateCancel,
          lien_reservation: rate.link || link,
          timestamp: now,
        });
      }
    }
  }

  // --- Fallback: top-level rate from the search listing ---
  if (results.length === 0) {
    const totalRate = property.total_rate?.extracted_lowest ?? property.total_rate?.lowest ?? null;
    const perNight = property.rate_per_night?.extracted_lowest ?? property.rate_per_night?.lowest ?? null;

    let price = null;
    if (totalRate != null) {
      price = typeof totalRate === 'string' ? parseFloat(totalRate.replace(/[^\d.]/g, '')) : totalRate;
    } else if (perNight != null) {
      const pn = typeof perNight === 'string' ? parseFloat(perNight.replace(/[^\d.]/g, '')) : perNight;
      price = pn * nights;
    }

    if (price != null && price > 0) {
      results.push({
        source: 'google_hotels',
        hotel: hotelName,
        prix_total: price,
        devise: 'ILS',
        free_cancellation: freeCancellation,
        lien_reservation: link,
        timestamp: now,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search Google Hotels via SerpApi for a given hotel and date range.
 *
 * @param {Object} opts
 * @param {string} opts.hotelName - Hotel name to search for
 * @param {string} opts.checkIn  - Check-in date YYYY-MM-DD
 * @param {string} opts.checkOut - Check-out date YYYY-MM-DD
 * @param {number} opts.adults   - Number of adults (default 2)
 * @param {number} opts.children - Number of children (default 0)
 * @returns {Promise<Array>} Array of HotelBid-standard result objects sorted by price
 */
async function searchSerpApi({ hotelName, checkIn, checkOut, adults = 2, children = 0 }) {
  if (!SERPAPI_KEY) {
    console.warn(
      '[serpapi] No SERPAPI_KEY configured. Set it via: export SERPAPI_KEY=your_key\n' +
      '         Sign up at https://serpapi.com/users/sign_up (100 free searches/month)'
    );
    return [];
  }

  const nights = calcNights(checkIn, checkOut);

  const retryResult = await withRetry(
    async () => {
      // Step 1: search for properties
      console.log(`[serpapi] Searching: "${hotelName}" ${checkIn} -> ${checkOut} (${nights}n, ${adults}a, ${children}c)`);
      const data = await searchProperties({ hotelName, checkIn, checkOut, adults, children });

      // SerpApi sometimes returns a direct hotel detail page (no properties array)
      // when the query matches a specific hotel exactly.
      // In that case, the root object IS the hotel, with property_token at root.
      if (!data.properties && data.property_token && data.name) {
        console.log(`[serpapi] Direct hotel match: "${data.name}" — fetching pricing via property_token`);

        // Use property_token to get room-level pricing
        const detailedData = await fetchPropertyDetails(
          { property_token: data.property_token, name: data.name },
          { hotelName, checkIn, checkOut, adults, children }
        );

        // Build a pseudo-property from root data for formatting
        const rootProperty = {
          name: data.name,
          link: data.link,
          overall_rating: data.overall_rating,
          property_token: data.property_token,
          amenities: data.amenities || [],
          description: data.description,
        };

        const formatted = formatProperty(rootProperty, nights, detailedData);

        // If detail fetch returned prices at root level too
        if (detailedData && detailedData.prices && formatted.length === 0) {
          for (const rate of detailedData.prices) {
            const total = rate.total_rate?.extracted_lowest ?? rate.total_rate?.lowest ??
              (rate.rate_per_night?.extracted_lowest ? rate.rate_per_night.extracted_lowest * nights : null);
            if (total != null && total > 0) {
              const freeCancel = detectFreeCancellation(rootProperty) ||
                (typeof rate.cancellation === 'string' && /free/i.test(rate.cancellation));
              formatted.push({
                source: 'google_hotels',
                hotel: data.name,
                prix_total: total,
                devise: 'ILS',
                free_cancellation: freeCancel,
                lien_reservation: rate.link || data.link || 'https://www.google.com/travel/hotels',
                timestamp: new Date().toISOString(),
              });
            }
          }
        }

        if (formatted.length > 0) {
          formatted.sort((a, b) => a.prix_total - b.prix_total);
          console.log(`[serpapi] Returning ${formatted.length} price results from direct match`);
          return formatted;
        }

        // Fallback: use typical_price_range if available (estimated, not bookable)
        const typicalRange = data.typical_price_range || (detailedData && detailedData.typical_price_range);
        if (typicalRange) {
          const estPerNight = typicalRange.extracted_lowest || typicalRange.extracted_highest;
          if (estPerNight) {
            console.log(`[serpapi] No booking prices yet — using typical price estimate: ~${estPerNight} ILS/night`);
            return [{
              source: 'google_hotels',
              hotel: data.name,
              prix_total: estPerNight * nights,
              devise: 'ILS',
              free_cancellation: false,
              lien_reservation: data.link || 'https://www.google.com/travel/hotels',
              timestamp: new Date().toISOString(),
              _estimated: true,
            }];
          }
        }

        console.log('[serpapi] Direct match found but no pricing available for these dates');
        return [];
      }

      const properties = data.properties || [];
      if (properties.length === 0) {
        console.log('[serpapi] No properties returned');
        return [];
      }

      console.log(`[serpapi] Got ${properties.length} properties`);

      // Score and sort properties by name match
      const scored = properties
        .map(p => ({ property: p, score: nameMatchScore(hotelName, p.name || '') }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('[serpapi] No name matches found among returned properties');
        // Fall back to first property if the search query was specific
        if (properties.length <= 3) {
          scored.push({ property: properties[0], score: 0.1 });
        } else {
          return [];
        }
      }

      // Take the best-matching property (and any others with a high score)
      const bestScore = scored[0].score;
      const matched = scored.filter(s => s.score >= bestScore * 0.7);

      console.log(
        `[serpapi] Matched ${matched.length} properties: ${matched.map(m => `"${m.property.name}" (${(m.score * 100).toFixed(0)}%)`).join(', ')}`
      );

      // Step 2: for each matched property, try fetching detailed pricing
      let allResults = [];

      for (const { property } of matched) {
        let detailedData = null;

        if (property.property_token) {
          console.log(`[serpapi] Fetching details for property_token: ${property.property_token}`);
          detailedData = await fetchPropertyDetails(property, { hotelName, checkIn, checkOut, adults, children });
        }

        const formatted = formatProperty(property, nights, detailedData);
        allResults.push(...formatted);
      }

      // Sort by price ascending
      allResults.sort((a, b) => a.prix_total - b.prix_total);

      console.log(`[serpapi] Returning ${allResults.length} price results`);
      return allResults;
    },
    { source: 'serpapi', maxRetries: 2, baseDelay: 3000 }
  );

  // withRetry returns null on total failure
  return retryResult || [];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { searchSerpApi };

// ---------------------------------------------------------------------------
// Self-test (run with: node scrapers/serpapi.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    if (!process.env.SERPAPI_KEY) {
      console.log('='.repeat(60));
      console.log('SERPAPI_KEY is not set. To run this test:');
      console.log('');
      console.log('  1. Sign up at https://serpapi.com/users/sign_up');
      console.log('  2. Get your key at https://serpapi.com/manage-api-key');
      console.log('  3. Run:');
      console.log('     SERPAPI_KEY=your_key node scrapers/serpapi.js');
      console.log('='.repeat(60));
      process.exit(0);
    }

    const params = {
      hotelName: 'Isrotel Sport Club Eilat',
      checkIn: '2026-08-02',
      checkOut: '2026-08-08',
      adults: 2,
      children: 2,
    };

    console.log('='.repeat(60));
    console.log('SerpApi Google Hotels - Test');
    console.log('='.repeat(60));
    console.log('Search params:', JSON.stringify(params, null, 2));
    console.log('');

    // Raw API response summary
    console.log('--- Raw API Response Summary ---');
    try {
      const rawData = await searchProperties(params);
      const props = rawData.properties || [];
      console.log(`Total properties returned: ${props.length}`);
      for (const p of props.slice(0, 5)) {
        console.log(`  - "${p.name}" | total: ${JSON.stringify(p.total_rate)} | per_night: ${JSON.stringify(p.rate_per_night)} | token: ${p.property_token || 'none'}`);
      }
      if (props.length > 5) console.log(`  ... and ${props.length - 5} more`);
    } catch (err) {
      console.error('Raw API call failed:', err.message);
    }

    console.log('');
    console.log('--- Formatted HotelBid Results ---');
    const results = await searchSerpApi(params);
    if (results.length === 0) {
      console.log('No results found.');
    } else {
      for (const r of results) {
        console.log(`  ${r.hotel} | ${r.prix_total} ${r.devise} | cancel: ${r.free_cancellation} | ${r.lien_reservation}`);
      }
    }

    console.log('');
    console.log('Done.');
    process.exit(0);
  })();
}
