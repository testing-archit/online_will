# Octaraa Integrations

Do not put Gemini or Brevo keys in Vite `VITE_*` variables — Vite exposes those to the browser bundle.

## Setup

1. Rotate any keys that were ever pasted into chat or issue trackers.
2. `cp .env.example .env.local` and fill in the provider keys.
3. Start the API gateway, then the app (`npm run api` loads `.env.local` itself; variables already in your shell win):

```bash
npm run api      # http://127.0.0.1:8787
npm run dev      # http://localhost:5173
```

`npm test` runs the client (vitest) and server (node:test) suites.

## Auth model

* `AUTH_REQUIRED=false` (default, local dev): the app signs itself in with `/api/auth/dev-login` as a `client`. Tokens are honoured if present, otherwise the server falls back to a shared dev admin.
* `AUTH_REQUIRED=true`: every request needs `Authorization: Bearer <HS256 token>` with claims `sub`, `role` (`client|lawyer|advisor|operations|executor|admin`), `exp`. The host application should mint these and store the token in `localStorage["octaraa-api-session-token"]`; dev-login must be disabled (`NODE_ENV=production` or `ALLOW_DEV_LOGIN=false`).
* Records are owned by their creator. Clients only see their own; lawyers see wills assigned to them (`POST /api/wills/:id/assign`, staff only); `admin`/`operations` see all.

## Endpoints

| Area | Endpoint |
| --- | --- |
| Health / session | `GET /api/health`, `GET /api/session`, `POST /api/auth/dev-login` |
| Wills | `POST /api/wills` (create/update, `baseVersion` optimistic locking, immutable history), `GET /api/wills`, `GET /api/wills/:id`, `GET /api/wills/:id/versions`, `POST /api/wills/:id/assign` |
| Collaboration | `GET/POST /api/wills/:id/comments`, `PATCH /api/comments/:id`, `GET /api/lawyer/cases` |
| Files | `POST /api/uploads/sign`, `PUT/GET/DELETE /api/uploads/:id` (streamed, size- and type-limited, owner-checked) |
| AI | `POST /api/assistant/extract`, `/api/interview/respond`, `/api/copilot/answer`, `/api/speech/transcribe` (dictation-to-text fallback, Gemini), `/api/live/session` (mints a single-use Gemini Live token), `/api/documents/analyze`, `/api/documents/search`, `/api/legal/answer`, `/api/execution/analyze` (rate limited) |
| Notifications | `POST /api/notifications/send` (audience-routed, idempotent per `submissionId`, optional PDF attachment), `/api/notifications/schedule`, `/api/notifications/sms` (staff), `POST /api/scheduler/run` (staff) |
| Consultations / audit | `POST /api/consultations`, `GET /api/consultations` (staff), `GET /api/audit-log` (staff) |

Voice: "Talk to Samaira" (`LiveVoiceDock`) is the only voice agent, powered entirely by Gemini Live (`GEMINI_LIVE_MODEL`, default `gemini-3.8-live`) — one native audio-in/audio-out model, no separate speech provider. The browser gets a single-use token (`/api/live/session`) with the model, voice, tools and instructions locked in; the API key never reaches the client. Separately, `VoiceControls` offers one-shot voice-to-text dictation for typing an answer (browser Speech Recognition first, else record-and-transcribe via `/api/speech/transcribe`, which uses Gemini); it does not speak back.

Samaira is available on every step (a panel, not a step). Each `POST /api/interview/respond` carries a `sessionContext` (current step, section progress, open question labels, and the answer fields she may propose values for — never the answers themselves). She can return `fieldUpdates` for ordinary answers on the current step; the server and the client both validate them (type, allowed options, visibility), the person sees a before/after card, and nothing is applied until they confirm. Legal declarations (sound mind, revocation, codicil) and lists of people or assets are never fillable by her.

Notes: `POST /api/legal/answer` takes only the question — the approved knowledge base lives on the server (`shared/legal-knowledge.json`), so callers cannot inject "sources". Gemini receives a redacted snapshot (no date of birth, witness IDs, masked account/policy numbers).

## Production notes

* Replace the JSON store (`server/store.mjs`) with PostgreSQL adapters for `database/schema.sql` (the schema loads cleanly on PostgreSQL 17); the store's ownership/versioning/history/audit semantics are the contract.
* Replace local upload storage with S3/GCS/Azure signed URLs.
* Use Brevo templates for final branded emails.
* Have counsel review the curated legal knowledge base and jurisdiction rules before launch.

## Live voice (Gemini Live, any language)

`POST /api/live/session` mints a single-use, 20-minute Gemini ephemeral token (`/v1beta/auth_tokens`) with the model (`GEMINI_LIVE_MODEL`, default `gemini-3.8-live`), voice (`GEMINI_LIVE_VOICE`), transcription, tools, Samaira's instructions, this person's redacted estate snapshot and the current screen locked into it. The browser opens the WebSocket to Google directly with that token, so the API key never leaves the server. `GET /api/health` reports `liveConfigured`. The body may carry `language` (`auto`, `en`, `hi`, `hinglish`, `mr`, `gu`, `bn`, `ta`, `te`, `kn`, `ml`, `pa`); `auto` (default) answers in whatever language the person last spoke. Everything written into the form is in English letters whatever language is spoken.

Tools Samaira has, all executed in the browser through the same validation as typed input:

| Tool | What it does |
| --- | --- |
| `record_estate_details` | Answers for fields on the current step, and who inherits what. Applied straight to the form. |
| `edit_list` | Add, update or remove one entry of a list (executors, children, guardians, properties, bank accounts, investments, valuables, policies, beneficiaries, witnesses). The catalogue is `shared/live-lists.json`. Lists that only appear after another answer stay locked until it is given. |
| `undo_last_change` | Takes back the most recent change ("undo that"). |
| `go_to_step` | Moves the wizard to a step; the reply carries the new screen's fields, lists and open questions. |

Changes are applied immediately (no confirm tap), lit up on screen, listed in the Live panel and undoable one at a time, newest first. Legal declarations (`confirm-true` fields such as the sound-mind declaration) are never filled by voice. When the screen changes without her (the person taps, edits or navigates) the app sends a `[Screen update]` message with the fresh screen, its step statuses, `nextStepId`, the highlighted `focus` question and the lists on the step.

Text AI calls (`callGemini`) fail over across `GEMINI_MODEL` then `GEMINI_FALLBACK_MODELS` and stay inside 17 seconds for interactive calls.
