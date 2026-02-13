const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'claude_manager.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Run schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.run(schema);

  // Create FTS tables if not exist
  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(content, tags)`);
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(title, description)`);
  } catch (e) {
    // FTS tables may already exist
  }

  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save periodically
let saveInterval = null;
function startAutoSave(intervalMs = 5000) {
  if (saveInterval) return;
  saveInterval = setInterval(save, intervalMs);
}

function stopAutoSave() {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  save(); // Final save
}

module.exports = { getDb, save, startAutoSave, stopAutoSave, DB_PATH };
