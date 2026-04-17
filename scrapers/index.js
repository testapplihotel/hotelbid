const { searchSerpApi } = require('./serpapi');
const { scrapeIsrotel } = require('./isrotel');
const { scrapeFattal } = require('./fattal');
const { scrapeDan } = require('./dan');
const { scrapeDaka90 } = require('./daka90');
const { scrapeHotelsCoIl } = require('./hotels-co-il');
const { scrapeBrown } = require('./brown');
const { scrapeAstral } = require('./astral');
const { scrapeEshet } = require('./eshet');
const { scrapeHotel4u } = require('./hotel4u');
const { scrapeTravelist } = require('./travelist');
const { isSourceDown, sleep } = require('./base-scraper');

// Max concurrent browser sessions (Browserless free tier = 2)
const MAX_CONCURRENT = 2;
const BATCH_DELAY_MS = 3000;

// Tier 1: OTAs and aggregators that list multiple hotel chains
// SerpApi first — it uses HTTP, not a browser, so it doesn't count toward the limit
// DISABLED: daka90.co.il — blocks headless browsers (empty page), wastes browser sessions
// DISABLED: travelist.co.il — search URL returns 404, primarily flights/packages
// DISABLED: hotels.co.il — reservation engine blocks headless browsers, results.cfm returns 404
const TIER1_SCRAPERS = [
  { name: 'serpapi', fn: searchSerpApi, usesBrowser: false },
  { name: 'isrotel.co.il', fn: scrapeIsrotel, usesBrowser: true },
  { name: 'eshet.com', fn: scrapeEshet, usesBrowser: true },
  { name: 'hotel4u.co.il', fn: scrapeHotel4u, usesBrowser: true },
];

// Tier 2: Chain-specific sites (only useful if searching for THEIR hotels)
const CHAIN_SCRAPERS = [
  { name: 'fattal.co.il', fn: scrapeFattal, chains: ['fattal', 'leonardo', 'herods', 'nyx', 'u magic', 'u splash', 'u coral'] },
  { name: 'danhotels.com', fn: scrapeDan, chains: ['dan '] },
  { name: 'brownhotels.com', fn: scrapeBrown, chains: ['brown'] },
  { name: 'astral-hotels.com', fn: scrapeAstral, chains: ['astral'] },
];

function getRelevantScrapers(hotelName) {
  const lower = hotelName.toLowerCase();
  const scrapers = [...TIER1_SCRAPERS];

  // Add chain-specific scrapers only if the hotel belongs to that chain
  for (const chain of CHAIN_SCRAPERS) {
    if (chain.chains.some(c => lower.includes(c))) {
      scrapers.push(chain);
    }
  }

  return scrapers;
}

// Global timeout for the entire scan (2 minutes)
const SCAN_TIMEOUT_MS = 120000;

async function scrapeAllWithTimeout(params) {
  return Promise.race([
    scrapeAllInternal(params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Scan timed out after 120s')), SCAN_TIMEOUT_MS)
    ),
  ]).catch(err => {
    console.error(`[scrapers] ${err.message} — returning partial results`);
    return [];
  });
}

async function scrapeAllInternal(params) {
  const scrapers = getRelevantScrapers(params.hotelName);
  console.log(`[scrapers] Scanning ${scrapers.length} relevant sources for "${params.hotelName}"...`);

  // Check which sources are down and skip them
  const active = scrapers.filter(s => {
    if (isSourceDown(s.name)) {
      console.log(`[scrapers] Skipping ${s.name} — down for 2h+`);
      return false;
    }
    return true;
  });

  // Split into non-browser (SerpApi) and browser-based scrapers
  const nonBrowser = active.filter(s => !s.usesBrowser);
  const browser = active.filter(s => s.usesBrowser);

  const allPrices = [];

  // Run non-browser scrapers immediately (no concurrency limit)
  if (nonBrowser.length > 0) {
    const nbResults = await Promise.allSettled(nonBrowser.map(s => s.fn(params)));
    nbResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        allPrices.push(...result.value);
      } else if (result.status === 'rejected') {
        console.error(`[scrapers] ${nonBrowser[i].name} failed:`, result.reason?.message);
      }
    });
  }

  // Run browser scrapers in batches of MAX_CONCURRENT with delay between batches
  for (let i = 0; i < browser.length; i += MAX_CONCURRENT) {
    const batch = browser.slice(i, i + MAX_CONCURRENT);
    const batchNum = Math.floor(i / MAX_CONCURRENT) + 1;
    const totalBatches = Math.ceil(browser.length / MAX_CONCURRENT);
    console.log(`[scrapers] Browser batch ${batchNum}/${totalBatches}: ${batch.map(s => s.name).join(', ')}`);

    const batchResults = await Promise.allSettled(batch.map(s => s.fn(params)));
    batchResults.forEach((result, j) => {
      if (result.status === 'fulfilled' && result.value) {
        allPrices.push(...result.value);
      } else if (result.status === 'rejected') {
        console.error(`[scrapers] ${batch[j].name} failed:`, result.reason?.message);
      }
    });

    // Delay before next batch (skip if this was the last batch)
    if (i + MAX_CONCURRENT < browser.length) {
      console.log(`[scrapers] Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Price validation: filter out suspiciously low prices
  const validated = validatePrices(allPrices, params);
  console.log(`[scrapers] Found ${allPrices.length} price(s), ${validated.length} valid after filtering`);
  return validated;
}

function validatePrices(prices, params) {
  if (!params.checkIn || !params.checkOut) return prices;

  const nights = Math.ceil(
    (new Date(params.checkOut) - new Date(params.checkIn)) / (1000 * 60 * 60 * 24)
  );
  if (nights <= 0) return prices;

  // Minimum credible price per night for an Eilat hotel (ILS)
  const MIN_PER_NIGHT = 80;
  const minTotal = MIN_PER_NIGHT * nights;

  return prices.filter(p => {
    if (p.prix_total < minTotal) {
      console.warn(`[scrapers] EXCLUDED ${p.source}: ${p.prix_total} ILS is suspiciously low (${Math.round(p.prix_total / nights)} ILS/night for ${nights} nights, min ${MIN_PER_NIGHT}/night)`);
      return false;
    }
    return true;
  });
}

function getBestPrice(prices, { freeCancellationOnly = true } = {}) {
  let filtered = prices;
  if (freeCancellationOnly) {
    filtered = prices.filter(p => p.free_cancellation);
  }
  if (filtered.length === 0) return null;
  return filtered.reduce((best, p) => p.prix_total < best.prix_total ? p : best);
}

// scrapeAll is the public API — wraps scrapeAllInternal with a global timeout
const scrapeAll = scrapeAllWithTimeout;

module.exports = { scrapeAll, getBestPrice, getRelevantScrapers, TIER1_SCRAPERS, CHAIN_SCRAPERS };
