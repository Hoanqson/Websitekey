const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const Redis = require('ioredis');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.static(path.join(__dirname, 'public')));

const YEUMONEY_TOKEN = 'b12dedf3e4c2bb1d1e86ad343f1954067fbe29e81b45f0e14d72eef867bafe24';
const ADMIN_PASSWORD = 'admin123'; // Thay bằng mật khẩu mạnh
const REDIS_URL = process.env.REDIS_URL || 'red-d32dg0gdl3ps7380pudg:6379'; // Thay bằng internal URL từ Render KV
const redis = new Redis(REDIS_URL); // Kết nối KV
let mainScript = `print("Default script: Key hợp lệ!")`;

// Middleware bảo mật admin
const authAdmin = (req, res, next) => {
  const { password } = req.body;
  if (req.method === 'POST' && !password) return res.status(400).json({ status: 'error', message: 'Missing password' });
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ status: 'error', message: 'Invalid password' });
  next();
};

// Lưu key vào Redis
async function saveKeyToRedis(key, keyData) {
  await redis.set(`key:${key}`, JSON.stringify(keyData), 'EX', 86400); // 24h TTL
}

// Lấy key từ Redis
async function getKeyFromRedis(key) {
  const data = await redis.get(`key:${key}`);
  return data ? JSON.parse(data) : null;
}

// Xóa key từ Redis
async function deleteKeyFromRedis(key) {
  await redis.del(`key:${key}`);
}

// Lấy tất cả key từ Redis (dùng SCAN để list)
async function getAllKeysFromRedis() {
  const keys = [];
  let cursor = 0;
  do {
    const [nextCursor, keyList] = await redis.scan(cursor, 'MATCH', 'key:*', 'COUNT', 100);
    cursor = parseInt(nextCursor);
    for (const k of keyList) {
      const data = await redis.get(k);
      if (data) keys.push({ key: k.replace('key:', ''), data: JSON.parse(data) });
    }
  } while (cursor !== 0);
  return keys;
}

// Endpoint tạo shortlink từ keyUrlId
app.post('/shorten', async (req, res) => {
  try {
    const keyUrlId = `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`;
    const keyUrl = `${req.protocol}://${req.get('host')}/key/${keyUrlId}`;
    
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
      const keyData = { createdAt: timestamp, shortUrl, keyUrl, keyUrlId, originalUrl: keyUrl };
      await saveKeyToRedis(key, keyData); // Lưu vĩnh viễn vào Redis
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
app.post('/verify', async (req, res) => {
  const { key } = req.body;
  const now = Date.now();
  const keyData = await getKeyFromRedis(key); // Lấy từ Redis

  if (keyData && (now - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    console.log(`Verified key: ${key}`);
    res.json({ valid: true, shortUrl: keyData.shortUrl, originalUrl: keyData.originalUrl, script: mainScript });
  } else {
    console.log(`Invalid/expired key: ${key}`);
    res.json({ valid: false, message: 'Key invalid or expired' });
  }
});

// Website nhỏ hiển thị key
app.get('/key/:keyUrlId', async (req, res) => {
  const keyUrlId = req.params.keyUrlId;
  console.log(`Accessing keyUrlId: ${keyUrlId}`);
  const allKeys = await getAllKeysFromRedis();
  const keyData = allKeys.find(k => k.data.keyUrlId === keyUrlId);
  if (keyData && (Date.now() - keyData.data.createdAt) < 24 * 60 * 60 * 1000) {
    res.sendFile(path.join(__dirname, 'public', 'key.html'));
  } else {
    console.log(`Key not found or expired for keyUrlId: ${keyUrlId}`);
    res.status(404).send('Key not found or expired');
  }
});

// API lấy key từ keyUrlId (dùng trong key.html)
app.get('/getKey/:keyUrlId', async (req, res) => {
  const keyUrlId = req.params.keyUrlId;
  const allKeys = await getAllKeysFromRedis();
  const keyData = allKeys.find(k => k.data.keyUrlId === keyUrlId);
  if (keyData && (Date.now() - keyData.createdAt) < 24 * 60 * 60 * 1000) {
    res.json({ status: 'success', key: keyData.key });
  } else {
    res.json({ status: 'error', message: 'Key not found or expired' });
  }
});

// Endpoint admin: Lấy danh sách key
app.post('/admin/keys', authAdmin, async (req, res) => {
  const allKeys = await getAllKeysFromRedis();
  const now = Date.now();
  const keys = allKeys.map(k => ({
    key: k.key,
    shortUrl: k.data.shortUrl,
    keyUrl: k.data.keyUrl,
    originalUrl: k.data.originalUrl,
    createdAt: new Date(k.data.createdAt).toLocaleString(),
    isExpired: (now - k.data.createdAt) >= 24 * 60 * 60 * 1000
  }));
  res.json(keys);
});

// Endpoint admin: Thêm key thủ công
app.post('/admin/addKey', authAdmin, async (req, res) => {
  const { key, shortUrl, keyUrl, originalUrl } = req.body;
  if (!key || !shortUrl) return res.status(400).json({ status: 'error', message: 'Missing key or shortUrl' });
  const timestamp = Date.now();
  const keyData = { createdAt: timestamp, shortUrl, keyUrl, keyUrlId: keyUrl.split('/').pop(), originalUrl };
  await saveKeyToRedis(key, keyData);
  res.json({ status: 'success', message: 'Key added' });
});

// Endpoint admin: Xóa key
app.post('/admin/deleteKey', authAdmin, async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ status: 'error', message: 'Missing key' });
  await deleteKeyFromRedis(key);
  res.json({ status: 'success', message: 'Key deleted' });
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
