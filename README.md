# 🌊 Drift

**A local-first ADHD journaling app that helps you reflect, track moods, and build streaks — powered by AI, private by design.**

Drift is a web-based journaling tool built for people with ADHD who want a simple, distraction-free space to write, reflect, and grow. Your journal is stored locally on your device using IndexedDB. When you use AI features, entry text is sent to OpenRouter and your chosen model provider.

---

## ✨ Features

- 📝 **Journal Entries with Auto-Save Drafts** — Write freely without worrying about losing progress. Drafts are saved automatically as you type and recovered on reload.
- 🧠 **Context Memory** — Drift builds a rolling profile of you (patterns, key facts, open loops, recent wins, mood trend) that makes AI reflections feel personal instead of generic. Refreshed every ~5 entries by the background model.
- 🤖 **AI Reflections** — Get personalized reflections powered by your context memory, today's tasks, recent entry summaries, and current entry — all in one prompt.
- ✅ **Daily Tasks** — Add tasks for today, tick them off while journaling. Tasks are also auto-extracted from your entries by the background model.
- 📋 **Task Presets** — Create recurring daily tasks for morning, midday, afternoon, and night. **One task can span multiple time slots** (e.g. "drink water" under Morning 🌅 + Afternoon 🌤️ + Night 🌙), each checked off independently — no more duplicate entries. Toggle a task's segments via the slot menu and reorder each segment independently.
- 📆 **Weekly Tasks** — Set tasks that repeat weekly with configurable frequency (e.g., "exercise 3×/week"). Track completions across the running week with progress dots.
- 📝 **To-Dos** — Persistent tasks that don't expire daily. Set optional due dates with overdue/today/this-week visual urgency cues.
- 🔔 **Smart Notifications** — Configurable reminders to journal and check tasks. **Per-part-of-day task reminders** fire at the end of morning, midday, afternoon, and night slots. Evening reminders only fire if you haven't journaled. General task reminders cover custom tasks and to-dos.
- 🧠 **AI Nudges** — Reflection and coach chat now include task context: undone daily tasks, overdue to-dos, and stalling weekly tasks get gentle, natural reminders woven into the AI response.
- 🏷️ **Auto-Tagging** — Every entry is automatically tagged with topics, mood words, tasks, and people mentioned. Extracted tasks are promoted to your task list.
- 😊 **Mood Tracking** — Log your mood alongside entries to visualize emotional patterns over time.
- 🔥 **Streak System** — Build consistency with a streak tracker that forgives one missed day and preserves your longest streak even after a lapse.
- 💬 **AI Coach Chat** — Chat with one of three AI coach personalities: **Coach**, **Listener**, or **Challenger** — each with a unique approach to helping you reflect.
- 💡 **Topic Suggestions** — Never stare at a blank page again. AI-generated topic prompts tailored to your journaling history.
- 📊 **Weekly Summary** — Get a brief overview of your week's themes and patterns, generated from your entry summaries.
- 📱 **PWA Installable** — Install Drift on your phone or desktop for a native app experience with offline support.
- 📦 **Data Export** — Export your journal data in JSON format for backup or migration.
- 🔄 **WebDAV Sync** — Optional cross-platform sync via any WebDAV server. Pull-first with conflict detection, tombstone deletion sync, and local backup of conflicting records.
- 🌙 **Dark Theme with Accessible Colors** — A carefully designed dark UI with WCAG-compliant contrast ratios.
- 🔒 **Local-First** — Your journal is stored locally on this device. When you use AI features, entry text is sent to OpenRouter and your chosen model provider.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19+ |
| **Language** | TypeScript |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS |
| **Local Storage** | Dexie.js (IndexedDB) |
| **AI Integration** | OpenRouter API |
| **PWA** | vite-plugin-pwa + Workbox |
| **State Management** | React Hooks |
| **Routing** | React Router |

---

## 📥 Download

