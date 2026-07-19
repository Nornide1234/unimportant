// Simple password-gated admin panel: view/add/disable/enable/unbind/delete
// keys from a browser instead of needing addkey.js's CLI on hand every time.
// Server-rendered HTML with plain <form> POSTs - no separate frontend build,
// no client-side JS beyond one confirm() on delete.
const crypto = require('crypto');
const { pool } = require('./db');
const { randomKey } = require('./keys');

function timingSafeEqualStr(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Still run a same-shaped comparison rather than returning
        // immediately, so a wrong-length guess doesn't complete faster than
        // a right-length one.
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminAuth(req, res, next) {
    const expectedUser = process.env.ADMIN_USER || 'admin';
    const expectedPass = process.env.ADMIN_PASSWORD;
    if (!expectedPass) {
        return res.status(500).send('ADMIN_PASSWORD is not set - admin panel is disabled until it is.');
    }

    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const sep = decoded.indexOf(':');
        const reqUser = sep >= 0 ? decoded.slice(0, sep) : decoded;
        const reqPass = sep >= 0 ? decoded.slice(sep + 1) : '';

        if (timingSafeEqualStr(reqUser, expectedUser) && timingSafeEqualStr(reqPass, expectedPass)) {
            return next();
        }
    }

    res.set('WWW-Authenticate', 'Basic realm="KeyServer Admin"');
    return res.status(401).send('Authentication required.');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function renderAdminPage(rows) {
    const tableRows = rows.map((k) => `
        <tr>
            <td class="mono">${escapeHtml(k.key)}</td>
            <td class="mono">${escapeHtml(k.hwid || '')}</td>
            <td>${k.active ? '<span class="ok">active</span>' : '<span class="bad">disabled</span>'}</td>
            <td>${k.expires_at ? new Date(k.expires_at).toLocaleString() : 'never'}</td>
            <td>${new Date(k.created_at).toLocaleString()}</td>
            <td class="actions">
                <form method="POST" action="/admin/keys/${encodeURIComponent(k.key)}/${k.active ? 'disable' : 'enable'}">
                    <button type="submit">${k.active ? 'Disable' : 'Enable'}</button>
                </form>
                <form method="POST" action="/admin/keys/${encodeURIComponent(k.key)}/unbind">
                    <button type="submit">Unbind</button>
                </form>
                <form method="POST" action="/admin/keys/${encodeURIComponent(k.key)}/delete" onsubmit="return confirm('Delete this key permanently?');">
                    <button type="submit" class="danger">Delete</button>
                </form>
            </td>
        </tr>`).join('');

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>KeyServer Admin</title>
<style>
    body { background:#111318; color:#e6e6ea; font-family:'Segoe UI',sans-serif; margin:0; padding:24px; }
    h1 { font-size:20px; margin-bottom:16px; font-weight:600; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #2a2d36; font-size:13px; }
    th { color:#9a9ea8; font-weight:600; text-transform:uppercase; font-size:11px; }
    .mono { font-family:Consolas,monospace; }
    .ok { color:#4ade80; }
    .bad { color:#f87171; }
    .actions { display:flex; gap:6px; }
    .actions form { display:inline; margin:0; }
    button { background:#1c1f27; color:#e6e6ea; border:1px solid #2a2d36; border-radius:4px; padding:4px 8px; cursor:pointer; font-size:12px; }
    button:hover { background:#262a34; }
    button.danger { border-color:#7f1d1d; color:#f87171; }
    .addform { display:flex; gap:8px; margin-bottom:20px; align-items:center; }
    .addform input { background:#1c1f27; color:#e6e6ea; border:1px solid #2a2d36; border-radius:4px; padding:6px 8px; font-size:13px; }
    .addform button { padding:6px 12px; }
</style>
</head>
<body>
    <h1>KeyServer &mdash; ${rows.length} key${rows.length === 1 ? '' : 's'}</h1>
    <form class="addform" method="POST" action="/admin/keys/add">
        <input type="text" name="key" placeholder="Custom key (blank = random)">
        <input type="number" name="days" placeholder="Expires in days (blank = never)">
        <button type="submit">Add key</button>
    </form>
    <table>
        <thead>
            <tr><th>Key</th><th>HWID</th><th>Status</th><th>Expires</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody>
            ${tableRows || '<tr><td colspan="6" style="color:#6b6f79;">No keys yet.</td></tr>'}
        </tbody>
    </table>
</body>
</html>`;
}

function registerAdminRoutes(app) {
    app.get('/admin', requireAdminAuth, async (_req, res) => {
        const result = await pool.query('SELECT key, hwid, active, expires_at, created_at FROM licenses ORDER BY created_at DESC');
        res.set('Content-Type', 'text/html').send(renderAdminPage(result.rows));
    });

    app.post('/admin/keys/add', requireAdminAuth, async (req, res) => {
        const key = (req.body.key || '').trim() || randomKey();
        const days = req.body.days ? parseInt(req.body.days, 10) : null;
        const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;

        await pool.query(
            'INSERT INTO licenses (key, expires_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            [key, expiresAt]
        );
        res.redirect('/admin');
    });

    app.post('/admin/keys/:key/disable', requireAdminAuth, async (req, res) => {
        await pool.query('UPDATE licenses SET active = false WHERE key = $1', [req.params.key]);
        res.redirect('/admin');
    });

    app.post('/admin/keys/:key/enable', requireAdminAuth, async (req, res) => {
        await pool.query('UPDATE licenses SET active = true WHERE key = $1', [req.params.key]);
        res.redirect('/admin');
    });

    app.post('/admin/keys/:key/unbind', requireAdminAuth, async (req, res) => {
        await pool.query('UPDATE licenses SET hwid = NULL WHERE key = $1', [req.params.key]);
        res.redirect('/admin');
    });

    app.post('/admin/keys/:key/delete', requireAdminAuth, async (req, res) => {
        await pool.query('DELETE FROM licenses WHERE key = $1', [req.params.key]);
        res.redirect('/admin');
    });
}

module.exports = { registerAdminRoutes };
