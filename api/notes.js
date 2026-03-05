import { kv } from '@vercel/kv';

const NOTES_KEY = 'openclaw:notes:v2';
const RATE_PREFIX = 'openclaw:rate';
const RATE_LIMIT_MAX = 20;
const RATE_WINDOW_SECONDS = 60;

const MAX_NOTE_CHARS = 180;
const MAX_SENTENCES = 1;
const MAX_NOTES = 500;
const NOTE_TARGET = 'steipete + openclaw community';

function sentenceCount(text) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function validateInput(note) {
  const cleanNote = typeof note === 'string' ? note.trim() : '';

  if (!cleanNote) return 'Provide a one-sentence thank-you note.';
  if (cleanNote.length > MAX_NOTE_CHARS) return `Note must be <= ${MAX_NOTE_CHARS} characters.`;
  if (sentenceCount(cleanNote) > MAX_SENTENCES) return `Note must be <= ${MAX_SENTENCES} sentence.`;
  if (!cleanNote.toLowerCase().includes('steipete')) return 'Note must thank steipete.';

  return null;
}

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function checkRateLimit(ip) {
  const windowBucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const key = `${RATE_PREFIX}:${ip}:${windowBucket}`;
  const count = await kv.incr(key);
  if (count === 1) {
    await kv.expire(key, RATE_WINDOW_SECONDS + 2);
  }
  return count > RATE_LIMIT_MAX;
}

function safeParse(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!hasKvConfig()) {
    res.status(500).json({ error: 'Vercel KV is not configured. Add KV integration in project settings.' });
    return;
  }

  if (req.method === 'GET') {
    const raw = await kv.lrange(NOTES_KEY, 0, 99);
    const notes = (raw || []).map(safeParse).filter(Boolean);
    res.status(200).json({ notes });
    return;
  }

  if (req.method === 'POST') {
    const ip = getIp(req);
    if (await checkRateLimit(ip)) {
      res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
      return;
    }

    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    const validationError = validateInput(note);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      note: note.trim(),
      to: NOTE_TARGET,
      createdAt: new Date().toISOString()
    };

    await kv.lpush(NOTES_KEY, JSON.stringify(entry));
    await kv.ltrim(NOTES_KEY, 0, MAX_NOTES - 1);

    res.status(201).json({ ok: true, note: entry });
    return;
  }

  res.setHeader('Allow', 'GET,POST,OPTIONS');
  res.status(405).json({ error: 'Method not allowed' });
}
