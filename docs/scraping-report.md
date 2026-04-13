# Hotel Price Scraping Report - Israeli Hotel/Travel Sites

**Date:** 2026-04-09
**Target search:** Isrotel Sport Club Eilat, 2 adults + 2 children, Aug 2-8, 2026
**Note:** This analysis is based on known site architectures and patterns. Live verification with curl/Puppeteer is recommended before building scrapers.

---

## 1. Daka90 (daka90.co.il)
- **Type:** Dynamic SPA (React-based)
- **Scraping method:** Puppeteer (preferred) / API (if endpoints discovered)
- **Search URL pattern:** `https://www.daka90.co.il/hotels/search?checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2&childAges=5,8&destination=eilat`
- **Booking engine:** Uses a third-party booking widget (likely Travelnet or similar Israeli OTA engine). Search results are loaded dynamically via AJAX/XHR calls.
- **Potential API pattern:** Look for XHR calls to endpoints like `/api/search/hotels` or similar when performing a search in browser DevTools. Daka90 is a deals aggregator, so it may call multiple supplier APIs.
- **Blocking:** Low to Medium - No heavy Cloudflare protection observed historically. May have basic rate limiting.
- **Risk level:** Medium
- **Notes:** Daka90 is a deals/promotions site. They may not always have Isrotel Sport Club listed -- they feature discounted deals rather than full hotel inventory. Prices shown are promotional/deal prices, not standard rack rates. Content is heavily JS-rendered.
- **Feasibility:** PARTIAL - Only available if the specific hotel has an active deal on the site.

---

## 2. Hotels.co.il (hotels.co.il)
- **Type:** Dynamic SPA
- **Scraping method:** Puppeteer / API
- **Search URL pattern:** `https://www.hotels.co.il/search?city=eilat&checkin=02-08-2026&checkout=08-08-2026&rooms=1&adults=2&children=2&childAge1=5&childAge2=8`
- **Booking engine:** Israeli OTA platform. Likely uses a custom booking engine with dynamic result loading.
- **Potential API pattern:** Monitor XHR requests during search for `/api/hotels/search` or `/api/availability` endpoints. May use WebSocket or polling for results.
- **Blocking:** Medium - May use Cloudflare or similar CDN protection.
- **Risk level:** Medium
- **Notes:** This is a general Israeli hotel booking aggregator. Should have broad hotel coverage including Isrotel properties. Date format may be DD-MM-YYYY (Israeli convention) or ISO format -- needs live verification.
- **Feasibility:** YES

---

## 3. Isrotel (isrotel.co.il)
- **Type:** Dynamic SPA (React/Next.js based)
- **Scraping method:** Puppeteer (primary) / API (if direct booking engine API found)
- **Search URL pattern:** `https://www.isrotel.co.il/en/search-results?hotel=isrotel-sport-club&checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2&childAge1=5&childAge2=8`
- **Direct hotel page:** `https://www.isrotel.co.il/isrotel-sport-club-eilat` (Hebrew) or `https://www.isrotel.co.il/en/isrotel-sport-club-eilat` (English)
- **Booking engine:** Isrotel uses a proprietary booking engine (or a customized third-party engine like Nuvola/Synxis). The booking widget on hotel pages POSTs search parameters and returns room/rate data.
- **Potential API pattern:** Look for calls to booking engine endpoints when clicking "Check Availability". Possible patterns:
  - `https://booking.isrotel.co.il/api/availability`
  - `https://www.isrotel.co.il/api/rooms/search`
  - Or a subdomain like `reservations.isrotel.co.il`
- **Blocking:** Medium - Standard protection. Being a direct hotel chain site, they may not have aggressive bot detection, but could have rate limiting.
- **Risk level:** Medium
- **Notes:** This is the OFFICIAL source for Isrotel Sport Club pricing. Most authoritative for this specific hotel. The site has both Hebrew and English versions. The booking flow likely redirects to a booking engine subdomain. Room types and rates are loaded dynamically after search.
- **Feasibility:** YES - Primary target, most reliable source.

