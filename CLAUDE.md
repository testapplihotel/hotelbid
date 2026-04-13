# HotelBid — Project Rules

## What is HotelBid?
Reverse hotel booking: user sets a target price, the app monitors prices across multiple Israeli hotel/travel sites and auto-books when the price drops below target (free cancellation only).

## Stack
- Backend: Node.js + Express
- Database: SQLite via better-sqlite3
- Scraping: Puppeteer (dynamic sites) + Cheerio (static sites)
- Frontend: Vanilla HTML/CSS/JS + Chart.js
- Scheduling: node-cron (every 2h)
- Email: Nodemailer

## Key Rules
1. All prices in NIS (ILS)
2. Only book offers with free cancellation
3. Scraper output format: { source, hotel, prix_total, devise, free_cancellation, lien_reservation, timestamp }
4. Max API budget: $50/month (SerpApi)
5. Retry with exponential backoff on failures
6. Rotate User-Agent on every request
7. Log every scraper call: success/failure/duration
8. If a source is down 2h+, flag it

## Database Tables
- users: id, email, name, created_at
- alerts: id, user_id, hotel_name, destination, check_in, check_out, adults, children, target_price, status, created_at
- price_history: id, alert_id, source, price, free_cancellation, url, scraped_at
- bookings: id, alert_id, source, price, url, booked_at, confirmation_status

## Absolute Rule
Never hand back to the user on a technical error. Always diagnose and fix autonomously.

## API Endpoints
- GET/POST /api/alerts
- GET /api/alerts/:id
- PUT /api/alerts/:id
- DELETE /api/alerts/:id
- GET /api/alerts/:id/prices
- GET /api/bookings
- POST /api/scan/:alertId (manual trigger)
