import { kv } from '@vercel/kv';

const NOTES_KEY = 'openclaw:notes:v2';

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getAdminToken(req) {
  const header = req.headers['x-admin-token'];
  if (typeof header === 'string') return header.trim();
  return '';
}

function isAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return false;
  return getAdminToken(req) === expected;
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

async function readAllNotes() {
  const raw = await kv.lrange(NOTES_KEY, 0, 499);
  return (raw || []).map(safeParse).filter(Boolean);
}

async function writeAllNotes(notes) {
  await kv.del(NOTES_KEY);
  for (const note of notes) {
    await kv.rpush(NOTES_KEY, JSON.stringify(note));
  }
}

export default async function handler(req, res) {
  if (!hasKvConfig()) {
    res.status(500).json({ error: 'Vercel KV is not configured.' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const notes = await readAllNotes();
    res.status(200).json({ notes });
    return;
  }

  if (req.method === 'PATCH') {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const hidden = Boolean(req.body?.hidden);

    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }

    const notes = await readAllNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    notes[idx] = { ...notes[idx], hidden };
    await writeAllNotes(notes);

    res.status(200).json({ ok: true, note: notes[idx] });
    return;
  }

  res.setHeader('Allow', 'GET,PATCH');
  res.status(405).json({ error: 'Method not allowed' });
}
