#!/usr/bin/env node
/**
 * Migration script: SQLite (sql.js) -> PostgreSQL
 *
 * Usage:
 *   1. npm install sql.js  (temporary, for reading old SQLite DB)
 *   2. Start PostgreSQL (docker compose up -d postgres)
 *   3. node migrate-to-pg.js [path-to-sqlite-db]
 *      Default: data/claude_manager.db
 *   4. npm uninstall sql.js  (cleanup after migration)
 *
 * Environment variables for PostgreSQL connection:
 *   DB_HOST (default: localhost), DB_PORT (default: 5432),
 *   DB_NAME (default: claude_manager), DB_USER (default: claude_manager),
 *   DB_PASSWORD (default: claude_manager)
 */

const fs = require('fs');
const path = require('path');
const initSql = require('sql.js');
const { Pool } = require('pg');

const SQLITE_PATH = process.argv[2] || path.join(__dirname, 'data', 'claude_manager.db');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'claude_manager',
  user: process.env.DB_USER || 'claude_manager',
  password: process.env.DB_PASSWORD || '1123Azs+-',
});

async function migrate() {
  console.log(`Opening SQLite: ${SQLITE_PATH}`);
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`File not found: ${SQLITE_PATH}`);
    process.exit(1);
  }

  const SQL = await initSql();
  const buffer = fs.readFileSync(SQLITE_PATH);
  const sqliteDb = new SQL.Database(buffer);

  // Run PostgreSQL schema
  const schemaPath = path.join(__dirname, 'src', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      if (err.code !== '42P07' && err.code !== '42710') {
        console.warn('Schema warning:', err.message);
      }
    }
  }
  console.log('PostgreSQL schema ready.');

  // Migration order matters (foreign keys)
  const tables = [
    {
      name: 'projects',
      cols: ['id', 'name', 'path', 'description', 'created_at'],
      insert: 'INSERT INTO projects (id, name, path, description, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'sessions',
      cols: ['id', 'project_id', 'session_id', 'started_at', 'ended_at', 'summary'],
      insert: 'INSERT INTO sessions (id, project_id, session_id, started_at, ended_at, summary) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'prompts',
      cols: ['id', 'session_id', 'project_id', 'role', 'content', 'category', 'tags', 'created_at'],
      insert: 'INSERT INTO prompts (id, session_id, project_id, role, content, category, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'tool_uses',
      cols: ['id', 'session_id', 'project_id', 'tool_name', 'tool_input', 'file_path', 'success', 'created_at'],
      insert: 'INSERT INTO tool_uses (id, session_id, project_id, tool_name, tool_input, file_path, success, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'patterns',
      cols: ['id', 'project_id', 'type', 'title', 'description', 'source_prompt_id', 'confidence', 'times_referenced', 'is_active', 'created_at', 'updated_at'],
      insert: 'INSERT INTO patterns (id, project_id, type, title, description, source_prompt_id, confidence, times_referenced, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'phases',
      cols: ['id', 'project_id', 'phase_no', 'title', 'status', 'sort_order', 'created_at', 'updated_at'],
      insert: 'INSERT INTO phases (id, project_id, phase_no, title, status, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'tasks',
      cols: ['id', 'phase_id', 'project_id', 'task_no', 'title', 'detail', 'risks', 'status', 'completed_at', 'sort_order', 'created_at', 'updated_at'],
      insert: 'INSERT INTO tasks (id, phase_id, project_id, task_no, title, detail, risks, status, completed_at, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING',
    },
    {
      name: 'project_notes',
      cols: ['id', 'project_id', 'title', 'content', 'category', 'is_pinned', 'created_at', 'updated_at'],
      insert: 'INSERT INTO project_notes (id, project_id, title, content, category, is_pinned, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
    },
  ];

  for (const table of tables) {
    const colList = table.cols.join(', ');
    let rows;
    try {
      rows = sqliteDb.exec(`SELECT ${colList} FROM ${table.name}`);
    } catch (e) {
      console.log(`  ${table.name}: table not found in SQLite, skipping.`);
      continue;
    }

    if (!rows.length || !rows[0].values.length) {
      console.log(`  ${table.name}: 0 rows`);
      continue;
    }

    const data = rows[0].values;
    let count = 0;
    for (const row of data) {
      try {
        await pool.query(table.insert, row);
        count++;
      } catch (err) {
        // Skip constraint violations (duplicate data)
        if (err.code === '23505') continue; // unique_violation
        if (err.code === '23503') {
          // foreign key — log and skip
          console.warn(`  ${table.name} FK skip: row id=${row[0]}`);
          continue;
        }
        console.error(`  ${table.name} error:`, err.message, 'row:', row[0]);
      }
    }
    console.log(`  ${table.name}: ${count}/${data.length} rows migrated`);
  }

  // Fix sequences (SERIAL columns) so next insert gets correct ID
  for (const table of tables) {
    try {
      await pool.query(`SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${table.name}), 1))`);
    } catch (e) {
      // Some tables may not have serial sequence
    }
  }
  console.log('Sequences updated.');

  sqliteDb.close();
  await pool.end();
  console.log('\nMigration complete!');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
