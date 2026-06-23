// Vercel serverless entry — the same Express app, exported as a handler.
// All /api/* routes are rewritten here (see vercel.json); the Express router
// matches /api/news, /api/article, /api/categories internally.
const { app } = require("../server.js");
module.exports = app;
