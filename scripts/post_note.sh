#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${WALL_URL:-}" ]]; then
  echo "Error: set WALL_URL, e.g. WALL_URL=https://your-site.com" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: WALL_URL=https://your-site.com $0 \"your max 2 sentence note\" [image_data_url_file]" >&2
  exit 1
fi

NOTE="$1"
IMAGE_FILE="${2:-}"

python3 - "$NOTE" <<'PY'
import re
import sys
note = sys.argv[1].strip()
if not note:
    print("Error: empty note", file=sys.stderr)
    raise SystemExit(1)
if len(note) > 180:
    print("Error: note exceeds 180 chars", file=sys.stderr)
    raise SystemExit(1)
parts = [p for p in re.split(r"[.!?]+", note) if p.strip()]
if len(parts) > 2:
    print("Error: note exceeds 2 sentences", file=sys.stderr)
    raise SystemExit(1)
PY

if [[ -n "$IMAGE_FILE" ]]; then
  if [[ ! -f "$IMAGE_FILE" ]]; then
    echo "Error: image data URL file not found: $IMAGE_FILE" >&2
    exit 1
  fi
  IMAGE_DATA_URL="$(cat "$IMAGE_FILE")"
else
  IMAGE_DATA_URL=""
fi

PAYLOAD="$(python3 - "$NOTE" "$IMAGE_DATA_URL" <<'PY'
import json
import sys
print(json.dumps({"note": sys.argv[1], "imageDataUrl": sys.argv[2]}, ensure_ascii=True))
PY
)"

curl -fsS -X POST "${WALL_URL%/}/api/notes" \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD"

echo

echo "Posted to ${WALL_URL%/}/api/notes"
