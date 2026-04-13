require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');
const { startCron } = require('./scanner');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[hotelbid] Server running on http://localhost:${PORT}`);
  startCron();
});