**Pre-built releases** — no Node.js required:
[GitHub Releases](https://github.com/jbecker-it/drift/releases)

1. Download `drift-v1.0.0.zip` from the latest release
2. Unzip it
3. Serve the `dist/` folder (e.g. `npx serve dist`, or deploy to any static host)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** 9+ (comes with Node.js)
- An **OpenRouter API key** ([get one here](https://openrouter.ai/keys))

### 1. Clone the Repository

```bash
git clone https://github.com/jbecker-it/drift.git
cd drift
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Development Server

```bash
npm run dev
```

The app will be available at **http://localhost:5173**.

> 💡 **No .env file needed!** API key and model are configured through the app's onboarding flow and stored locally in IndexedDB.

### 4. Build for Production

```bash
npm run build
```

The output will be in the `dist/` directory, ready to deploy to any static hosting service.

### 5. Preview the Production Build

```bash
npm run preview
```

---

## ⚙️ Configuration

### API Key Setup

Drift uses [OpenRouter](https://openrouter.ai/) for AI features. You need to provide your own API key.

1. Create an account at [OpenRouter](https://openrouter.ai/).
2. Generate an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
3. Enter the key in Drift's **onboarding wizard** or **Settings** page.

> 🔒 Your API key is stored locally in IndexedDB. When you use AI features, it is sent to OpenRouter to authenticate requests.

### Model Selection

Drift ships with two AI model slots, both configurable in Settings:

| Slot | Default Model | Purpose | Parameters |
|------|--------------|---------|------------|
| **Primary** | `anthropic/claude-sonnet-5` | AI Coach chat, reflections, topic suggestions | temp 0.7, max 1000 tokens |
| **Background** | `deepseek/deepseek-v4-flash` | Entry tagging, weekly summaries | temp 0.2, max 600 tokens |

You can override both models in **Settings**. Per-function parameters (temperature, max tokens) are baked into the app design and not user-configurable.

### Entry Tagging & Weekly Summary

When you save an entry, Drift automatically extracts structured data (topics, mood words, tasks, people) using the background model. Entry text is sent to OpenRouter for this processing. If tagging fails, the status is tracked on the entry and you can retry from the entry card.

The **Weekly summary** (available on the Dashboard) aggregates your recent entry summaries into a brief overview.

### AI Coach Personalities

Drift offers three AI coach personalities, each with a distinct communication style:

| Personality | Description |
|-------------|-------------|
| 🏋️ **Coach** | Encouraging and action-oriented. Helps you set goals and stay accountable. |
| 👂 **Listener** | Calm and empathetic. Just holds space for your thoughts and feelings. |
| 🥊 **Challenger** | Direct and probing. Questions your assumptions and pushes you to think deeper. |

---

## 🔐 Data Privacy

- **All journal entries, mood logs, sessions, streak data, and AI-generated tags** are stored in your browser's IndexedDB via Dexie.js.
- **When you use AI features**, your current entry text is sent to OpenRouter and the selected model provider. This includes reflections, auto-tagging, topic suggestions, coach chat context, and weekly summaries.
- **No user accounts, no tracking, no analytics.**
- Every OpenRouter request includes `provider: { data_collection: "deny" }` to ensure your data is not used for model training.
- **Data export** lets you download everything as JSON for backup or migration.

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug report, feature request, or pull request — we'd love your help.

1. **Fork** the repository.
2. **Create a branch** for your feature or fix.
3. **Make your changes** and ensure `npm run build` passes.
4. **Commit** with a clear message following [Conventional Commits](https://www.conventionalcommits.org/).
5. **Push** and open a **Pull Request**.

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 📋 Changelog

### v1.0.0 — First Stable Release 🎉

**🏁 Marking the jump to 1.0** after a full pre-release review and hardening pass across the whole codebase.

- **WebDAV sync now runs automatically in the background** when configured: a periodic sync every 5 minutes while the app is open, plus an immediate sync whenever the tab becomes visible, on top of the existing event-driven debounced sync after data changes. All sync calls are guarded by a mutex and have network timeouts so a slow server can never block the UI.
- **Deletions propagate reliably**: entry, task, and slot changes that remove records now write tombstones and push them, so deleted data can't resurrect from another device.
- **Weekly tasks roll over and reset correctly**: weekly instances are created atomically (no cross-tab duplicates) and are trimmed — with tombstones — if you lower a task's weekly frequency mid-week.
- **Task data now reaches the AI**: daily preset tasks are included in reflection and coach context, and reflection waits for tagging so an entry's own tasks are present in its reflection.
- **Data-loss fixes in the editor**: tapping "Done" after the first save now flushes your edits, editing an entry no longer deletes extracted tasks before re-tagging, and draft recovery can't clobber what you're typing.
- Hardened AI sub-system (response validation, reasoning-tag cleanup, offline model-cache fallback) and Settings/Onboarding reliability fixes.
- 15 automated tests passing (task rollover, trimming, task→AI context, multi-slot presets).

### v0.6.0 — Multi-Slot Daily Presets

**📋 One Task, Many Points in the Day**

- A daily preset task can now apply across **multiple** time-of-day segments (Morning 🌅, Midday ☀️, Afternoon 🌤️, Night 🌙) with a single entry
- Each segment gets its own independent checkbox — e.g. track "drink water" 🌅 + ☀️ + 🌙 with one task instead of three duplicate rows
- New-preset form has a **multi-select** emoji picker: toggle any combination of segments
- The slot menu (↗) edits a task's segments after creation; the last remaining segment can't be removed
- **Independent per-segment ordering** — reorder a task in the Morning list without disturbing the Night list
- Legacy single-slot tasks keep working unchanged: no migration needed, no duplicate instances

**✅ Data Integrity**

- `ensureDailyPresetInstances` is now one atomic transaction — concurrent loads (tasks page, journal, notifications) can never create duplicate instances
- Slot edits are transactional: legacy instances are materialized to their original slot and removed-slot instances are cleaned up (no reinterpretation bugs)
- Normalized slot lists (dedupe + day-slot only), empty-slot rejection, per-slot order seeding

**🔍 Quality**

- Code reviewed with **GPT-5.6-Terra** (3 rounds — every finding fixed and re-validated to sign-off)
- Added `npm test`: 10 regression tests over the real data layer via `fake-indexeddb`

---

### v0.5.4 — Per-Slot Notifications, WebDAV Sync & Extended Onboarding

**🔔 Per-Part-of-Day Task Notifications**

- Task reminders now fire at the end of each time slot: Morning 🌅, Midday ☀️, Afternoon 🌤️, Night 🌙
- Each reminder shows undone tasks assigned to that slot via preset templates
- General task reminder for custom tasks and to-dos without a slot assignment
- 4 configurable slot-end times in Settings (default: 12:00, 14:00, 18:00, 22:00)
- Toggle to enable/disable per-slot reminders independently

**🔄 WebDAV Sync (Optional, Local-First)**

- Sync your journal across devices via any WebDAV server (Nextcloud, Synology, ownCloud, etc.)
- Pull-first sync: detects conflicts before overwriting remote data
- Tombstone system: deletions propagate to other devices
- Conflict backup: local records backed up to server before merge
- All settings, credentials, and sync config configurable in Settings page
- Data remains fully local — sync is entirely optional

**🚀 Extended Onboarding (6 Steps)**

- Welcome → API Key → Models → Personality → **Notifications** → **Sync** → Done
- Notification setup: enable/disable, configure morning/evening/task reminder times
- WebDAV sync setup: server URL, credentials (optional, can skip)

**✅ Code Quality**

- 4 rounds of GPT-5.6 Luna Pro review (43 issues found and fixed)
- Transactional merge, URL validation, HTTPS enforcement, tombstone conflict safety
- Serialized notification saves, error surfacing in onboarding
- UTF-8 safe auth encoding, backup response validation

---

### v0.4.0 — Task System Overhaul + Notifications + AI Nudges

Major feature release: frictionless daily and weekly task management with smart AI-powered nudges.

**📋 Task Presets (Daily Segments)**

- New preset system with 4 time-of-day slots: Morning 🌅, Midday ☀️, Afternoon 🌤️, Night 🌙
- Create preset tasks that auto-appear every day in their assigned slot
- Move tasks between segments via click-to-open dropdown menu
- Each slot shows progress counter; tasks get ✓ when done
- DB schema v7: new `taskTemplates` table for preset and weekly definitions

**📆 Weekly Tasks**

- Define tasks with configurable frequency (1–7× per week)
- Each week gets individual checkbox buttons — tick them off throughout the week
- Progress dots visualize completions vs. needed count
- "Running week" = Monday to Sunday — resets automatically
- Stalling detection: AI nudges when weekly tasks are behind schedule

**📝 To-Dos (Persistent Tasks)**

- Tasks that persist until done — not tied to any specific day
- Optional due date with visual urgency cues:
  - 🔴 Red border + "Overdue" badge when past due
  - 🟡 Amber border + "Today" badge when due today
  - 🔵 Blue border when due within 3 days
- DB schema v8: `type` and `dueDate` fields on tasks

**🔔 PWA Notifications**

- 3 configurable notification types with custom times:
  - 🌅 Morning: journal reminder
  - 🌙 Evening: only fires if no journal entry today
  - 📋 Tasks: only fires if there are undone tasks or overdue to-dos
- Settings UI with toggle + time pickers
- Best-effort while app is open; uses service worker `showNotification` when available
- Permission re-check on browser tab focus change

**🧠 AI Nudges**

- New `getTaskNudgeSummary()` builds context for AI: undone daily tasks, overdue to-dos, stalling weekly tasks
- Injected into reflection prompt via `<task_nudge>` tag
- Injected into coach chat context as `[Task status]` section
- Reflection weaves ONE gentle nudge naturally — most urgent item first
- Coach gets full nudge context for relevant references

**✅ Bug Fixes (22 issues across 3 GPT-5.6 Luna Pro review rounds)**

- Dexie v3 migration: added dedup `upgrade()` callback for duplicate `entryId` records
- `getTodaysTasks` now excludes to-dos (previously returned them as daily tasks)
- Notification timers: idempotent init, generation-token concurrency safety, DST-safe midnight reschedule
- Weekly checkboxes: now correctly call `toggleTask` (was non-functional before fix)
- Auto-save/Done race: `draftSessionRef` token prevents orphan drafts after Done
- handleDone/save race: save checks session token before applying post-save state
- Draft recovery: fixed to restore newest draft (was restoring oldest)
- Save error handling: try/catch/finally with visible error messages
- DB init timeout: shows error state with Retry button instead of nuking caches
- Settings save: proper error handling with loading state
- Move menu: keyboard accessible (click toggle, outside-click close, aria attributes)
- Tabs: ARIA roles (`tab`, `tabpanel`, `aria-selected`, `aria-controls`)
- Sidebar: `aria-label="Primary navigation"`, emoji `aria-hidden`
- 404 catch-all route added
- Notification permission re-checked on `visibilitychange`

**Upgrade Notes (v0.3.x → v0.4.0)**

> ⚠️ **Database migration is automatic** — Dexie handles schema upgrades transparently.

1. **DB schema v7** — New `taskTemplates` table + task indexes (`templateId`, `weekKey`)
2. **DB schema v8** — Tasks gain `type` and `dueDate` fields
3. **Task tab redesign** — Tasks page now has 4 tabs: Daily · Weekly · To-Dos · Custom
4. **Notification settings** — New section in Settings (disabled by default)
5. **AI reflections** — Now include task nudge context (one gentle reminder per reflection)

---

### v0.3.0 — Context Memory + Enhanced Reflection + Tasks

Major feature release: the app now remembers you across sessions and reflects with full context.

**🧠 Context Memory (the core upgrade)**

- New `contextMemory` table stores a rolling profile: patterns, key facts, open loops, recent wins, mood trend
- Background refresh via DeepSeek Flash every ~5 entries (fire-and-forget)
- Analyzes tagged summaries + recent entry full text, merges incrementally
- Profile validated on save (array types, length limits)

**✅ Daily Tasks**

- Tasks page for managing today's tasks (add, complete, delete)
- Inline task checkboxes on the Journal page
- Tasks auto-extracted from journal entries via background tagging (`tasks_open`/`tasks_done`)
- Per-day reset — each morning starts fresh

**🔗 Enhanced Reflection Prompt**

- Reflection now includes: context memory + last 3 entry summaries + today's tasks + current entry
- Data injected via `<context_memory>`, `<recent_entries>`, `<today_tasks>`, `<current_entry>` delimiters
- Anti-injection instruction in system prompt

**Bug fixes from review**

- Tasks table indexes `entryId` (DB v6 migration)
- Single `tagEntry` call chains extraction + refresh (no duplicate API calls)
- `deleteEntry` cascades to tasks
- `toggleTask` uses atomic Dexie `modify()`
- Historical reflection skips today's tasks
- Reflection excludes current entry from summaries (case-insensitive prefix match)
- Context memory output validated (array types, limits: patterns:5, keyFacts:8, openLoops:5, wins:5)
- `clearAllData` and `exportAllData` include tasks + contextMemory
- Re-tag on edit uses original entry date, clears old extracted tasks

---

### v0.2.0 — Comprehensive Bug Fix Release

Major bug fix pass based on a 4-round code review by GPT-5.6-Terra. 18 bugs fixed + 6 edge cases resolved.

**Critical fixes:**

- **Streaming AI output corrupted** — All streamed responses had spaces stripped between words. Fixed by removing `.trim()` from per-chunk processing.
- **Prompt injection via journal entries** — Journal context was sent as `role: 'system'`, giving user text system-level authority. Changed to `role: 'user'` with explicit delimiters and anti-injection instructions.
- **Draft/save race condition** — Auto-save and manual Save could create duplicate drafts. Now uses a serialized promise chain and finalizes drafts in-place.
- **Drafts inflated all stats** — Drafts were included in entry counts, word totals, streaks, and coach context. All queries now filter `isDraft`.
- **Deleting entries left orphaned data** — Tags, moods, and sessions were not cleaned up. Now uses cascading Dexie transactions.
- **Mood history out of sync** — Editing or deleting entries didn't update mood records. Now synced transactionally.

**High fixes:**

- Dashboard "Total entries" now uses full database, not just last 20
- Coach session end now cancels in-flight AI streams
- Separate abort controllers per operation (no more cross-interference)
- Auto-tagging errors tracked on entries with retry path
- Service worker replaced with vite-plugin-pwa (precaches all hashed bundles)
- Achievements now actually awarded on save

**Edge cases resolved:**

- Streak forgiveness limited to one missed day per streak (was unlimited)
- Longest streak preserved even after current streak lapses
- Mood chart 30-day range now inclusive (was off-by-one)
- DST-safe date calculations for streak tracking
- Stateful reasoning-tag filter handles tags spanning multiple stream chunks
- Drafts recovered on app reload
- Tag resurrection after deletion prevented via transactional existence check
- Reward awards made atomic with backward-compatible lookup
- Settings toggles have proper accessibility attributes
- Privacy claims updated to accurately reflect AI data usage

**Infrastructure:**

- PWA upgraded from handwritten `sw.js` to `vite-plugin-pwa` with Workbox
- DB schema v3: `entryTags.entryId` as primary key (prevents duplicate tags)
- New `taggingStatus`/`taggingError` fields on entries

---

### v0.2.1 — PWA Stale Cache Fix

**Fixed: App stuck on "Loading Drift…" in normal browser (works in incognito)**

The PWA was precaching `index.html` and serving it via Workbox's `NavigationRoute`. After deploying a new build, the old service worker kept serving the stale `index.html` which referenced deleted JS chunk hashes. The app JS failed to load silently, and `getApiKey()` hung forever — leaving users stuck on the loading screen.

**Changes:**

- **`vite.config.ts`** — Removed `html` from `globPatterns` (no longer precaches `index.html`). Disabled `navigateFallback`. Added `NetworkFirst` runtime caching for all navigation requests.
- **`src/App.tsx`** — Added 5-second timeout + `.catch()` to `getApiKey()` initialization. If the DB init hangs, the app auto-clears the service worker and all caches, then proceeds to onboarding.

---

<p align="center">
  <strong>🌊 Drift — Journal freely. Reflect deeply. Stay private.</strong>
</p>