---

## 4. Fattal Hotels (fattal.co.il)
- **Type:** Dynamic SPA (modern JS framework)
- **Scraping method:** Puppeteer
- **Search URL pattern:** `https://www.fattal.co.il/search?destination=eilat&checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2&childAges=5,8`
- **Booking engine:** Fattal uses their own booking platform. Search results are rendered client-side.
- **Potential API pattern:** Fattal may expose internal search APIs. Check for XHR calls to paths like `/api/hotels/search` or `/umbraco/api/` (Fattal has historically used Umbraco CMS).
- **Blocking:** Medium - Standard CDN/WAF protection.
- **Risk level:** Medium
- **Notes:** Fattal is a COMPETING hotel chain (Leonardo, NYX, Herods, etc.). They would NOT list Isrotel Sport Club. Fattal only shows their own properties. This site is NOT relevant for scraping Isrotel Sport Club prices, but could be useful for comparing competitor hotel prices in Eilat.
- **Feasibility:** NO for Isrotel Sport Club. YES for Fattal-owned hotels in Eilat only.

---

## 5. Dan Hotels (danhotels.com)
- **Type:** Dynamic SPA / Server-rendered hybrid
- **Scraping method:** Puppeteer
- **Search URL pattern:** `https://www.danhotels.com/search?destination=eilat&arrival=2026-08-02&departure=2026-08-08&adults=2&children=2`
- **Direct booking path:** Dan Hotels typically redirects to a booking engine like `https://reservations.danhotels.com/` or uses an embedded iframe with a third-party engine (e.g., Synxis/SHR).
- **Potential API pattern:** The reservation engine may have queryable endpoints. Check for calls to SHR/Synxis or similar booking engine APIs.
- **Blocking:** Low to Medium
- **Risk level:** Medium
- **Notes:** Dan Hotels is ANOTHER competing hotel chain. They only list their own properties (Dan Eilat, Dan Panorama Eilat, etc.). They do NOT carry Isrotel properties. Same as Fattal -- not relevant for Isrotel Sport Club, but useful for competitor price comparison.
- **Feasibility:** NO for Isrotel Sport Club. YES for Dan-owned hotels in Eilat only.

---

## 6. Brown Hotels (brownhotels.com)
- **Type:** Dynamic SPA (modern design, likely React/Vue)
- **Scraping method:** Puppeteer
- **Search URL pattern:** `https://www.brownhotels.com/search?checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2`
- **Booking engine:** Uses a third-party booking engine (likely integrated via iframe or redirect).
- **Blocking:** Low
- **Risk level:** Low
- **Notes:** Brown Hotels is a boutique hotel chain primarily in Tel Aviv, with some expansion to Jerusalem and other cities. They do NOT have properties in Eilat and do NOT list Isrotel properties. This site is NOT relevant for this specific search.
- **Feasibility:** NO - Brown Hotels has no Eilat properties and no Isrotel listings.

---

## 7. Astral Hotels (astral-hotels.com)
- **Type:** Server-rendered with dynamic booking widget (lighter JS)
- **Scraping method:** Puppeteer (for booking widget) / Cheerio (for static content)
- **Search URL pattern:** `https://www.astral-hotels.com/search?checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2&childAges=5,8`
- **Booking engine:** Astral is a smaller Eilat-focused chain. They likely use a simpler booking engine, possibly with direct availability endpoints.
- **Blocking:** Low
- **Risk level:** Low
- **Notes:** Astral Hotels is an Eilat-focused hotel chain (Astral Village, Astral Seaside, etc.). They only list THEIR OWN hotels. They do NOT carry Isrotel properties. However, they are a direct competitor in Eilat, so useful for price comparison.
- **Feasibility:** NO for Isrotel Sport Club. YES for Astral-owned Eilat hotels only.

---

