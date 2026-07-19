// CLI for managing license keys directly against the database. Run this
// from your own machine (with DATABASE_URL in .env pointed at the same
// Render Postgres the deployed service uses) - there's no HTTP admin
// endpoint to expose/secure separately.
require('dotenv').config();
const { pool, init } = require('./db');
const { randomKey } = require('./keys');

async function main() {
    await init();

    const [command, ...rest] = process.argv.slice(2);

    if (command === 'add') {
        const key = rest[0] || randomKey();
        const days = rest[1] ? parseInt(rest[1], 10) : null;
        const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;

        await pool.query(
            'INSERT INTO licenses (key, expires_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            [key, expiresAt]
        );
        console.log(`Added key: ${key}${expiresAt ? ` (expires ${expiresAt.toISOString()})` : ' (no expiry)'}`);
    }
    else if (command === 'disable') {
        const key = rest[0];
        await pool.query('UPDATE licenses SET active = false WHERE key = $1', [key]);
        console.log(`Disabled key: ${key}`);
    }
    else if (command === 'enable') {
        const key = rest[0];
        await pool.query('UPDATE licenses SET active = true WHERE key = $1', [key]);
        console.log(`Enabled key: ${key}`);
    }
    else if (command === 'unbind') {
        const key = rest[0];
        await pool.query('UPDATE licenses SET hwid = NULL WHERE key = $1', [key]);
        console.log(`Cleared HWID binding for key: ${key}`);
    }
    else if (command === 'list') {
        const result = await pool.query('SELECT key, hwid, active, expires_at, created_at FROM licenses ORDER BY created_at DESC');
        console.table(result.rows);
    }
    else {
        console.log('Usage:');
        console.log('  npm run keys -- add [key] [expiresInDays]   add a new key (random if omitted, no expiry if days omitted)');
        console.log('  npm run keys -- disable <key>                deactivate a key');
        console.log('  npm run keys -- enable <key>                 reactivate a key');
        console.log('  npm run keys -- unbind <key>                 clear a key\'s HWID binding (e.g. after a hardware change)');
        console.log('  npm run keys -- list                         list all keys');
    }

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
