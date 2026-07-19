const { app, ready } = require('./app');

const PORT = process.env.PORT || 3000;

ready
    .then(() => {
        app.listen(PORT, () => console.log(`KeyServer listening on port ${PORT}`));
    })
    .catch((err) => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });
