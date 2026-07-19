const { app, ready } = require('../app');

// Vercel calls this per-request instead of running app.listen() - an Express
// app is itself a valid (req, res) handler, so awaiting the DB-init promise
// first and then handing off to it is all that's needed.
module.exports = async (req, res) => {
    await ready;
    app(req, res);
};
