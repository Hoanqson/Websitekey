const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const YEUMONEY_TOKEN = 'b12dedf3e4c2bb1d1e86ad343f1954067fbe29e81b45f0e14d72eef867bafe24';
let validKeys = {};

// Endpoint tạo key ngẫu nhiên (random 16 ký tự, lưu 24h)
app.post('/generate', (req, res) => {
  const key = crypto.randomBytes(8).toString('hex'); // Key random 16 ký tự
  const timestamp = Date.now();
  validKeys[key] = { createdAt: timestamp, originalUrl: 'generated-random' }; // Có thể add URL nếu cần
  res.json({ status: 'success', key: key, expiresIn: 24 * 60 * 60 * 1000 });
});

// Endpoint bypass yeumoney + tạo key từ URL gốc (kết hợp random để unique)
app.post('/bypass', async (req, res) => {
  const { shortUrl } = req.body;
  if (!shortUrl) return res.status(400).json({ status: 'error', message: 'Missing shortUrl' });

  try {
    const apiUrl = `https://yeumoney.com/QL_api.php?token=${YEUMONEY_TOKEN}&format=json&url=${encodeURIComponent(shortUrl)}`;
    const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.status === 'success' && data.data && data.data.original_url) {
      const originalUrl = data.data.original_url;
      const timestamp = Date.now();
      const randomPart = crypto.randomBytes(4).toString('hex'); // Thêm random để key unique
      const key = crypto.createHash('md5').update(originalUrl + randomPart + timestamp).digest('hex').substring(0, 16);
      validKeys[key] = { createdAt: timestamp, originalUrl: originalUrl };
      res.json({ status: 'success', key: key, originalUrl: originalUrl, expiresIn: 24 * 60 * 60 * 1000 });
    } else {
      res.json({ status: 'error', message: data.message || 'Bypass failed' });
    }
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'API error: ' + error.message });
  }
});

// Endpoint verify key
app.post('/verify', (req, res) => {
  const { key } = req.body;
  const now = Date.now();
  const keyData = validKeys[key];

  if (keyData && (now - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    res.json({ valid: true, originalUrl: keyData.originalUrl || 'no-url' });
  } else {
    res.json({ valid: false, message: 'Key invalid or expired' });
  }
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server ok!' });
});

app.listen(port, () => {
  console.log(`Server chạy tại port ${port}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
