// Trong index.js, thay thế hoàn toàn
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
const ADMIN_PASSWORD = 'admin123'; // Thay mạnh hơn
const REDIS_URL = process.env.REDIS_URL || 'redis://red-d32drbruibrs739opo7g:6379'; // Fallback KV
let mainScript = `print("Default script: Key hợp lệ!")`;

// Kết nối Redis với retry và error handling
let redis;
async function connectRedis() {
  try {
    redis = new Redis(REDIS_URL, {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 5000,
      commandTimeout: 5000
    });
    await redis.ping(); // Test kết nối
    console.log('Connected to Redis KV successfully!');
  } catch (error) {
    console.error('Redis connection failed:', error.message);
    redis = null; // Fallback: Không dùng Redis nếu fail
  }
  redis.on('error', (err) => console.error('Redis error:', err.message));
  redis.on('connect', () => console.log('Redis connected!'));
  redis.on('ready', () => console.log('Redis ready!'));
}
connectRedis();

// Fallback nếu Redis unavailable
async function saveKeyToRedis(key, keyData) {
  if (!redis) {
    console.warn('Redis unavailable, fallback to memory');
    if (!global.validKeys) global.validKeys = {};
    global.validKeys[key] = keyData;
    return;
  }
  try {
    await redis.set(`key:${key}`, JSON.stringify(keyData), 'EX', keyData.expiresIn || 86400); // TTL từ keyData
    console.log(`Saved key to Redis: ${key}`);
  } catch (error) {
    console.error('Error saving to Redis:', error.message);
    if (!global.validKeys) global.validKeys = {};
    global.validKeys[key] = keyData;
  }
}

async function getKeyFromRedis(key) {
  if (!redis) {
    if (global.validKeys) return global.validKeys[key];
    return null;
  }
  try {
    const data = await redis.get(`key:${key}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error getting from Redis:', error.message);
    if (global.validKeys) return global.validKeys[key];
    return null;
  }
}

async function deleteKeyFromRedis(key) {
  if (!redis) {
    if (global.validKeys) delete global.validKeys[key];
    return;
  }
  try {
    await redis.del(`key:${key}`);
    console.log(`Deleted key from Redis: ${key}`);
  } catch (error) {
    console.error('Error deleting from Redis:', error.message);
    if (global.validKeys) delete global.validKeys[key];
  }
}

async function getAllKeysFromRedis() {
  if (!redis) {
    if (global.validKeys) {
      const now = Date.now();
      const keys = Object.keys(global.validKeys).map(k => ({
        key: k,
        shortUrl: global.validKeys[k].shortUrl,
        keyUrl: global.validKeys[k].keyUrl,
        originalUrl: global.validKeys[k].originalUrl,
        createdAt: new Date(global.validKeys[k].createdAt).toLocaleString(),
        isExpired: (now - global.validKeys[k].createdAt) >= (global.validKeys[k].expiresIn || 86400) * 1000
      }));
      return keys;
    }
    return [];
  }
  try {
    const keys = [];
    let cursor = 0;
    do {
      const [nextCursor, keyList] = await redis.scan(cursor, 'MATCH', 'key:*', 'COUNT', 100);
      cursor = parseInt(nextCursor);
      for (const k of keyList) {
        const data = await redis.get(k);
        if (data) {
          const parsed = JSON.parse(data);
          keys.push({ key: k.replace('key:', ''), data: parsed });
        }
      }
    } while (cursor !== 0);
    return keys;
  } catch (error) {
    console.error('Error getting all keys from Redis:', error.message);
    if (global.validKeys) {
      const now = Date.now();
      const keys = Object.keys(global.validKeys).map(k => ({
        key: k,
        shortUrl: global.validKeys[k].shortUrl,
        keyUrl: global.validKeys[k].keyUrl,
        originalUrl: global.validKeys[k].originalUrl,
        createdAt: new Date(global.validKeys[k].createdAt).toLocaleString(),
        isExpired: (now - global.validKeys[k].createdAt) >= (global.validKeys[k].expiresIn || 86400) * 1000
      }));
      return keys;
    }
    return [];
  }
}

// Endpoint tạo shortlink
app.post('/shorten', async (req, res) => {
  try {
    const keyUrlId = `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`;
    const keyUrl = `${req.protocol}://${req.get('host')}/key/${keyUrlId}`;
    
    const apiUrl = `https://yeumoney.com/QL_api.php?token=${YEUMONEY_TOKEN}&format=json&url=${encodeURIComponent(keyUrl)}`;
    console.log(`Calling yeumoney API: ${apiUrl}`);
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    console.log(`Yeumoney response: ${JSON.stringify(data)}`);

    if (data.status === 'success' && data.shortenedUrl) {
      const shortUrl = data.shortenedUrl;
      const timestamp = Date.now();
      const key = crypto.randomBytes(8).toString('hex');
      const keyData = { createdAt: timestamp, shortUrl, keyUrl, keyUrlId, originalUrl: keyUrl, expiresIn: 24 * 60 * 60 }; // 24h TTL
      await saveKeyToRedis(key, keyData);
      console.log(`Generated key: ${key}, keyUrlId: ${keyUrlId}, shortUrl: ${shortUrl}`);
      res.json({ status: 'success', shortUrl });
    } else {
      res.json({ status: 'error', message: data.message || 'Failed to create shortlink' });
    }
  } catch (error) {
    console.error('Shorten error:', error.message);
    res.status(500).json({ status: 'error', message: 'API error: ' + error.message });
  }
});

