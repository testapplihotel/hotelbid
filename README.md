# HotelBid

HotelBid is a reverse hotel-booking platform for Israeli hotels. Users set their target price for a hotel stay, and HotelBid continuously scrapes prices from 10+ Israeli hotel sites (Isrotel, Fattal, Dan, Daka90, Eshet, and more) plus Google Hotels via SerpApi. When the price drops to or below the target, the user is notified by email so they can book immediately.

## Local Development

```bash
# Install dependencies
npm install

# Copy the example env file and fill in your keys
cp .env.example .env

# Start the server (port 3000 by default)
npm start

# Or use watch mode for development
npm run dev
```

The app runs at `http://localhost:3000`. Without a `BROWSERLESS_KEY`, scrapers will launch a local Chromium instance via Puppeteer.

## Deploying to Railway

### Step-by-step

1. Install the Railway CLI:
   ```bash
   npm install -g @railway/cli
   ```

2. Log in to Railway:
   ```bash
   railway login
   ```

3. Initialize a new Railway project (from the repo root):
   ```bash
   railway init
   ```

4. Deploy:
   ```bash
   railway up
   ```

5. Set the required environment variables:
   ```bash
   railway variables set SERPAPI_KEY=your_key
   railway variables set BROWSERLESS_KEY=your_key
   railway variables set SMTP_HOST=smtp.gmail.com
   railway variables set SMTP_PORT=587
   railway variables set SMTP_USER=your_email@gmail.com
   railway variables set SMTP_PASS=your_app_password
   ```

Railway will automatically detect the Node.js project via Nixpacks, install dependencies, and start the server using `node server.js`. The health check endpoint is `/api/scraper-status`.

## Required Environment Variables

| Variable | Description | Required |
|---|---|---|
| `SERPAPI_KEY` | SerpApi key for Google Hotels search | Yes |
| `BROWSERLESS_KEY` | Browserless.io token for cloud browser sessions | Yes (production) |
| `SMTP_HOST` | SMTP server hostname | Yes |
| `SMTP_PORT` | SMTP server port | Yes |
| `SMTP_USER` | SMTP username / email | Yes |
| `SMTP_PASS` | SMTP password or app password | Yes |
| `PORT` | Server port (default: 3000) | No |

## Getting Free API Keys

### SerpApi (Google Hotels)
1. Sign up at https://serpapi.com/users/sign_up
2. The free tier includes 100 searches per month
3. Copy your API key from the dashboard

### Browserless.io (Cloud Browser)
1. Sign up at https://www.browserless.io/sign-up
2. The free tier includes 1000 browser sessions per month
3. Copy your API token from the dashboard
4. Without this key, scrapers fall back to a local Chromium instance (not available on Railway)
