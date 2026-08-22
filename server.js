const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.json());

let latestQR = null;
let clientReady = false;
let client;

function initClient() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './wa-session' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', async (qr) => {
    latestQR = await qrcode.toDataURL(qr);
    clientReady = false;
    console.log('QR generated - scan at /  (waiting for scan)');
  });

  client.on('ready', () => {
    clientReady = true;
    latestQR = null;
    console.log('WhatsApp client ready');
  });

  client.on('auth_failure', (msg) => {
    console.error('Auth failure:', msg);
    clientReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason, '- reinitializing');
    clientReady = false;
    latestQR = null;
    setTimeout(initClient, 3000);
  });

  client.initialize();
}

initClient();

// ---- status / QR endpoints ----

app.get('/api/status', (req, res) => {
  res.json({ ready: clientReady, hasQR: !!latestQR });
});

app.get('/api/qr', (req, res) => {
  if (!latestQR) return res.status(404).json({ error: 'No QR available right now' });
  res.json({ qr: latestQR });
});

// ---- job handling ----

const jobs = {}; // in-memory job store (fine for a single-user personal tool)

function normalizeNumber(raw, defaultCountryCode) {
  let digits = String(raw).replace(/[^0-9+]/g, '');
  digits = digits.replace(/^\+/, '');
  // If the number looks local (no country code), prefix the default one
  if (defaultCountryCode && digits.length <= 10) {
    const cc = defaultCountryCode.replace(/[^0-9]/g, '');
    digits = cc + digits.replace(/^0+/, '');
  }
  return digits;
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!clientReady) {
    return res.status(400).json({ error: 'WhatsApp is not connected yet. Scan the QR code first.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const columnName = (req.body.column || '').trim();
  const defaultCountryCode = (req.body.countryCode || '').trim();

  let records;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    fs.unlink(filePath, () => {});
    return res.status(400).json({ error: 'Could not parse CSV: ' + e.message });
  }
  fs.unlink(filePath, () => {});

  if (records.length === 0) {
    return res.status(400).json({ error: 'CSV appears to be empty' });
  }

  const col = columnName ||
    Object.keys(records[0]).find(k => /phone|number|whatsapp|mobile|tel/i.test(k)) ||
    Object.keys(records[0])[0];

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  jobs[jobId] = {
    status: 'running',
    total: records.length,
    checked: 0,
    valid: [],
    invalidCount: 0,
    errorCount: 0,
    column: col
  };

  res.json({ jobId, column: col, total: records.length });

  // Process sequentially in the background with human-like delays
  (async () => {
    const job = jobs[jobId];
    for (const record of records) {
      const raw = record[col];
      if (!raw) {
        job.checked++;
        continue;
      }
      const number = normalizeNumber(raw, defaultCountryCode);
      try {
        const result = await client.getNumberId(number);
        if (result) {
          job.valid.push({ ...record, normalized_number: number, whatsapp_id: result._serialized });
        } else {
          job.invalidCount++;
        }
      } catch (e) {
        job.errorCount++;
      }
      job.checked++;
      // Randomized delay (2.5s - 5.5s) to reduce ban risk. Do not lower this.
      await new Promise(r => setTimeout(r, 2500 + Math.random() * 3000));
    }
    job.status = 'done';
  })();
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    status: job.status,
    total: job.total,
    checked: job.checked,
    validCount: job.valid.length,
    invalidCount: job.invalidCount,
    errorCount: job.errorCount
  });
});

app.get('/api/jobs/:id/download', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).send('Job not found');
  if (job.valid.length === 0) return res.status(400).send('No WhatsApp numbers found (yet)');
  const csv = stringify(job.valid, { header: true });
  res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_numbers.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhatsApp Checker running on port ${PORT}`));
