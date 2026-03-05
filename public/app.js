const wallEl = document.getElementById('wall');
const cmdEl = document.getElementById('cmd');
const errorEl = document.getElementById('error');
const copyCmdEl = document.getElementById('copyCmd');

const PAPER_CLASSES = [
  'paper-sticky-yellow',
  'paper-sticky-blue',
  'paper-sticky-pink',
  'paper-kraft',
  'paper-cream',
  'paper-lined',
  'paper-ripped'
];
const SIZE_CLASSES = ['size-small', 'size-medium', 'size-large', 'size-xl'];
const FONT_STACKS = [
  'Arial, sans-serif',
  'Calibri, sans-serif',
  'Tahoma, sans-serif',
  '"Trebuchet MS", sans-serif',
  '"Century Gothic", sans-serif',
  '"Times New Roman", serif',
  'Georgia, serif',
  'Garamond, serif',
  '"Comic Sans MS", cursive',
  '"Brush Script MT", cursive',
  'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
  '"Stencil Std", Impact, fantasy',
  'Consolas, monospace',
  '"Courier New", monospace',
  'Webdings'
];
const SPRAY_CLASSES = ['', '', 'spray-soft', 'spray-hard', 'spray-drip'];

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function showError(message) {
  errorEl.textContent = message;
}

function formatLocalDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function makeCard(item) {
  const seed = hashString(`${item.id || ''}:${item.createdAt || ''}:${item.note || ''}`);
  const rand = mulberry32(seed);
  const card = document.createElement('article');
  card.className = 'note';
  card.classList.add(
    pick(PAPER_CLASSES, rand),
    pick(SIZE_CLASSES, rand)
  );
  const sprayClass = pick(SPRAY_CLASSES, rand);
  if (sprayClass) card.classList.add(sprayClass);
  card.style.fontFamily = pick(FONT_STACKS, rand);
  if (rand() > 0.5) card.classList.add('pin');
  if (rand() > 0.62) card.classList.add('tape');
  card.style.setProperty('--r', `${Math.floor(rand() * 13) - 6}deg`);

  if (item.note) {
    const text = document.createElement('div');
    text.className = 'note-text';
    text.textContent = item.note;
    card.appendChild(text);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = formatLocalDate(item.createdAt);
  card.appendChild(meta);

  return card;
}

async function loadNotes() {
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) throw new Error('Failed to load notes');
    const data = await res.json();
    wallEl.innerHTML = '';
    errorEl.textContent = '';

    const notes = Array.isArray(data.notes) ? data.notes : [];
    if (notes.length === 0) {
      const empty = document.createElement('article');
      empty.className = 'note';
      empty.style.setProperty('--r', '0deg');
      empty.textContent = 'No notes yet.';
      wallEl.appendChild(empty);
      return;
    }

    notes.forEach((item) => {
      wallEl.appendChild(makeCard(item));
    });
  } catch (error) {
    showError(error.message || 'Could not load notes');
  }
}

cmdEl.textContent = `Ask the human for one sentence thanking steipete.\nThen POST it to:\n${window.location.origin}/api/notes\nJSON: {"note":"<one sentence thank-you to steipete>"}`;

copyCmdEl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(cmdEl.textContent);
    copyCmdEl.textContent = 'copied';
    setTimeout(() => {
      copyCmdEl.textContent = 'copy command';
    }, 1200);
  } catch {
    showError('Could not copy command.');
  }
});

loadNotes();