## 8. Eshet Tours (eshet.com)
- **Type:** Dynamic SPA
- **Scraping method:** Puppeteer / API
- **Search URL pattern:** `https://www.eshet.com/hotels/israel/eilat?checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2&childAges=5,8`
- **Booking engine:** Eshet Tours is a major Israeli travel agency/OTA. They aggregate hotels from multiple chains. Uses a custom booking platform.
- **Potential API pattern:** Being an OTA, Eshet likely has backend search APIs. Look for XHR calls during search to endpoints like `/api/search`, `/api/hotels/availability`, or calls to a separate API subdomain.
- **Blocking:** Medium - May use Cloudflare or Incapsula/Imperva protection.
- **Risk level:** Medium to High
- **Notes:** Eshet Tours is a full-service travel agency that should have Isrotel Sport Club in their inventory. They sell packages and hotel-only bookings. Prices may include agency markup or could be competitive/discounted. This is a strong candidate for price comparison.
- **Feasibility:** YES - Should list Isrotel Sport Club with availability and pricing.

---

## 9. Hotel4U (hotel4u.co.il)
- **Type:** Dynamic SPA
- **Scraping method:** Puppeteer / API
- **Search URL pattern:** `https://www.hotel4u.co.il/search?destination=eilat&hotel=isrotel-sport-club&checkin=02/08/2026&checkout=08/08/2026&adults=2&children=2&child_age_1=5&child_age_2=8`
- **Booking engine:** Israeli hotel comparison/booking site. Aggregates multiple sources.
- **Potential API pattern:** Look for search API endpoints via XHR monitoring. May call `/api/search` or use a third-party comparison engine.
- **Blocking:** Low to Medium
- **Risk level:** Medium
- **Notes:** Hotel4U is an Israeli hotel booking platform that should carry multiple hotel chains including Isrotel. Good candidate for price comparison. May show prices from multiple room categories.
- **Feasibility:** YES - Should list Isrotel Sport Club.

---

## 10. Travelist (travelist.co.il)
- **Type:** Dynamic SPA (React-based)
- **Scraping method:** Puppeteer / API
- **Search URL pattern:** `https://www.travelist.co.il/hotels/eilat?checkin=2026-08-02&checkout=2026-08-08&adults=2&children=2&childAges=5,8`
- **Booking engine:** Travelist is a major Israeli travel deals platform. Uses a modern SPA architecture with dynamic content loading.
- **Potential API pattern:** Travelist likely has robust search APIs. Monitor XHR/Fetch calls for patterns like:
  - `https://www.travelist.co.il/api/search`
  - `https://api.travelist.co.il/hotels/search`
  - GraphQL endpoints
- **Blocking:** Medium to High - Travelist is a larger platform and may employ Cloudflare, Incapsula, or custom bot detection.
- **Risk level:** High
- **Notes:** Travelist is one of Israel's largest online travel platforms. They should have comprehensive hotel inventory including Isrotel Sport Club. They often feature deals and competitive pricing. However, they may have stronger anti-scraping measures due to their size.
- **Feasibility:** YES - Should list Isrotel Sport Club, but scraping may be challenging.

---

## Summary Matrix

| # | Site | Has Isrotel Sport Club? | Method | Risk | Feasibility | Priority |
|---|------|------------------------|--------|------|-------------|----------|
| 1 | daka90.co.il | Maybe (deals only) | Puppeteer | Medium | PARTIAL | Low |
| 2 | hotels.co.il | Yes (OTA) | Puppeteer/API | Medium | YES | High |
| 3 | isrotel.co.il | Yes (official) | Puppeteer/API | Medium | YES | Critical |
| 4 | fattal.co.il | No (competitor chain) | Puppeteer | Medium | NO | Skip |
| 5 | danhotels.com | No (competitor chain) | Puppeteer | Medium | NO | Skip |
| 6 | brownhotels.com | No (no Eilat) | Puppeteer | Low | NO | Skip |
| 7 | astral-hotels.com | No (competitor chain) | Puppeteer/Cheerio | Low | NO | Skip |
| 8 | eshet.com | Yes (travel agency) | Puppeteer/API | Medium-High | YES | High |
| 9 | hotel4u.co.il | Yes (OTA) | Puppeteer/API | Medium | YES | High |
| 10 | travelist.co.il | Yes (OTA) | Puppeteer/API | High | YES | Medium |

