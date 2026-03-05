import { kv } from '@vercel/kv';

const NOTES_KEY = 'openclaw:notes:v2';
const RATE_PREFIX = 'openclaw:rate';
const RATE_LIMIT_MAX = 20;
const RATE_WINDOW_SECONDS = 60;

const MAX_NOTE_CHARS = 180;
const MAX_SENTENCES = 1;
const MAX_NOTES = 500;
const X_HANDLE_RE = /^@[A-Za-z0-9_]{1,15}$/;
const BOT_NAME_RE = /^[A-Za-z0-9_\\-]{1,20}$/;
const BLOCKED_PROMPT_PATTERNS = [
  /ignore\s+(all|any|previous|prior)\s+(instructions?|prompts?)/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /jailbreak/i,
  /bypass\s+(safety|policy|guardrails?)/i,
  /act\s+as\s+(a|an)\s+/i,
  /reveal\s+(keys?|secrets?|tokens?)/i
];

function sentenceCount(text) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function validateInput(note, xHandle, botName) {
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  const cleanHandle = typeof xHandle === 'string' ? xHandle.trim() : '';
  const cleanBotName = typeof botName === 'string' ? botName.trim() : '';

  if (!cleanNote) return 'Provide a one-sentence thank-you note.';
  if (!cleanHandle) return 'Provide an X account handle.';
  if (!cleanBotName) return 'Provide a botName.';
  if (!X_HANDLE_RE.test(cleanHandle)) return 'xHandle must look like @name (letters, numbers, underscore, max 15).';
  if (!BOT_NAME_RE.test(cleanBotName)) return 'botName must be 1-20 chars (letters, numbers, underscore, dash).';
  if (cleanNote.length > MAX_NOTE_CHARS) return `Note must be <= ${MAX_NOTE_CHARS} characters.`;
  if (sentenceCount(cleanNote) > MAX_SENTENCES) return `Note must be <= ${MAX_SENTENCES} sentence.`;
  for (const pattern of BLOCKED_PROMPT_PATTERNS) {
    if (pattern.test(cleanNote)) {
      return 'Note contains blocked instruction-like content.';
    }
  }

  return null;
}

function getIp(req) {
  const vercelForwarded = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelForwarded === 'string' && vercelForwarded.length > 0) {
    return vercelForwarded.trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp.trim();
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const allowedOrigins = new Set();
  if (host) {
    allowedOrigins.add(`https://${host}`);
    allowedOrigins.add(`http://${host}`);
  }
  const extra = process.env.ALLOWED_ORIGINS || '';
  for (const raw of extra.split(',')) {
    const value = raw.trim();
    if (value) allowedOrigins.add(value);
  }
  if (!origin || allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return !origin || allowedOrigins.has(origin);
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
  const corsAllowed = setCors(req, res);
  if (req.headers.origin && !corsAllowed) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

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
    const notes = (raw || [])
      .map(safeParse)
      .filter(Boolean)
      .filter((item) => !item.hidden);
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
    const xHandle = typeof req.body?.xHandle === 'string' ? req.body.xHandle : '';
    const botName = typeof req.body?.botName === 'string' ? req.body.botName : '';
    const validationError = validateInput(note, xHandle, botName);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      note: note.trim(),
      xHandle: xHandle.trim(),
      botName: botName.trim(),
      hidden: false,
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
