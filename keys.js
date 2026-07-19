// Shared by server.js's admin routes and addkey.js's CLI, so "what does a
// randomly-generated key look like" only has one definition.
const crypto = require('crypto');

function randomKey() {
    const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

module.exports = { randomKey };
