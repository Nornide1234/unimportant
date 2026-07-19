const { Pool } = require('pg');

// Every managed Postgres host we've pointed this at (Render, Supabase, Neon)
// requires SSL and hands you a chain that Node's default CA bundle won't
// validate - rejectUnauthorized:false is the standard workaround (still
// encrypted in transit, just not chain-validated). Only skipped for
// localhost/127.0.0.1, so local Postgres during development still works
// without SSL.
const dbUrl = process.env.DATABASE_URL || '';
const isLocalHost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
});

async function init() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS licenses (
            key TEXT PRIMARY KEY,
            hwid TEXT,
            active BOOLEAN NOT NULL DEFAULT true,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            key TEXT REFERENCES licenses(key) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
}

module.exports = { pool, init };
