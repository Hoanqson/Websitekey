const express = require('express');
const crypto = require('crypto'); // Để hash tạo key
const app = express();
const port = process.env.PORT || 3000; // Render dùng PORT env

app.use(express.json());

// Token API yeumoney (thay nếu cần)
const YEUMONEY_TOKEN = 'b12dedf3e4c2bb1d1e86ad343f1954067fbe29e81b45f0e14d72eef867bafe24';

// Lưu keys: {key: {createdAt: timestamp, originalUrl: url}}
let validKeys = {};

// Endpoint bypass: Gọi API yeumoney để lấy URL đích, tạo key 24h
app.post('/bypass', async (req, res) => {
    const { shortUrl } = req.body;
    if (!shortUrl) return res.json({ status: 'error', message: 'Missing shortUrl' });

    try {
        // Gọi API yeumoney (GET request)
        const apiUrl = `https://yeumoney.com/QL_api.php?token=${YEUMONEY_TOKEN}&format=json&url=${encodeURIComponent(shortUrl)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.status === 'success' && data.data && data.data.original_url) {
            const originalUrl = data.data.original_url;
            // Tạo key: Hash MD5 của originalUrl + timestamp (để unique và 24h)
            const timestamp = Date.now();
            const key = crypto.createHash('md5').update(originalUrl + timestamp).digest('hex').substring(0, 16); // Key 16 ký tự
            validKeys[key] = { createdAt: timestamp, originalUrl: originalUrl };

            res.json({ status: 'success', key: key, expiresIn: 24 * 60 * 60 * 1000 }); // 24h ms
        } else {
            res.json({ status: 'error', message: data.message || 'Bypass failed' });
        }
    } catch (error) {
        res.json({ status: 'error', message: 'API error: ' + error.message });
    }
});

// Endpoint verify key
app.post('/verify', (req, res) => {
    const { key } = req.body;
    const now = Date.now();
    const keyData = validKeys[key];

    if (keyData && (now - keyData.createdAt) < 24 * 60 * 60 * 1000) { // 24h
        res.json({ valid: true, originalUrl: keyData.originalUrl });
    } else {
        res.json({ valid: false, message: 'Key invalid or expired' });
    }
});

// Chạy server
app.listen(port, () => {
    console.log(`Server chạy tại port ${port}`);
});
