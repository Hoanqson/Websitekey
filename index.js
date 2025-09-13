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

// Phục vụ file tĩnh
app.use(express.static(path.join(__dirname, 'public')));

const YEUMONEY_TOKEN = 'b12dedf3e4c2bb1d1e86ad343f1954067fbe29e81b45f0e14d72eef867bafe24';
const ADMIN_PASSWORD = 'admin123'; // Thay bằng mật khẩu mạnh
let validKeys = {};
let mainScript = `print("Default script: Key hợp lệ!")`;

// Middleware bảo mật admin
const authAdmin = (req, res, next) => {
  const { password } = req.body;
  if (req.method === 'POST' && !password) return res.status(400).json({ status: 'error', message: 'Missing password' });
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ status: 'error', message: 'Invalid password' });
  next();
};

// Endpoint tạo shortlink từ keyUrlId
app.post('/shorten', async (req, res) => {
  try {
    // Tạo chuỗi random cho keyUrlId
    const keyUrlId = `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`;
    const keyUrl = `${req.protocol}://${req.get('host')}/key/${keyUrlId}`;
    
    // Tạo shortlink qua yeumoney
    const apiUrl = `https://yeumoney.com/QL_api.php?token=${YEUMONEY_TOKEN}&format=json&url=${encodeURIComponent(keyUrl)}`;
    console.log(`Calling yeumoney API: ${apiUrl}`);
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    console.log(`Yeumoney response: ${JSON.stringify(data)}`);

    if (data.status === 'success' && data.shortenedUrl) {
      const shortUrl = data.shortenedUrl;
      const timestamp = Date.now();
      const key = crypto.randomBytes(8).toString('hex');
      validKeys[key] = { createdAt: timestamp, shortUrl, keyUrl, keyUrlId, originalUrl: keyUrl };
      console.log(`Generated key: ${key}, keyUrlId: ${keyUrlId}, shortUrl: ${shortUrl}`);
      res.json({ status: 'success', shortUrl });
    } else {
      res.json({ status: 'error', message: data.message || 'Failed to create shortlink' });
    }
  } catch (error) {
    console.error('Shorten error:', error);
    res.status(500).json({ status: 'error', message: 'API error: ' + error.message });
  }
});

// Endpoint verify key
app.post('/verify', (req, res) => {
  const { key } = req.body;
  const now = Date.now();
  const keyData = validKeys[key];

  if (keyData && (now - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    console.log(`Verified key: ${key}`);
    res.json({ valid: true, shortUrl: keyData.shortUrl, originalUrl: keyData.originalUrl, script: mainScript });
  } else {
    console.log(`Invalid/expired key: ${key}`);
    res.json({ valid: false, message: 'Key invalid or expired' });
  }
});

// Website nhỏ hiển thị key
app.get('/key/:keyUrlId', (req, res) => {
  const keyUrlId = req.params.keyUrlId;
  console.log(`Accessing keyUrlId: ${keyUrlId}`);
  const keyData = Object.values(validKeys).find(data => data.keyUrlId === keyUrlId);
  if (keyData && (Date.now() - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    res.sendFile(path.join(__dirname, 'public', 'key.html'));
  } else {
    console.log(`Key not found or expired for keyUrlId: ${keyUrlId}`);
    res.status(404).send('Key not found or expired');
  }
});

// API lấy key từ keyUrlId (dùng trong key.html)
app.get('/getKey/:keyUrlId', (req, res) => {
  const keyUrlId = req.params.keyUrlId;
  const keyData = Object.values(validKeys).find(data => data.keyUrlId === keyUrlId);
  if (keyData && (Date.now() - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    const key = Object.keys(validKeys).find(key => validKeys[key].keyUrlId === keyUrlId);
    res.json({ status: 'success', key });
  } else {
    res.json({ status: 'error', message: 'Key not found or expired' });
  }
});

// Endpoint admin: Lấy danh sách key
app.post('/admin/keys', authAdmin, (req, res) => {
  const now = Date.now();
  const keys = Object.keys(validKeys).map(key => ({
    key,
    shortUrl: validKeys[key].shortUrl,
    keyUrl: validKeys[key].keyUrl,
    originalUrl: validKeys[key].originalUrl,
    createdAt: new Date(validKeys[key].createdAt).toLocaleString(),
    isExpired: (now - validKeys[key].createdAt) >= 24 * 60 * 60 * 1000
  }));
  res.json(keys);
});

// Endpoint admin: Lưu/lấy script Roblox
app.post('/admin/script', authAdmin, (req, res) => {
  const { script } = req.body;
  if (!script) return res.status(400).json({ status: 'error', message: 'Missing script' });
  mainScript = script;
  res.json({ status: 'success', message: 'Script updated' });
});

app.post('/admin/script/get', authAdmin, (req, res) => {
  res.json({ status: 'success', script: mainScript });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server ok!' });
});

// Website công khai
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Website admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(port, () => {
  console.log(`Server chạy tại port ${port}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
