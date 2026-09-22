# Octaraa Online Will — Implementation Status

Source of truth for scope: `Octaraa_Online_Will_Tech_Task_List.md`.
Legend: ✅ built and covered by tests · 🟡 built, but depends on an external service or a human decision that could not be verified here.

## Verification

* `npm run build`, `npx oxlint` — clean.
* `npm test` — 80 client tests (domain logic + every wizard step mounted offline with empty and fully populated data) and 26 server tests (auth, ownership isolation, uploads, notification routing, lawyer access, concurrency).
* `database/schema.sql` loads cleanly into PostgreSQL 17.
* **Not verified**: real Gemini and Brevo calls (no keys here), and a visual pass in a browser (the browser extension was unavailable) — please click through once.

## Foundation (P0)

1. ✅ Dynamic questionnaire: schema-driven conditions, autosave/resume (debounced, flushed on tab close), validation (adult date of birth, "other" religion detail), section completion, **answer review with Edit links** before submission.
2. 🟡 Structured data model: PostgreSQL contract in `database/schema.sql`; the running API uses a JSON store with the same semantics (ownership, optimistic versioning, immutable history, append-only audit). PostgreSQL adapters are not written.
3. ✅ Estate Profile dashboard: estate summary, readiness, **real family tree** (children, roles, assigned assets), **real asset→beneficiary map**, nominee-vs-beneficiary table, gaps.
4. ✅ Reports: Will PDF + Client Report / Advisor Report / Lawyer Brief, generated and **emailed automatically** to their audiences with the PDF attached.
5. 🟡 Notifications: templated jobs routed by audience (staff mailboxes from env — internal mail is never sent to the client), idempotent, per-job delivery status with retry. Needs Brevo keys.

## AI layer (P1)

6. 🟡 Questionnaire assistant: typed / dictated / recorded, English / Hindi / Hinglish; structured proposal + original statement stored; nothing applied until confirmed. Offline fallback is rule-based; full understanding needs Gemini.
7. ✅ Missing-information detector: deterministic rules (alternate executor/guardian, nominees, percentage totals, children vs beneficiaries…), mandatory issues block submission.
8. ✅ Contradiction detection: scheme vs assignments, duplicate/multiply-assigned beneficiaries, witness who is also a beneficiary (by name), minor/adult child answers, Uttarakhand state conflict.
9. ✅ Estate summary generator (recorded facts only, with estimated value from recorded asset values).
10. ✅ Lawyer brief incl. mapping and nominee alignment.

## Documents (P1)

11. ✅ Vault: streamed, size/type-limited, owner-only storage; download, delete.
12. 🟡 Classification: filename rules (offline) + Gemini; manual category correction. AI output is sanitised and can never mark a document confirmed.
13. 🟡 Asset extraction: "We found these assets — add?" per item; never silent.
14. ✅ Reconciliation: value mismatch, owner mismatch / multiple owners, policy number and nominee checks.

## Estate intelligence (P1–P2)

15–18. ✅ Nomination alignment, readiness score, family graph, asset→beneficiary mapping (explicit assignment in the Distribution step, described gifts, shares, residue — never by list position).
19. ✅ Copilot (grounded in recorded data; AI rewords when configured).
20–21. ✅ Scenarios (executor/guardian/predecease/simultaneous death/sale) and a distribution simulator (percentage and by-asset, totals, apply-to-Will).
22. ✅ Follow-ups from approved templates + detected gaps; answer/dismiss/reopen.
23–24. 🟡 Voice and Hindi/Hinglish interview: **"Talk to Samaira"** (`LiveVoiceDock`) is the sole voice agent — a real-time call with Gemini Live (native audio in/out, one model, no separate speech provider), language automatic per turn (English, Hindi or Hinglish, or pinned). Session-resumption reconnect on a dropped connection, and context-window compression so a full interview doesn't hit Google's 15-minute audio-only cutoff. The Deepgram/Smallest.ai-backed hands-free "conversation mode" that used to sit inside the text panel was retired in favor of this. Separately, `VoiceControls` still offers one-shot voice-to-text dictation for typing an answer (browser Speech Recognition, else record-and-transcribe via Gemini) — it doesn't speak back and isn't a conversational agent. **Not** verified with a real microphone in a browser.

## Lawyer / execution (P2)

25–26. 🟡 Lawyer workspace and collaboration: real server-side threads; sender role comes from the session (a client cannot post as a lawyer); assigned lawyers get cases, documents, open issues, requests/corrections/approvals, and can upload a final draft shared with the client. Lawyers **cannot edit** the client's answers — corrections are suggestions. Needs real user accounts (`AUTH_REQUIRED=true`) beyond the dev role switch.
27. ✅ Live checklist: items derived from recorded data plus jurisdiction steps (e.g. mandatory Uttarakhand registration — previously dead code).
28. ✅ Execution room notes + recording metadata.
29. 🟡 Recording management: stored securely, linked to a fingerprint of the Will text, warns when the Will has changed; AI analysis (observable events only, human review gate) needs Gemini and files ≤ 18 MB inline.

## Estate OS (P3–P4)

30–33. ✅ Legacy vault, annual and event reviews with **scheduled reminder emails** (needs `SCHEDULER_ENABLED=true` + Brevo), digital-asset notes that reject passwords / PINs / seed phrases / keys.
34. 🟡 Post-death workflow: ordered, confirmed, logged steps with inventory view. Identity verification is a human step — the app only records it.
35. ✅ Document search (keyword retrieval; AI rewords when available).
36. 🟡 Legal knowledge assistant: server-owned approved sources, mandatory citations. **The legal text itself has not been reviewed by counsel** — please have a lawyer confirm it, in particular the Section 67 wording.
37. 🟡 Jurisdiction rules: versioned, exact-match state resolution; only Uttarakhand and Goa are defined.
38. ✅ Audit trail: client-side section diffs (debounced, no per-keystroke spam) and a server append-only log.
39. 🟡 Execution video analysis: review assistance only (see 29).
40. ✅ Planning-gaps report.

## Still required for production

* PostgreSQL adapters, cloud object storage, a real identity provider for `AUTH_REQUIRED=true`.
* Provider keys (Gemini, Brevo) and staff mailboxes; run the scheduler.
* Legal review of knowledge base and jurisdiction rules.
* SMS delivery exists server-side (staff only) but nothing in the UI sends it.
