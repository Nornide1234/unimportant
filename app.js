require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { pool, init } = require('./db');
const { registerAdminRoutes } = require('./admin');

const app = express();
// KeyAuthClient.h's postRequest() sends CURLOPT_POSTFIELDS as a raw
// "key=val&key=val" string with no explicit Content-Type header, which curl
// defaults to application/x-www-form-urlencoded - urlencoded(), not json(),
// is what actually parses that into req.body.
app.use(express.urlencoded({ extended: true }));

function newSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// Single endpoint, routed on the "type" field - mirrors KeyAuth's own
// api/1.3/ shape (and the exact path KeyAuthClient.h already builds its URL
// against) so the C++ side only has to change the host, not its request-
// building logic. Response shape matches too: {success, message} always,
// plus {sessionid} for "init" - that's all KeyAuthClient::parseResponse()
// and KeyAuthClient::init() actually read.
app.post('/api/1.3/', async (req, res) => {
    const { type } = req.body;

    try {
        switch (type) {
            case 'init': {
                const sessionid = newSessionId();
                await pool.query('INSERT INTO sessions (session_id, key) VALUES ($1, NULL)', [sessionid]);
                return res.json({ success: true, message: 'Session created', sessionid });
            }

            case 'license': {
                const { key, hwid, sessionid } = req.body;
                if (!key || !sessionid) {
                    return res.json({ success: false, message: 'Missing key or session' });
                }

                const licResult = await pool.query('SELECT * FROM licenses WHERE key = $1', [key]);
                if (licResult.rowCount === 0) {
                    return res.json({ success: false, message: 'Invalid license key' });
                }
                const license = licResult.rows[0];

                if (!license.active) {
                    return res.json({ success: false, message: 'License has been disabled' });
                }
                if (license.expires_at && new Date(license.expires_at) < new Date()) {
                    return res.json({ success: false, message: 'License has expired' });
                }

                if (!license.hwid) {
                    // First successful use - bind this key to this device.
                    await pool.query('UPDATE licenses SET hwid = $1 WHERE key = $2', [hwid || '', key]);
                } else if (hwid && license.hwid !== hwid) {
                    return res.json({ success: false, message: 'License is bound to a different device' });
                }

                // A new successful login always wins: clear out any other
                // session(s) already tied to this key before attaching the
                // current one. This is deliberately more forgiving than
                // typical "one active session, login blocked until logout"
                // behavior - a session that never got a clean logout (the
                // game crashing instead of a normal eject, say) can then
                // never permanently lock out a future login, which is
                // exactly the "still thinks the client is injected" failure
                // mode the previous KeyAuth integration hit from having no
                // logout call at all.
                await pool.query('DELETE FROM sessions WHERE key = $1 AND session_id != $2', [key, sessionid]);
                await pool.query('UPDATE sessions SET key = $1, last_seen = now() WHERE session_id = $2', [key, sessionid]);

                return res.json({ success: true, message: 'License valid' });
            }

            case 'logout': {
                const { sessionid } = req.body;
                if (sessionid) {
                    await pool.query('DELETE FROM sessions WHERE session_id = $1', [sessionid]);
                }
                return res.json({ success: true, message: 'Logged out' });
            }

            default:
                return res.json({ success: false, message: 'Unknown request type' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/', (_req, res) => res.send('KeyServer is running.'));

registerAdminRoutes(app);

// Exported instead of called here - server.js (traditional/Docker hosts)
// awaits this then calls app.listen(); api/index.js (Vercel) awaits it on
// each cold start instead, since serverless functions have no persistent
// boot phase to run it in ahead of time. Either way CREATE TABLE IF NOT
// EXISTS only actually does anything on the very first call.
const ready = init();

module.exports = { app, ready };
