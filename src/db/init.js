const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'claude_manager',
  user: process.env.DB_USER || 'claude_manager',
  password: process.env.DB_PASSWORD || '1123Azs+-',
  client_encoding: 'UTF8',
});

// SQL compatibility: translate SQLite syntax to PostgreSQL
function translateSql(sql) {
  let s = sql;

  // last_insert_rowid() -> lastval()
  s = s.replace(/last_insert_rowid\(\)/gi, 'lastval()');

  // datetime('now', '-' || ? || ' days') -> NOW() - (? * INTERVAL '1 day')
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*'\s*days'\s*\)/gi,
    "NOW() - (? * INTERVAL '1 day')"
  );

  // MIN(confidence + 0.1, 1.0) -> LEAST(confidence + 0.1, 1.0)
  s = s.replace(
    /MIN\s*\(\s*confidence\s*\+\s*0\.1\s*,\s*1\.0\s*\)/gi,
    'LEAST(confidence + 0.1, 1.0)'
  );

  // Convert ? placeholders to $1, $2, ...
  let idx = 0;
  s = s.replace(/\?/g, () => `$${++idx}`);

  return s;
}

// Wrapper: mimics sql.js API but uses PostgreSQL
class DbWrapper {
  async exec(sql, params = []) {
    const translated = translateSql(sql);
    try {
      const result = await pool.query(translated, params);
      if (!result.rows || !result.rows.length) return [];

      const columns = result.fields.map(f => f.name);
      const values = result.rows.map(row => columns.map(col => row[col]));

      return [{ columns, values }];
    } catch (err) {
      // FTS virtual tables don't exist in PostgreSQL — silently skip
      if (err.code === '42P01') return []; // undefined_table
      throw err;
    }
  }

  async run(sql, params = []) {
    const translated = translateSql(sql);
    try {
      await pool.query(translated, params);
    } catch (err) {
      if (err.code === '42P01') return; // undefined_table (FTS)
      throw err;
    }
  }
}

let db = null;

async function getDb() {
  if (db) return db;

  // Run schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      // Ignore "already exists" errors
      if (err.code !== '42P07' && err.code !== '42710') {
        console.error('Schema warning:', err.message);
      }
    }
  }

  db = new DbWrapper();
  return db;
}

// save() is a no-op — PostgreSQL writes to disk immediately
function save() {}

function startAutoSave() {}
function stopAutoSave() {}

function gracefulShutdown(reason) {
  console.log(`\nShutting down: ${reason}`);
  pool.end().then(() => {
    console.log('PostgreSQL pool closed. Bye.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { getDb, save, startAutoSave, stopAutoSave, gracefulShutdown, pool };
