import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const notesFile = path.join(dataDir, 'notes.json');
const port = Number(process.env.PORT || 3000);

const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

const MAX_NOTE_CHARS = 180;
const MAX_SENTENCES = 2;
const MAX_IMAGE_DATA_URL_CHARS = 350_000;
const MAX_NOTES = 500;

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function sentenceCount(text) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function isImageDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.includes(';base64,');
}

function validateInput(note, imageDataUrl) {
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  const hasImage = Boolean(imageDataUrl);

  if (!cleanNote && !hasImage) {
    return 'Provide a note, an image, or both.';
  }

  if (cleanNote) {
    if (cleanNote.length > MAX_NOTE_CHARS) {
      return `Note must be <= ${MAX_NOTE_CHARS} characters.`;
    }
    if (sentenceCount(cleanNote) > MAX_SENTENCES) {
      return `Note must be <= ${MAX_SENTENCES} sentences.`;
    }
  }

  if (hasImage) {
    if (!isImageDataUrl(imageDataUrl)) {
      return 'Image must be a data URL from canvas.';
    }
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      return 'Image is too large.';
    }
  }

  return null;
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = requestCounts.get(ip) || [];
  const recent = bucket.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestCounts.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

async function readNotes() {
  try {
    const raw = await readFile(notesFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeNotes(notes) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(notesFile, JSON.stringify(notes, null, 2));
}

async function serveFile(reqPath, res) {
  const target = reqPath === '/' ? '/index.html' : reqPath;
  const fullPath = path.normalize(path.join(publicDir, target));

  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(fullPath);
    const ext = path.extname(fullPath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/notes' && req.method === 'GET') {
    const notes = await readNotes();
    json(res, 200, { notes });
    return;
  }

  if (url.pathname === '/api/notes' && req.method === 'POST') {
    const ip = getIp(req);
    if (isRateLimited(ip)) {
      json(res, 429, { error: 'Rate limit exceeded. Try again in a minute.' });
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const note = typeof body.note === 'string' ? body.note : '';
        const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';

        const validationError = validateInput(note, imageDataUrl);
        if (validationError) {
          json(res, 400, { error: validationError });
          return;
        }

        const notes = await readNotes();
        const entry = {
          id: crypto.randomUUID(),
          note: note.trim(),
          imageDataUrl,
          createdAt: new Date().toISOString()
        };

        notes.unshift(entry);
        if (notes.length > MAX_NOTES) {
          notes.length = MAX_NOTES;
        }

        await writeNotes(notes);
        json(res, 201, { ok: true, note: entry });
      } catch {
        json(res, 400, { error: 'Invalid JSON payload.' });
      }
    });

    return;
  }

  await serveFile(url.pathname, res);
}).listen(port, () => {
  console.log(`openclaw-wall-live listening on http://localhost:${port}`);
});
