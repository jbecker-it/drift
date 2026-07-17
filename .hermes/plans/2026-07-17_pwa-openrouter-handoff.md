# Drift — PWA Fix, OpenRouter Attribution & Handoff Integration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix the broken PWA (favicon, install prompt), wire proper OpenRouter attribution headers + data-collection deny, and integrate the production-tested prompts and dual-model architecture from the AI handoff document.

**Architecture:** Four workstreams — (1) PWA fundamentals, (2) OpenRouter request hardening, (3) prompt system rewrite + dual model + weekly summary, (4) documentation. All changes are client-side only (static app, no server).

**Tech Stack:** React 19, Vite 8, Dexie/IndexedDB, OpenRouter API (direct client calls), Tailwind CSS 4.

**Default models (shipped, pre-dialed per handoff doc):**
- **Primary** (all user-facing AI): `anthropic/claude-sonnet-5` — temp 0.7, reasoning off, no plugins
- **Background** (tagging, summaries): `deepseek/deepseek-v4-flash` — temp 0.2–0.3, reasoning off, no plugins
- Users can override both model selections in Settings. Per-function parameters (temperature, max_tokens, response_format) are **not** user-configurable — they are hardcoded per the handoff doc's Section 6 table.

---

## Workstream 1: PWA Fix

### Task 1.1: Fix favicon reference in index.html

**Objective:** The HTML references `/vite.svg` which doesn't exist. The actual favicon is `/favicon.svg`.

**Files:**
- Modify: `index.html`

**Steps:**
1. Replace `href="/vite.svg"` with `href="/favicon.svg"`
2. Add apple-touch-icon link pointing to the same SVG (or generate a 180×180 PNG later)
3. Add PWA meta tags: `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`

### Task 1.2: Create manifest.webmanifest

**Objective:** Android Chrome requires a web app manifest to show the install prompt. Without it, the "Add to Home Screen" menu appears but the browser never prompts to install.

**Files:**
- Create: `public/manifest.webmanifest`

