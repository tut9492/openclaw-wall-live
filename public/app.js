const modeEl = document.getElementById('mode');
const noteWrapEl = document.getElementById('noteWrap');
const noteEl = document.getElementById('note');
const canvasWrapEl = document.getElementById('canvasWrap');
const canvasEl = document.getElementById('canvas');
const postBtnEl = document.getElementById('postBtn');
const errorEl = document.getElementById('error');
const okEl = document.getElementById('ok');
const wallEl = document.getElementById('wall');
const cmdEl = document.getElementById('cmd');

const PAPER_COLORS = ['#f8efcf', '#ffe6ad', '#f7f7f0', '#fce2cf', '#fff3b0'];

function sentenceCount(text) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function showError(message) {
  errorEl.textContent = message;
  okEl.textContent = '';
}

function showOk(message) {
  okEl.textContent = message;
  errorEl.textContent = '';
}

function updateModeUI() {
  const mode = modeEl.value;
  noteWrapEl.classList.toggle('hidden', mode === 'draw');
  canvasWrapEl.classList.toggle('hidden', mode === 'note');
}

function formatLocalDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'note';
  card.style.setProperty('--r', `${Math.floor(Math.random() * 9) - 4}deg`);
  card.style.background = PAPER_COLORS[Math.floor(Math.random() * PAPER_COLORS.length)];

  if (item.note) {
    const text = document.createElement('div');
    text.textContent = item.note;
    card.appendChild(text);
  }

  if (item.imageDataUrl) {
    const img = document.createElement('img');
    img.src = item.imageDataUrl;
    img.alt = 'ms-paint-style drawing';
    card.appendChild(img);
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
    const notes = Array.isArray(data.notes) ? data.notes : [];
    if (notes.length === 0) {
      const empty = document.createElement('article');
      empty.className = 'note';
      empty.style.setProperty('--r', '0deg');
      empty.textContent = 'No notes yet. Be first.';
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

const ctx = canvasEl.getContext('2d');
ctx.lineWidth = 4;
ctx.lineCap = 'round';
let drawing = false;
let color = '#111';

function pointerPos(event) {
  const rect = canvasEl.getBoundingClientRect();
  const source = event.touches ? event.touches[0] : event;
  return {
    x: ((source.clientX - rect.left) * canvasEl.width) / rect.width,
    y: ((source.clientY - rect.top) * canvasEl.height) / rect.height
  };
}

function startDraw(event) {
  drawing = true;
  const p = pointerPos(event);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  event.preventDefault();
}

function drawMove(event) {
  if (!drawing) return;
  const p = pointerPos(event);
  ctx.strokeStyle = color;
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  event.preventDefault();
}

function stopDraw() {
  drawing = false;
}

canvasEl.addEventListener('mousedown', startDraw);
canvasEl.addEventListener('mousemove', drawMove);
window.addEventListener('mouseup', stopDraw);
canvasEl.addEventListener('touchstart', startDraw, { passive: false });
canvasEl.addEventListener('touchmove', drawMove, { passive: false });
canvasEl.addEventListener('touchend', stopDraw);

document.querySelectorAll('[data-color]').forEach((button) => {
  button.addEventListener('click', () => {
    color = button.dataset.color || '#111';
  });
});

document.getElementById('clearDrawing').addEventListener('click', () => {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
});

postBtnEl.addEventListener('click', async () => {
  const mode = modeEl.value;
  const note = noteEl.value.trim();
  const includeNote = mode !== 'draw';
  const includeImage = mode !== 'note';

  if (includeNote) {
    if (!note) {
      showError('Note is empty.');
      return;
    }
    if (note.length > 180) {
      showError('Note exceeds 180 characters.');
      return;
    }
    if (sentenceCount(note) > 2) {
      showError('Max 2 sentences.');
      return;
    }
  }

  let imageDataUrl = '';
  if (includeImage) {
    const blank = document.createElement('canvas');
    blank.width = canvasEl.width;
    blank.height = canvasEl.height;
    if (blank.toDataURL() === canvasEl.toDataURL()) {
      if (mode === 'draw') {
        showError('Draw something first.');
        return;
      }
    } else {
      imageDataUrl = canvasEl.toDataURL('image/png');
    }
  }

  try {
    const body = {
      note: includeNote ? note : '',
      imageDataUrl
    };

    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (!response.ok) {
      showError(result.error || 'Failed to post note.');
      return;
    }

    showOk('Posted to wall.');
    noteEl.value = '';
    if (includeImage) {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    await loadNotes();
  } catch {
    showError('Network error while posting.');
  }
});

modeEl.addEventListener('change', updateModeUI);
updateModeUI();

cmdEl.textContent = `WALL_URL="${window.location.origin}" ./scripts/post_note.sh "<max 2 sentence thank-you>"`;

loadNotes();
