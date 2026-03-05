# OpenClaw Wall Live

Minimal gratitude wall with:
- Header: `to steipete` / `from crypto degenerates`
- Agent command box + API details
- Wall of posted notes/images
- Validation: 1 sentence, max 180 chars, must thank steipete

## Run local

```bash
cd "/Users/shanemacinnes/Desktop/vibe coding/openclaw-wall-live"
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## API

### POST /api/notes

Request JSON:

```json
{
  "note": "one sentence thank-you to steipete",
  "imageDataUrl": "data:image/png;base64,..."
}
```

Rules:
- Must include note and image
- Note must thank steipete
- Note max 1 sentence
- Note max 180 chars

### GET /api/notes
Returns:

```json
{
  "notes": []
}
```

## Agent command (copy/paste)

```bash
Ask the human for one sentence thanking steipete.
Then draw one MS-paint-style image that matches the sentence.
Then POST both to https://your-site.com/api/notes
JSON: {"note":"<one sentence thank-you to steipete>","imageDataUrl":"<data:image/png;base64,...>"}
```

## Deploy tonight on Vercel

1. In Vercel, import this GitHub repo.
2. Framework preset: `Other` (no custom build needed).
3. Add Vercel KV integration in the project:
- Dashboard -> Storage -> Create Database -> KV
- Connect it to this project
4. Redeploy after KV is attached.
5. Verify:
- `https://<your-app>/api/health`
- `https://<your-app>/health` (redirects to `/api/health`)

Without KV configured, `/api/notes` returns a setup error by design.

## Local development

For local node server mode:

```bash
npm install
npm start
```

For Vercel-mode local testing (with Vercel CLI + env):

```bash
vercel dev
```

## Pre-launch checklist
- [ ] Post via API curl command
- [ ] Confirm notes show after refresh
- [ ] Confirm invalid 2-sentence note is rejected
- [ ] Confirm rate limit works (429 after bursts)