**Content:**
```json
{
  "name": "Drift — Your ADHD Journal",
  "short_name": "Drift",
  "description": "A private, local-first journaling app for ADHD",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f1117",
  "theme_color": "#0f1117",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

### Task 1.3: Link manifest in index.html

**Files:**
- Modify: `index.html`

**Steps:**
1. Add `<link rel="manifest" href="/manifest.webmanifest">` in `<head>`

### Task 1.4: Register a minimal service worker

**Objective:** Chrome's installability criteria require a service worker. A minimal cache-first SW for static assets is sufficient — the app has no server API to intercept (OpenRouter calls must go to the network).

**Files:**
- Create: `public/sw.js`
- Modify: `src/main.tsx` (register the SW)

**SW design:**
- Cache static assets on install (precache the app shell)
- Network-first for all requests (passthrough for API calls)
- This satisfies Chrome's installability check without breaking OpenRouter requests

### Task 1.5: Build and verify

**Steps:**
1. `npm run build` — verify no errors
2. Check dist/ contains `manifest.webmanifest`, `sw.js`, `favicon.svg`
3. Open in browser → verify favicon shows
4. Verify no console errors about manifest or SW

---

## Workstream 2: OpenRouter Request Hardening

### Task 2.1: Update HTTP-Referer to GitHub repo URL

**Objective:** The handoff doc says Drift should be identifiable in OpenRouter activity logs. `window.location.origin` varies by deployment (localhost, IP, etc.). A stable referer pointing to the GitHub repo ensures attribution.

**Files:**
- Modify: `src/ai/openrouter.ts`

**Steps:**
1. Add a constant: `const DRIFT_REFERER = 'https://github.com/jbecker-it/drift';`
2. Replace `'HTTP-Referer': window.location.origin` with `'HTTP-Referer': DRIFT_REFERER` in both `streamChat` and `chatComplete`
3. Keep `X-Title: 'Drift Journal'` (already correct)

### Task 2.2: Add `provider: { data_collection: "deny" }` to all requests

**Objective:** The handoff doc mandates this per-call privacy enforcement so the user's preference is enforced even if the OpenRouter account setting is missed.

**Files:**
- Modify: `src/ai/openrouter.ts`

**Steps:**
1. In `streamChat`: add `provider: { data_collection: "deny" }` to the JSON body
2. In `chatComplete`: same addition
3. Add `plugins: []` to prevent OpenRouter's web-search plugin from being auto-attached

### Task 2.3: Create a shared request config builder

**Objective:** Avoid duplicating headers and body config between `streamChat` and `chatComplete`. Centralize the request setup.

**Files:**
- Modify: `src/ai/openrouter.ts`

**Steps:**
1. Extract a `buildRequestBody(messages, config, options)` function that constructs the full body including model, messages, temperature, max_tokens, stream flag, provider deny, plugins
2. Extract a `buildHeaders(apiKey)` function for the common headers
3. Refactor `streamChat` and `chatComplete` to use these builders
4. Add per-call config options so callers can override temperature/max_tokens (needed for background model jobs — Section 5 of handoff doc)

### Task 2.4: Verify attribution works

**Steps:**
1. Make a test call via the app (write an entry → triggers reflection)
2. Check OpenRouter activity logs at openrouter.ai/activity — confirm "Drift Journal" and the GitHub referer appear

---

## Workstream 3: Prompt System Rewrite + Dual Model + Weekly Summary

This is the largest workstream. The handoff doc completely replaces the current prompt architecture.

### Task 3.1: Replace prompts.ts with the handoff doc's prompt system

**Objective:** The current prompts (`COACH_SYSTEM`, `DUMP_SYSTEM`, etc.) are generic. The handoff doc provides production-tested prompts with explicit grounding rules, word limits, and a CORE + MODE + PERSONALITY composition system.

**Files:**
- Rewrite: `src/ai/prompts.ts`

**What changes:**
1. **Remove** the old monolithic prompt constants (`COACH_SYSTEM`, `DUMP_SYSTEM`, `MORNING_CHECKIN`, `EVENING_WINDDOWN`, `TOPIC_SUGGESTER`, `REFLECTION_SYSTEM`)
2. **Add** the CORE prompt (shared across all coach modes)
3. **Add** MODE blocks: `brain_dump`, `morning_checkin`, `evening_winddown`, `just_talk`
4. **Add** PERSONALITY blocks: `listener`, `coach`, `challenger`
5. **Add** the Reflect function prompt (separate system, under 90 words)
6. **Add** the Topic Suggestions prompt (3 numbered prompts, no preamble)
7. **Rewrite** `buildMessages()` to compose `CORE + MODE + PERSONALITY` and accept `mode` + `personality` parameters
8. **Rewrite** `getReflectionPrompt()` to use the new Reflect prompt
9. **Rewrite** `getTopicSuggestions()` to use the new Topic Suggestions prompt
10. **Add** the background job prompts (entry tagging §5a + weekly summary §5b of handoff doc)

**Key prompt details from handoff doc (must be preserved exactly):**
- CORE: grounding rules, no diagnosis, self-criticism handling, format rules, word limits per mode
- Brain dump: Max 100 words, one gentle question or none
- Morning check-in: Max 80 words, ONE realistic intention
- Evening wind-down: Max 120 words, closure over problem-solving
- Just talk: No word limit, default to brevity, match user's energy
- Reflect: Under 90 words, one optional addition, never rewrite their words
- Topic Suggestions: Exactly 3 prompts, numbered, no generic prompts
- Weekly summary: Pattern claims must cite entry dates; weekday inference from dates alone is forbidden (this is the exact failure that eliminated two models in testing)

### Task 3.2: Add background model concept to DB and settings

**Objective:** The handoff doc requires a second model slot ("background model") for non-conversational jobs (tagging, summarization). Default: `deepseek/deepseek-v4-flash`.

**Files:**
- Modify: `src/db/index.ts`

**Steps:**
1. Add `getBackgroundModel()` helper that reads from settings, defaulting to `'deepseek/deepseek-v4-flash'`
2. Add `setBackgroundModel()` helper
3. No DB schema changes needed — models are stored as string settings

### Task 3.3: Add background model setting to Settings page

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

**Steps:**
1. Add a "Background Model" section below the primary model picker
2. Include a "Same as primary" toggle option
3. Use the same model picker UI but for the background model setting
4. Store via `setSetting('openrouter_background_model', value)` or `'same'` for the fallback option

### Task 3.4: Update default model in settings

**Objective:** Handoff doc specifies `anthropic/claude-sonnet-5` as the default primary model, not `xiaomi/mimo-v2.5`. The shipped defaults include pre-dialed per-function parameters (Section 6 of handoff doc).

**Files:**
- Modify: `src/db/index.ts` (in `getModel()` function)
- Modify: `src/pages/SettingsPage.tsx` (default state)

**Steps:**
1. Change default in `getModel()` from `'xiaomi/mimo-v2.5'` to `'anthropic/claude-sonnet-5'`
2. Change default state in SettingsPage
3. Add a comment noting this is per the handoff doc's five-model blind comparison test

### Task 3.5: Add per-function request parameters

**Objective:** The handoff doc specifies different temperature/max_tokens per function. These are baked-in defaults, not user-facing settings. Table from handoff doc Section 6:

| Function | Model (default) | temp | max_tokens | Other |
|---|---|---|---|---|
| Coach chat | anthropic/claude-sonnet-5 | 0.7 | 1000 | reasoning off, no plugins |
| Reflect | anthropic/claude-sonnet-5 | 0.7 | 300 | reasoning off, no plugins |
| Topic Suggestions | anthropic/claude-sonnet-5 | 0.7 | 300 | reasoning off, no plugins |
| Entry tagging (§5a) | deepseek/deepseek-v4-flash | 0.2 | 600 | json_object response format |
| Weekly summary (§5b) | deepseek/deepseek-v4-flash | 0.3 | 800 | reasoning off |

**Files:**
- Modify: `src/ai/openrouter.ts` (config type + builders from Task 2.3)
- Modify: `src/ai/prompts.ts` (export parameter constants per function)
- Modify: `src/pages/JournalPage.tsx` (pass correct params for reflect calls)
- Modify: `src/pages/CoachPage.tsx` (pass correct params for chat calls)

**Steps:**
1. Create a `REQUEST_CONFIG` map in `prompts.ts` exporting per-function `{ temperature, max_tokens, response_format? }` objects
2. Extend `OpenRouterConfig` with optional `temperature`, `max_tokens`, `response_format` fields
3. Update callers to use the config from `REQUEST_CONFIG`
4. These parameters are **not exposed in Settings** — they are part of the app's design, not user preference

### Task 3.6: Implement entry auto-tagging on save

**Objective:** The handoff doc describes structured extraction (topics, mood words, tasks, people, one-line summary) that runs on every entry save using the background model.

**Files:**
- Create: `src/ai/tagging.ts`
- Modify: `src/db/index.ts` (add EntryTags table via Dexie v2 migration)
- Modify: `src/pages/JournalPage.tsx` (trigger tagging on save)

**Steps:**
1. Add `entryTags` table to Dexie schema (v2 migration): `{ id, entryId, topics, mentions, one_line_summary, taggedAt }`
2. Create `src/ai/tagging.ts` with:
   - `tagEntry(entry: JournalEntry): Promise<EntryTags>` — calls `chatComplete` with the handoff doc's §5a tagging prompt + background model + REQUEST_CONFIG for tagging
   - `getTagsForEntry(entryId: string): Promise<EntryTags | null>`
   - `getEntrySummaries(limit: number): Promise<string[]>` — returns `one_line_summary` fields from recent entries for Topic Suggestions and weekly summary
3. In JournalPage's `handleSave`, after saving the entry, fire-and-forget the tagging call (don't block the UI)
4. Store the tags in Dexie alongside the entry

### Task 3.7: Strip reasoning/thinking from displayed output

**Objective:** The handoff doc says leaked "Thought" blocks break UX. Need a filter.

**Files:**
- Modify: `src/ai/openrouter.ts`

**Steps:**
1. Add a `cleanReasoningOutput(text: string)` function that strips `<thinking>...</thinking>` blocks and similar reasoning artifacts
2. Apply it to the accumulated content in `streamChat` before yielding
3. This is a safety net — the `plugins: []` and no `include_reasoning` should prevent most leaks, but some models inject reasoning in content

### Task 3.8: Update CoachPage to use new prompt system

**Objective:** The current CoachPage uses the old prompt types (`dump`, `morning`, `evening`, `coach`). The new system uses `mode` + `personality` composition.

**Files:**
- Modify: `src/pages/CoachPage.tsx`

**Steps:**
1. Update `QUICK_STARTS` to map to new mode names (`brain_dump`, `morning_checkin`, `evening_winddown`, `just_talk`)
2. Load personality from settings (`getPersonality()`) and pass to `buildMessages()`
3. The QUICK_STARTS already have the right UX labels; just update the internal type values

### Task 3.9: Implement weekly summary (on-demand)

**Objective:** The handoff doc describes a weekly summary feature that aggregates stored `one_line_summary` fields from entry tags. Runs on-demand only (user-triggered), never automatically.

**Files:**
- Create: `src/ai/weekly.ts` (or add to `src/ai/tagging.ts`)
- Modify: `src/pages/DashboardPage.tsx` (add "Weekly summary" button)
- Modify: `src/db/index.ts` (add `getEntrySummaries()` helper if not already in tagging.ts)

**Steps:**
1. Create `getWeeklySummary()` function that:
   - Fetches `one_line_summary` fields from the last 7 days of tagged entries via `getEntrySummaries(7)`
   - Sends them to the background model with the §5b weekly summary prompt
   - Uses REQUEST_CONFIG for weekly summary (temp 0.3, max_tokens 800)
2. Add a "📊 Weekly Summary" button to DashboardPage
3. Display the summary in a card below the button
4. **Critical constraint** (from handoff doc §5b): the prompt must explicitly forbid weekday inference from dates — pattern claims must cite the entry dates that support them; if day-of-week data was never recorded, the output must say so

### Task 3.10: Build and verify prompt system

**Steps:**
1. `npm run build` — verify no TypeScript errors
2. Manual test: write an entry → verify reflection uses new prompt
3. Manual test: start a brain dump session → verify response is ≤100 words, no bullets
4. Manual test: morning check-in → verify ≤80 words, one intention
5. Manual test: evening wind-down → verify ≤120 words, closure-oriented
6. Manual test: just talk → verify brief, matching energy
7. Manual test: save an entry → verify tagging runs in background and stores results
8. Manual test: weekly summary → verify it aggregates summaries, doesn't infer weekdays
9. Check OpenRouter logs → verify "Drift Journal", GitHub referer, and `data_collection: deny` appear

---

## Workstream 4: Privacy & Documentation

### Task 4.1: Address the README privacy gap

**Objective:** The README promises "only the current entry text" is transmitted, but Topic Suggestions already sends summaries of multiple entries (and tagging will add more).

**Approach:** Update the privacy copy to reflect reality. The handoff doc explicitly allows this: "update the README/privacy copy to say 'entry text and locally generated summaries of your recent entries.'" This is honest and the user always controls what's sent (they configure the API key, they trigger the features).

**Files:**
- Modify: `README.md`

### Task 4.2: Update README with model info

**Steps:**
1. Document the default models (Claude Sonnet 5 for chat, DeepSeek V4 Flash for background)
2. Document that the user can override both in Settings
3. Document the data-collection-deny privacy feature
4. Document the entry tagging and weekly summary features

---

## Execution Order

1. **Workstream 1** (PWA) — quickest visible win, unblocks install experience
2. **Workstream 2** (OpenRouter hardening) — small, self-contained
3. **Workstream 3 Tasks 3.1–3.4** (prompts + model defaults) — core functionality
4. **Workstream 3 Tasks 3.5–3.8** (per-function params + tagging + UI) — feature completion
5. **Workstream 3 Tasks 3.9–3.10** (weekly summary + verification) — final features
6. **Workstream 4** (docs) — last, after features are stable

## Risks

- **Service worker caching too aggressively**: If the SW caches API responses, OpenRouter calls could return stale data. Design: network-first strategy, never cache `/api/` paths.
- **Schema migration**: Adding a new Dexie table requires a version bump. Dexie handles this gracefully with `this.version(2).stores({...})`.
- **Claude Sonnet 5 slug**: The handoff doc says to "verify exact slug via OpenRouter models API at implementation time." Need to check `anthropic/claude-sonnet-5` exists before setting as default.
- **Background model availability**: DeepSeek V4 Flash may not always be available. The `chatComplete` call should handle errors gracefully and surface a non-intrusive notification.

## Open Questions (resolved)

1. ~~Privacy toggle vs. README update~~ → **README update** — update privacy copy to match reality.
2. ~~Weekly summary scope~~ → **Included** — on-demand feature in Dashboard, uses stored summaries.
3. Service worker strategy → **Precache app shell on first load, network-first thereafter.**
