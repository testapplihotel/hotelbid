const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Railway: use /data volume for persistent storage if available
// Local: use db/ directory in project root
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
const DB_PATH = path.join(DATA_DIR, 'hotelbid.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

function getDb() {
  if (!db) {
    // Ensure data directory exists (for Railway volume)
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    console.log(`[db] SQLite initialized at ${DB_PATH}`);
  }
  return db;
}

module.exports = { getDb };
