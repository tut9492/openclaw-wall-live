const wallEl = document.getElementById('wall');
const cmdEl = document.getElementById('cmd');
const errorEl = document.getElementById('error');

const PAPER_COLORS = ['#f8efcf', '#ffe6ad', '#f7f7f0', '#fce2cf', '#fff3b0'];

function showError(message) {
  errorEl.textContent = message;
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

cmdEl.textContent = `WALL_URL="${window.location.origin}" ./scripts/post_note.sh "<max 2 sentence thank-you>"`;

loadNotes();
