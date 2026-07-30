# 🌊 Drift

**A local-first ADHD journaling app that helps you reflect, track moods, and build streaks — powered by AI, private by design.**

Drift is a web-based journaling tool built for people with ADHD who want a simple, distraction-free space to write, reflect, and grow. Your journal is stored locally on your device using IndexedDB. When you use AI features, entry text is sent to OpenRouter and your chosen model provider.

---

## ✨ Features

- 📝 **Journal Entries with Auto-Save Drafts** — Write freely without worrying about losing progress. Drafts are saved automatically as you type and recovered on reload.
- 🤖 **AI Reflections** — Get personalized reflections on your journal entries powered by OpenRouter AI models.
- 🏷️ **Auto-Tagging** — Every entry is automatically tagged with topics, mood words, tasks, and people mentioned — powering smarter suggestions and summaries.
- 😊 **Mood Tracking** — Log your mood alongside entries to visualize emotional patterns over time. Mood history stays in sync when you edit or delete entries.
- 🔥 **Streak System** — Build consistency with a streak tracker that forgives one missed day and preserves your longest streak even after a lapse.
- 💬 **AI Coach Chat** — Chat with one of three AI coach personalities: **Coach**, **Listener**, or **Challenger** — each with a unique approach to helping you reflect.
- 💡 **Topic Suggestions** — Never stare at a blank page again. AI-generated topic prompts tailored to your journaling history.
- 📊 **Weekly Summary** — Get a brief overview of your week's themes and patterns, generated from your entry summaries.
- 📱 **PWA Installable** — Install Drift on your phone or desktop for a native app experience with offline support.
- 📦 **Data Export** — Export your journal data in JSON format for backup or migration.
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

1. Download `drift-prod.zip` from the latest release
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

## 📋 Recent Changes

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

### Upgrade Notes (v0.1.x → v0.2.0)

> ⚠️ **Database migration is automatic** — Dexie handles schema upgrades transparently. No data loss.

**What changes:**
1. **PWA service worker** — The old handwritten `sw.js` is replaced by Workbox-generated service workers. After updating, your browser may cache the old service worker briefly. To force the update:
   - Open Drift → DevTools → Application → Service Workers → "Unregister"
   - Or hard-refresh (Ctrl+Shift+R / Cmd+Shift+R)
   - The new SW will activate on next load

2. **Reward records** — New rewards use the reward `type` as the primary key instead of random UUIDs. Existing rewards (from v0.1.x) with UUID keys will still display correctly. New awards will not duplicate existing ones even if the old UUID record exists.

3. **Entry tags** — The `entryTags` table schema changed from `id` primary key to `entryId` primary key. Dexie auto-migrates, but if you had duplicate tag records for the same entry (possible in v0.1.x due to a bug), only one will survive the migration.

4. **Personality storage** — Personality is now read from IndexedDB instead of localStorage. If you previously set a personality, it was already saved to IndexedDB by Settings. No action needed.

5. **Service worker precache** — The PWA now properly precaches all build assets (JS, CSS, fonts). First load after update may re-download all assets. Subsequent loads will be fully offline-capable.

**What to check after upgrading (v0.1.x → v0.2.0):**
- Streak counter may show different numbers (fixed forgiveness logic — was counting every-other-day indefinitely as a streak)
- Dashboard total entries/words should now be accurate (was capped at 20)
- Existing drafts will be restored to the journal editor on first load
- AI streaming responses should display with proper spacing (was previously corrupted)

---

### v0.2.1 — PWA Stale Cache Fix

**Fixed: App stuck on "Loading Drift…" in normal browser (works in incognito)**

The PWA was precaching `index.html` and serving it via Workbox's `NavigationRoute`. After deploying a new build, the old service worker kept serving the stale `index.html` which referenced deleted JS chunk hashes. The app JS failed to load silently, and `getApiKey()` hung forever — leaving users stuck on the loading screen.

**Changes:**
- **`vite.config.ts`** — Removed `html` from `globPatterns` (no longer precaches `index.html`). Disabled `navigateFallback`. Added `NetworkFirst` runtime caching for all navigation requests. The browser always tries to fetch `index.html` from the network first, falling back to cache only when offline.
- **`src/App.tsx`** — Added 5-second timeout + `.catch()` to `getApiKey()` initialization. If the DB init hangs (e.g. corrupted IndexedDB, stale SW), the app auto-clears the service worker and all caches, then proceeds to onboarding. Users are never stuck on the loading screen again.

**If you're currently stuck on "Loading Drift…":**
1. Open Drift in **incognito mode** (works immediately)
2. Go to **Settings** → **Export** to back up your data
3. Then either:
   - Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) to pick up the new SW
   - Or: Chrome → Settings → Site settings → find Drift → Clear & reset (⚠️ wipes IndexedDB — export first!)

> ⚠️ **Do NOT "Clear & reset" without exporting first** — this deletes all your journal entries stored in IndexedDB.
---

<p align="center">
  <strong>🌊 Drift — Journal freely. Reflect deeply. Stay private.</strong>
</p>