// Endpoint verify key
app.post('/verify', async (req, res) => {
  const { key } = req.body;
  const now = Date.now();
  const keyData = await getKeyFromRedis(key);

  if (keyData && (now - keyData.createdAt) < (keyData.expiresIn || 86400) * 1000) {
    console.log(`Verified key: ${key}`);
    res.json({ valid: true, shortUrl: keyData.shortUrl, originalUrl: keyData.originalUrl, script: mainScript });
  } else {
    console.log(`Invalid/expired key: ${key}`);
    res.json({ valid: false, message: 'Key invalid or expired' });
  }
});

// Các endpoint khác
app.get('/key/:keyUrlId', async (req, res) => {
  const keyUrlId = req.params.keyUrlId;
  console.log(`Accessing keyUrlId: ${keyUrlId}`);
  const allKeys = await getAllKeysFromRedis();
  const keyData = allKeys.find(k => k.data.keyUrlId === keyUrlId);
  if (keyData && (Date.now() - keyData.data.createdAt) < (keyData.data.expiresIn || 86400) * 1000) {
    res.sendFile(path.join(__dirname, 'public', 'key.html'));
  } else {
    console.log(`Key not found or expired for keyUrlId: ${keyUrlId}`);
    res.status(404).send('Key not found or expired');
  }
});

app.get('/getKey/:keyUrlId', async (req, res) => {
  const keyUrlId = req.params.keyUrlId;
  const allKeys = await getAllKeysFromRedis();
  const keyData = allKeys.find(k => k.data.keyUrlId === keyUrlId);
  if (keyData && (Date.now() - keyData.data.createdAt) < (keyData.data.expiresIn || 86400) * 1000) {
    res.json({ status: 'success', key: keyData.key });
  } else {
    res.json({ status: 'error', message: 'Key not found or expired' });
  }
});

app.post('/admin/keys', authAdmin, async (req, res) => {
  const allKeys = await getAllKeysFromRedis();
  const now = Date.now();
  const keys = allKeys.map(k => ({
    key: k.key,
    shortUrl: k.data.shortUrl,
    keyUrl: k.data.keyUrl,
    originalUrl: k.data.originalUrl,
    createdAt: new Date(k.data.createdAt).toLocaleString(),
    isExpired: (now - k.data.createdAt) >= (k.data.expiresIn || 86400) * 1000
  }));
  res.json(keys);
});

app.post('/admin/addKey', authAdmin, async (req, res) => {
  const { key, shortUrl, keyUrl, duration = 24 } = req.body;
  if (!key || !shortUrl || !keyUrl) return res.status(400).json({ status: 'error', message: 'Missing key, shortUrl, or keyUrl' });
  const timestamp = Date.now();
  const keyUrlId = keyUrl.split('/').pop() || key;
  const keyData = { createdAt: timestamp, shortUrl, keyUrl, keyUrlId, originalUrl: keyUrl, expiresIn: duration * 60 * 60 }; // Chuyển giờ sang giây
  await saveKeyToRedis(key, keyData);
  res.json({ status: 'success', message: 'Key added' });
});

app.post('/admin/deleteKey', authAdmin, async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ status: 'error', message: 'Missing key' });
  await deleteKeyFromRedis(key);
  res.json({ status: 'success', message: 'Key deleted' });
});

app.post('/admin/script', authAdmin, (req, res) => {
  const { script } = req.body;
  if (!script) return res.status(400).json({ status: 'error', message: 'Missing script' });
  mainScript = script;
  res.json({ status: 'success', message: 'Script updated' });
});

app.post('/admin/script/get', authAdmin, (req, res) => {
  res.json({ status: 'success', script: mainScript });
});

app.get('/test-redis', async (req, res) => {
  try {
    if (redis) {
      await redis.ping();
      res.json({ status: 'success', message: 'Redis connected!' });
    } else {
      res.json({ status: 'error', message: 'Redis not connected' });
    }
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

app.get('/test', (req, res) => {
  res.json({ message: 'Server ok!' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(port, () => {
  console.log(`Server chạy tại port ${port}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
