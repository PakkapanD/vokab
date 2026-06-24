# Vokab — project guide for Claude

A **personal vocabulary-learning app** for the user (a student) prepping for the **SAT** and the **Thai A-Level English** entrance exam. The current deck (**"Vocab by P'N"**) teaches **English vocab grouped under Thai meanings** — each card is a Thai meaning → a cluster of English synonyms (graded easy → hard), from a teacher's slide deck.

## What it is (architecture)

- **One single file: `index.html`.** No build step, no framework, no dependencies. Plain HTML + CSS + vanilla JS. Open it in a browser and it runs.
- **Storage:** `localStorage` (instant, offline) **plus optional Supabase cloud sync**. Each profile's deck lives at `vokab.v2.<profileName>`; active profile name at `vokab.active`. Cloud connect codes (Supabase URL + anon key) live at `vokab.cloud` — entered in-app, NEVER in code. (History: `vokab.v1`→`vokab.v2` when the old single-word SAT deck was replaced; 2026-06-23 namespaced per profile and added cloud sync. Old flat `vokab.v2` data auto-migrates into the first fixed profile.)
- **Profiles (Netflix-style, fixed, 2026-06-23):** a fixed `PROFILE_NAMES` list (edit in code) shown as a "Who's studying?" chooser. User wanted real cross-device sync like Netflix (reversed the earlier local-only decision). Local save is instant; cloud push is debounced (`schedulePush`); picking a profile pulls the cloud copy and takes it if newer (`updated` timestamp, last-write-wins per profile). Works offline if cloud not connected. Functions: `cloudCfg`/`cloudOn`/`cloudPull`/`cloudPush`/`schedulePush`, `dataKey`, `renderProfiles`/`pickProfile`/`selectProfile`/`saveCloud`/`disconnectCloud`. App gates on picking a profile before studying.
- **Cloud backend = Supabase** (free tier). Table `vokab_profiles(name text primary key, data jsonb)`, accessed via PostgREST: GET `?name=eq.<name>&select=data`, upsert via POST with header `Prefer: resolution=merge-duplicates`. Each device pastes the SAME URL + anon key once (acts as the shared "room"). anon key + RLS policy guard writes; data is non-sensitive vocab progress.
- **Hosting:** free **GitHub Pages, PUBLIC repo** named `vokab`. Installed to the user's Android home screen as a PWA-style icon (via Chrome "Add to Home screen").
- **Network:** offline-first, but now makes **cloud calls to Supabase** when connected (added 2026-06-23 at user's request). (Earlier Datamuse + dictionaryapi.dev word-web/lookup were removed 2026-06-18; those are unrelated and stay gone.)

## Hard constraints (do not violate)

- **Personal use only.** No deployment beyond the user's own GitHub Pages. (As of 2026-06-23 the user added Supabase cloud sync so a friend can share progress across phones — this relaxes the old "fully offline / no accounts" rule, but it's still just the user + a friend, not public/multi-tenant.)
- **No AI billing. AI has been removed entirely** (user's decision, 2026-06-10). Gemini free tier failed for their account (`limit: 0`); Groq was tried; user then said remove all AI. **Do not re-add AI unless the user explicitly asks.**
- **Never hardcode API keys** in `index.html` (the repo is public). If any keyed service returns, the key goes in localStorage via an in-app settings field, never in code.
- Beginner user ("a little / willing to learn") — keep things simple, explain steps, prefer no-command-line paths (GitHub website drag-and-drop) when guiding deploys.

## The learning method (the whole point of the app)

Learn words by their **links** (synonym clusters under one meaning), not in isolation. The flow the user asked for: **pick a pack → recall the English words from the Thai meaning → reveal**. Combined with **spaced repetition** (SM-2-style scheduler) and an optional **write-your-own-sentence** box. Recall-before-reveal is the active-recall step.

## Code map (inside `index.html` `<script>`)

- `PACKS` — `{ "Vocab by P'N": [...82 concept entries...] }`. Each entry is `{ th: <Thai meaning>, pos, groups: [[tier1 words], [tier2 words], ...] }`. English words keep their stress-mark apostrophes (e.g. `opti'mistic`) and notes (e.g. `deal (+with)`); `say()` strips those for TTS. Baked into the file — there is **no** import/add UI (user's decision, 2026-06-18: "just show the pack, choose pack and learn").
- `toCard(entry, pack)` — builds a study card with SRS fields `{ease,interval,reps,due,lapses}` + `sentence`.
- `syncPacks(db)` — on load, ensures every pack concept has a card (matches on `pack`+`th`), refreshing `pos`/`groups` from `PACKS` while keeping SRS progress.
- `schedule(card,rating)` — SM-2-style spacing for ratings `again|good|easy`.
- `packCards(pack)` / `dueCards(pack)` — cards in a pack / those with `due <= now`.
- Views: `renderPacks()` (home/chooser), `renderStudy()`, `renderBrowse()`; nav via `go(view)` over `packs|study|browse`. `currentPack` holds the chosen pack.
- The Datamuse word-web, dictionary lookup, Add/bulk-add, and file backup/restore from v1 are all **gone**. Don't reintroduce them unless asked.

## How to run / verify

- **Locally:** just open `D:\Vokab\index.html` in a browser (double-click).
- **Syntax check after edits** (no real test suite):
  ```
  node -e "const fs=require('fs');let h=fs.readFileSync('index.html','utf8');let m=h.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync('._check.js',m[1]);" && node --check ._check.js && echo OK
  ```
- **Deploy update:** user re-uploads `index.html` via GitHub website (repo → Add file → Upload files → drag → Commit), waits ~1 min for Pages to rebuild, reloads on phone. Updating the file does NOT reset progress (progress is in localStorage, not the file).

## State & likely next tasks

- **Done (2026-06-18 rewrite):** stripped to pick-a-pack → study. New **"Vocab by P'N"** pack = 82 Thai→English synonym-cluster cards (from the teacher's slide deck images, originally in `images/` — already OCR'd into `PACKS`, so those files aren't needed again). Removed SEED, SAT Core, word-web, Datamuse/dictionary lookup, Add/import/backup. AI still removed.
- **Likely next:** (1) true-offline **PWA** — `manifest.json` + service worker (adds 2 files); (2) more packs — just add another key to `PACKS` in the same `{th,pos,groups}` shape (e.g. a Thai A-Level set), and the chooser picks it up automatically.

Longer notes live in Claude's memory at `C:\Users\dpakk\.claude\projects\D--Vokab\memory\vokab-project.md`.
