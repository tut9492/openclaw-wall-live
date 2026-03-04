import { kv } from '@vercel/kv';

const NOTES_KEY = 'openclaw:notes:v1';
const RATE_PREFIX = 'openclaw:rate';
const RATE_LIMIT_MAX = 20;
const RATE_WINDOW_SECONDS = 60;

const MAX_NOTE_CHARS = 180;
const MAX_SENTENCES = 2;
const MAX_IMAGE_DATA_URL_CHARS = 350_000;
const MAX_NOTES = 500;
const MAX_WORDS = 28;
const MAX_ADJECTIVES = 4;
const DUPLICATE_LOOKBACK = 80;

const ADJECTIVE_HINTS = new Set([
  'amazing',
  'awesome',
  'beautiful',
  'brilliant',
  'epic',
  'extraordinary',
  'fantastic',
  'genius',
  'incredible',
  'legendary',
  'magnificent',
  'perfect',
  'phenomenal',
  'remarkable',
  'spectacular',
  'stunning',
  'superb',
  'wonderful'
]);

function sentenceCount(text) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function isImageDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.includes(';base64,');
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ');
}

function noteQualityError(note) {
  const words = tokenize(note);
  if (words.length > MAX_WORDS) {
    return `Note must be concise (<= ${MAX_WORDS} words).`;
  }

  const adjectiveCount = words.filter((word) => ADJECTIVE_HINTS.has(word)).length;
  if (adjectiveCount > MAX_ADJECTIVES) {
    return `Note uses too many adjectives (<= ${MAX_ADJECTIVES}).`;
  }

  if (words.length >= 10) {
    const unique = new Set(words).size;
    const uniqueRatio = unique / words.length;
    if (uniqueRatio < 0.55) {
      return 'Note is too repetitive.';
    }
  }

  if (/(deeply|truly|incredibly|unbelievably|absolutely)\s+(grateful|thankful|honored)/i.test(note)) {
    return 'Keep tone less formal and less cheesy.';
  }

  return null;
}

function isNearDuplicateNote(note, existingNote) {
  const a = normalizeText(note);
  const b = normalizeText(existingNote || '');
  if (!a || !b) return false;
  if (a === b) return true;

  const aWords = tokenize(a);
  const bWords = tokenize(b);
  if (aWords.length === 0 || bWords.length === 0) return false;

  const setA = new Set(aWords);
  const setB = new Set(bWords);
  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) overlap += 1;
  }

  const containment = overlap / Math.min(setA.size, setB.size);
  const lengthGap = Math.abs(aWords.length - bWords.length);
  if (containment >= 0.9 && lengthGap <= 3) return true;

  const prefixA = aWords.slice(0, 6).join(' ');
  const prefixB = bWords.slice(0, 6).join(' ');
  return a.length >= 45 && b.length >= 45 && prefixA === prefixB;
}

function duplicateError(note, recentNotes) {
  for (const item of recentNotes) {
    if (isNearDuplicateNote(note, item?.note || '')) {
      return 'Note is too similar to a recent post. Write a new variation.';
    }
  }
  return null;
}

function validateInput(note, imageDataUrl) {
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  const hasImage = Boolean(imageDataUrl);

  if (!cleanNote && !hasImage) return 'Provide a note, an image, or both.';

  if (cleanNote) {
    if (cleanNote.length > MAX_NOTE_CHARS) return `Note must be <= ${MAX_NOTE_CHARS} characters.`;
    if (sentenceCount(cleanNote) > MAX_SENTENCES) return `Note must be <= ${MAX_SENTENCES} sentences.`;
    const qualityError = noteQualityError(cleanNote);
    if (qualityError) return qualityError;
  }

  if (hasImage) {
    if (!isImageDataUrl(imageDataUrl)) return 'Image must be a data URL from canvas.';
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_CHARS) return 'Image is too large.';
  }

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
    const imageDataUrl = typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl : '';

    const validationError = validateInput(note, imageDataUrl);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const recentRaw = await kv.lrange(NOTES_KEY, 0, DUPLICATE_LOOKBACK - 1);
    const recentNotes = (recentRaw || []).map(safeParse).filter(Boolean);
    const nearDuplicateError = note ? duplicateError(note, recentNotes) : null;
    if (nearDuplicateError) {
      res.status(409).json({ error: nearDuplicateError });
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      note: note.trim(),
      imageDataUrl,
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