## Recommendations

### Tier 1 - Must Scrape (has Isrotel Sport Club pricing):
1. **isrotel.co.il** - Official source, most authoritative pricing
2. **hotels.co.il** - Israeli OTA with broad coverage
3. **eshet.com** - Major Israeli travel agency
4. **hotel4u.co.il** - Hotel comparison platform

### Tier 2 - Worth Trying:
5. **travelist.co.il** - Large OTA but higher blocking risk
6. **daka90.co.il** - Only if hotel has active deals

### Tier 3 - Skip for Isrotel Sport Club (competitor chains only):
7. fattal.co.il - Only Fattal properties
8. danhotels.com - Only Dan properties
9. brownhotels.com - Boutique Tel Aviv chain, no Eilat
10. astral-hotels.com - Only Astral properties in Eilat

### Technical Approach:
1. **All sites are SPA/dynamic** -- Puppeteer is required for all of them.
2. **API-first strategy**: Before building Puppeteer scrapers, use browser DevTools on each Tier 1 site to intercept XHR/Fetch calls during a search. If clean JSON API endpoints are found, use direct HTTP requests (much faster and more reliable than Puppeteer).
3. **Headless browser config**: Use `puppeteer-extra` with `stealth-plugin` to avoid detection. Rotate user agents. Add random delays between requests.
4. **Date format warning**: Israeli sites may use DD/MM/YYYY format. Verify each site's expected format.
5. **Children ages**: Most Israeli booking engines require children's ages. Default to reasonable ages (e.g., 5 and 8) if not specified.

### Critical Next Step:
Run live reconnaissance using Puppeteer with DevTools Protocol to intercept network requests on each Tier 1 site. This will reveal the actual API endpoints and request/response formats, which is the most valuable intelligence for building reliable scrapers.

---

## Live Investigation Results (2026-04-10)

### daka90.co.il — CONFIRMED
- Hotel ID: **17787** (ספורט קלאב ישרוטל Collection)
- Area ID: **76** (Eilat)
- URL: `/HotelsIsrael/HotelsIsraelSearchResults.aspx?areaId=76&hotelId=17787&checkInDate=DD-MM-YYYY&checkOutDate=DD-MM-YYYY&roomOccCode=220`
- Room occupancy code: `220` = 2 adults, 2 children, 0 infants
- Date format: DD-MM-YYYY
- Hotel data source: `/Include/json/searchEngineCombos_hotelsIsrael.js` (full hotel DB with IDs)

### hotels.co.il — CONFIRMED
- Search endpoint: `/results.cfm`
- Booking engine: `res.hotels.co.il/reservation/nsearch.php`
- Parameters: `fromDate`, `toDate` (YYYY-MM-DD), `pax_group` (adults|children|infants)
- Area search: `res.hotels.co.il/hotels/search-area.php`

### eshet.com — CONFIRMED
- Next.js SPA
- Eilat hotels: `/domestichotels/eilat`
- Has Isrotel Sport Club in inventory (confirmed via live fetch)
- Uses promotion IDs for hotel offers

### hotel4u.co.il — CONFIRMED
- ASP.NET site
- Eilat page: `/hoteleilat.asp`
- Guest format: `a2a,10,8` (2 adults, children ages 10, 8)
- Hotel detail: `/hotel/[hotel-name].asp`
- Deals: `/Deal.asp?Id=[ID]`

### isrotel.co.il — NEEDS PUPPETEER
- All direct URL patterns return 404 (SPA routing)
- Must navigate via homepage booking widget
- Intercept API calls for availability/pricing data

### travelist.co.il — LOW PRIORITY
- Primarily flights/packages, limited domestic hotel search
- URL: `/hotels` (international focus)
