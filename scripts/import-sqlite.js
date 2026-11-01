'use strict';

require('dotenv').config();

// Optional one-time helper for users who already have a local SQLite database.
// Install better-sqlite3 locally only when you need this script:
// npm install --no-save better-sqlite3

const path = require('node:path');
const { Pool } = require('pg');

async function main() {
  const sqlitePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'digital_saathi.db'));
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to your destination PostgreSQL database first.');

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    throw new Error('Optional dependency missing. Run "npm install --no-save better-sqlite3" and try again.');
  }

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });
  const fs = require('node:fs');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const exists = (table) => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

  try {
    await pool.query(schema);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (exists('learners')) {
        const rows = sqlite.prepare('SELECT * FROM learners ORDER BY id').all();
        for (const row of rows) {
          await client.query(
            `INSERT INTO learners
              (id, full_name, age, phone, location, learning_goal, experience, privacy_consent, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8)
             ON CONFLICT (id) DO NOTHING`,
            [row.id, row.full_name, row.age || null, row.phone || '', row.location || '', row.learning_goal || '', row.experience || 'Beginner', row.created_at || new Date()]
          );
        }
        console.log(`Learner rows found in SQLite: ${rows.length}`);
      }

      if (exists('videos')) {
        const rows = sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
        for (const row of rows) {
          await client.query(
            `INSERT INTO videos (id, title, category, description, video_url, created_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO NOTHING`,
            [row.id, row.title, row.category || 'General', row.description || '', row.video_url, row.created_at || new Date()]
          );
        }
        console.log(`Video rows found in SQLite: ${rows.length}`);
      }

      for (const table of ['learners', 'videos']) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id')::regclass, COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT MAX(id) IS NOT NULL FROM ${table}))`,
          [table]
        );
      }
      await client.query('COMMIT');
      console.log('SQLite data import completed. Existing PostgreSQL IDs were left unchanged.');
      console.log('Note: imported legacy learner rows are marked privacy_consent = FALSE because the old form did not record consent.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('SQLite import failed:', error.message);
  process.exitCode = 1;
});
