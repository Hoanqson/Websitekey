const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Phục vụ file tĩnh (website HTML)
app.use(express.static(path.join(__dirname, 'public')));

const YEUMONEY_TOKEN = 'b12dedf3e4c2bb1d1e86ad343f1954067fbe29e81b45f0e14d72eef867bafe24';
let validKeys = {};

// Endpoint tạo shortlink qua yeumoney và sinh key 24h
app.post('/shorten', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });

  try {
    const apiUrl = `https://yeumoney.com/QL_api.php?token=${YEUMONEY_TOKEN}&format=json&url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.status === 'success' && data.shortenedUrl) {
      const shortUrl = data.shortenedUrl;
      const timestamp = Date.now();
      const randomPart = crypto.randomBytes(4).toString('hex');
      const key = crypto.createHash('md5').update(shortUrl + randomPart + timestamp).digest('hex').substring(0, 16);
      validKeys[key] = { createdAt: timestamp, shortUrl: shortUrl, originalUrl: url };
      res.json({ status: 'success', key: key, shortUrl: shortUrl, expiresIn: 24 * 60 * 60 * 1000 });
    } else {
      res.json({ status: 'error', message: data.message || 'Failed to create shortlink' });
    }
  } catch (error) {
    console.error('Shorten error:', error);
    res.status(500).json({ status: 'error', message: 'API error: ' + error.message });
  }
});

// Endpoint tạo key random
app.post('/generate', (req, res) => {
  const key = crypto.randomBytes(8).toString('hex');
  const timestamp = Date.now();
  validKeys[key] = { createdAt: timestamp, shortUrl: 'none', originalUrl: 'none' };
  res.json({ status: 'success', key: key, expiresIn: 24 * 60 * 60 * 1000 });
});

// Endpoint verify key
app.post('/verify', (req, res) => {
  const { key } = req.body;
  const now = Date.now();
  const keyData = validKeys[key];

  if (keyData && (now - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    res.json({ valid: true, shortUrl: keyData.shortUrl, originalUrl: keyData.originalUrl });
  } else {
    res.json({ valid: false, message: 'Key invalid or expired' });
  }
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server ok!' });
});

// Phục vụ website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server chạy tại port ${port}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
