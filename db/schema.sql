CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  hotel_name TEXT NOT NULL,
  destination TEXT,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 2,
  children INTEGER NOT NULL DEFAULT 0,
  target_price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'watching',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  price REAL NOT NULL,
  free_cancellation INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  scraped_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  price REAL NOT NULL,
  url TEXT,
  booked_at TEXT DEFAULT (datetime('now')),
  confirmation_status TEXT DEFAULT 'pending',
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);

CREATE TABLE IF NOT EXISTS scraper_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  logged_at TEXT DEFAULT (datetime('now'))
);

-- Default user for testing
INSERT OR IGNORE INTO users (id, email, name) VALUES (1, 'test@hotelbid.com', 'Test User');
