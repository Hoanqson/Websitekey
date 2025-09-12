const express = require('express');
const cors = require('cors');  // Import cors để fix CORS
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Thêm CORS: Cho phép từ mọi origin (bao gồm Roblox)
app.use(cors({
  origin: '*',  // '*' cho test, sau có thể restrict nếu cần
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Token API yeumoney
const YEUMONEY_TOKEN = 'b12dedf3e4c2bb1d1e86ad343f1954067fbe29e81b45f0e14d72eef867bafe24';

// Lưu keys tạm (memory, mất khi restart; nếu cần persistent, thêm DB sau)
let validKeys = {};

// Endpoint bypass: Bypass yeumoney và tạo key 24h
app.post('/bypass', async (req, res) => {
  const { shortUrl } = req.body;
  if (!shortUrl) return res.status(400).json({ status: 'error', message: 'Missing shortUrl' });

  try {
    const apiUrl = `https://yeumoney.com/QL_api.php?token=${YEUMONEY_TOKEN}&format=json&url=${encodeURIComponent(shortUrl)}`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    if (data.status === 'success' && data.data && data.data.original_url) {
      const originalUrl = data.data.original_url;
      const timestamp = Date.now();
      const key = crypto.createHash('md5').update(originalUrl + timestamp).digest('hex').substring(0, 16);
      validKeys[key] = { createdAt: timestamp, originalUrl: originalUrl };
      res.json({ status: 'success', key: key, expiresIn: 24 * 60 * 60 * 1000 });
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
    res.json({ valid: true, originalUrl: keyData.originalUrl });
  } else {
    res.json({ valid: false, message: 'Key invalid or expired' });
  }
});

// Endpoint test GET đơn giản (để debug kết nối)
app.get('/test', (req, res) => {
  res.json({ message: 'Server ok! CORS và kết nối hoạt động.' });
});

// Chạy server
app.listen(port, () => {
  console.log(`Server chạy tại port ${port}`);
});
