1|# 🌊 Drift
2|
3|**A local-first ADHD journaling app that helps you reflect, track moods, and build streaks — powered by AI, private by design.**
4|
5|Drift is a web-based journaling tool built for people with ADHD who want a simple, distraction-free space to write, reflect, and grow. Your journal is stored locally on your device using IndexedDB. When you use AI features, entry text is sent to OpenRouter and your chosen model provider.
6|
7|---
8|
9|## ✨ Features
10|
11|- 📝 **Journal Entries with Auto-Save Drafts** — Write freely without worrying about losing progress. Drafts are saved automatically as you type and recovered on reload.
12|- 🧠 **Context Memory** — Drift builds a rolling profile of you (patterns, key facts, open loops, recent wins, mood trend) that makes AI reflections feel personal instead of generic. Refreshed every ~5 entries by the background model.
13|- 🤖 **AI Reflections** — Get personalized reflections powered by your context memory, today's tasks, recent entry summaries, and current entry — all in one prompt.
14|- ✅ **Daily Tasks** — Add tasks for today, tick them off while journaling. Tasks are also auto-extracted from your entries by the background model.
15|- 📋 **Task Presets** — Create recurring daily tasks for morning, midday, afternoon, and night. Tasks auto-appear each day in their time slot. Move tasks between segments with one click.
16|- 📆 **Weekly Tasks** — Set tasks that repeat weekly with configurable frequency (e.g., "exercise 3×/week"). Track completions across the running week with progress dots.
17|- 📝 **To-Dos** — Persistent tasks that don't expire daily. Set optional due dates with overdue/today/this-week visual urgency cues.
18|- 🔔 **Smart Notifications** — Configurable reminders to journal and check tasks. **Per-part-of-day task reminders** fire at the end of morning, midday, afternoon, and night slots. Evening reminders only fire if you haven't journaled. General task reminders cover custom tasks and to-dos.
19|- 🧠 **AI Nudges** — Reflection and coach chat now include task context: undone daily tasks, overdue to-dos, and stalling weekly tasks get gentle, natural reminders woven into the AI response.
20|- 🏷️ **Auto-Tagging** — Every entry is automatically tagged with topics, mood words, tasks, and people mentioned. Extracted tasks are promoted to your task list.
21|- 😊 **Mood Tracking** — Log your mood alongside entries to visualize emotional patterns over time.
22|- 🔥 **Streak System** — Build consistency with a streak tracker that forgives one missed day and preserves your longest streak even after a lapse.
23|- 💬 **AI Coach Chat** — Chat with one of three AI coach personalities: **Coach**, **Listener**, or **Challenger** — each with a unique approach to helping you reflect.
24|- 💡 **Topic Suggestions** — Never stare at a blank page again. AI-generated topic prompts tailored to your journaling history.
25|- 📊 **Weekly Summary** — Get a brief overview of your week's themes and patterns, generated from your entry summaries.
26|- 📱 **PWA Installable** — Install Drift on your phone or desktop for a native app experience with offline support.
27|- 📦 **Data Export** — Export your journal data in JSON format for backup or migration.
- 🔄 **WebDAV Sync** — Optional cross-platform sync via any WebDAV server. Pull-first with conflict detection, tombstone deletion sync, and local backup of conflicting records.
28|- 🌙 **Dark Theme with Accessible Colors** — A carefully designed dark UI with WCAG-compliant contrast ratios.
29|- 🔒 **Local-First** — Your journal is stored locally on this device. When you use AI features, entry text is sent to OpenRouter and your chosen model provider.
30|
31|---
32|
33|## 🛠️ Tech Stack
34|
35|| Layer | Technology |
36||-------|-----------|
37|| **Framework** | React 19+ |
38|| **Language** | TypeScript |
39|| **Build Tool** | Vite |
40|| **Styling** | Tailwind CSS |
41|| **Local Storage** | Dexie.js (IndexedDB) |
42|| **AI Integration** | OpenRouter API |
43|| **PWA** | vite-plugin-pwa + Workbox |
44|| **State Management** | React Hooks |
45|| **Routing** | React Router |
46|
47|---
48|
49|## 📥 Download
50|
51|**Pre-built releases** — no Node.js required:
52|[GitHub Releases](https://github.com/jbecker-it/drift/releases)
53|
54|1. Download `drift-prod.zip` from the latest release
55|2. Unzip it
56|3. Serve the `dist/` folder (e.g. `npx serve dist`, or deploy to any static host)
57|
58|---
59|
60|## 🚀 Getting Started
61|
62|### Prerequisites
63|
64|- **Node.js** 18+ ([download](https://nodejs.org/))
65|- **npm** 9+ (comes with Node.js)
66|- An **OpenRouter API key** ([get one here](https://openrouter.ai/keys))
67|
68|### 1. Clone the Repository
69|
70|```bash
71|git clone https://github.com/jbecker-it/drift.git
72|cd drift
73|```
74|
75|### 2. Install Dependencies
76|
77|```bash
78|npm install
79|```
80|
81|### 3. Start the Development Server
82|
83|```bash
84|npm run dev
85|```
86|
87|The app will be available at **http://localhost:5173**.
88|
89|> 💡 **No .env file needed!** API key and model are configured through the app's onboarding flow and stored locally in IndexedDB.
90|
91|### 4. Build for Production
92|
93|```bash
94|npm run build
95|```
96|
97|The output will be in the `dist/` directory, ready to deploy to any static hosting service.
98|
99|### 5. Preview the Production Build
100|
101|```bash
102|npm run preview
103|```
104|
105|---
106|
107|## ⚙️ Configuration
108|
109|### API Key Setup
110|
111|Drift uses [OpenRouter](https://openrouter.ai/) for AI features. You need to provide your own API key.
112|
113|1. Create an account at [OpenRouter](https://openrouter.ai/).
114|2. Generate an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
115|3. Enter the key in Drift's **onboarding wizard** or **Settings** page.
116|
117|> 🔒 Your API key is stored locally in IndexedDB. When you use AI features, it is sent to OpenRouter to authenticate requests.
118|
119|### Model Selection
120|
121|Drift ships with two AI model slots, both configurable in Settings:
122|
123|| Slot | Default Model | Purpose | Parameters |
124||------|--------------|---------|------------|
125|| **Primary** | `anthropic/claude-sonnet-5` | AI Coach chat, reflections, topic suggestions | temp 0.7, max 1000 tokens |
126|| **Background** | `deepseek/deepseek-v4-flash` | Entry tagging, weekly summaries | temp 0.2, max 600 tokens |
127|
128|You can override both models in **Settings**. Per-function parameters (temperature, max tokens) are baked into the app design and not user-configurable.
129|
130|### Entry Tagging & Weekly Summary
131|
132|When you save an entry, Drift automatically extracts structured data (topics, mood words, tasks, people) using the background model. Entry text is sent to OpenRouter for this processing. If tagging fails, the status is tracked on the entry and you can retry from the entry card.
133|
134|The **Weekly summary** (available on the Dashboard) aggregates your recent entry summaries into a brief overview.
135|
136|### AI Coach Personalities
137|
138|Drift offers three AI coach personalities, each with a distinct communication style:
139|
140|| Personality | Description |
141||-------------|-------------|
142|| 🏋️ **Coach** | Encouraging and action-oriented. Helps you set goals and stay accountable. |
143|| 👂 **Listener** | Calm and empathetic. Just holds space for your thoughts and feelings. |
144|| 🥊 **Challenger** | Direct and probing. Questions your assumptions and pushes you to think deeper. |
145|
146|---
147|
148|## 🔐 Data Privacy
149|
150|- **All journal entries, mood logs, sessions, streak data, and AI-generated tags** are stored in your browser's IndexedDB via Dexie.js.
151|- **When you use AI features**, your current entry text is sent to OpenRouter and the selected model provider. This includes reflections, auto-tagging, topic suggestions, coach chat context, and weekly summaries.
152|- **No user accounts, no tracking, no analytics.**
153|- Every OpenRouter request includes `provider: { data_collection: "deny" }` to ensure your data is not used for model training.
154|- **Data export** lets you download everything as JSON for backup or migration.
155|
156|---
157|
158|## 🤝 Contributing
159|
160|Contributions are welcome! Whether it's a bug report, feature request, or pull request — we'd love your help.
161|
162|1. **Fork** the repository.
163|2. **Create a branch** for your feature or fix.
164|3. **Make your changes** and ensure `npm run build` passes.
165|4. **Commit** with a clear message following [Conventional Commits](https://www.conventionalcommits.org/).
166|5. **Push** and open a **Pull Request**.
167|
168|---
169|
170|## 📄 License
171|
172|This project is licensed under the **MIT License**.
173|
174|---
175|
176|## 📋 Recent Changes
177|
178|### v0.5.0 — Per-Slot Notifications, WebDAV Sync & Extended Onboarding

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
- Version bumped to v0.5.0

**✅ Code Quality**
- 4 rounds of GPT-5.6 Luna Pro review (43 issues found and fixed)
- Transactional merge, URL validation, HTTPS enforcement, tombstone conflict safety
- Serialized notification saves, error surfacing in onboarding
- UTF-8 safe auth encoding, backup response validation

### v0.4.0 — Task System Overhaul + Notifications + AI Nudges
179|
180|Major feature release: frictionless daily and weekly task management with smart AI-powered nudges.
181|
182|**📋 Task Presets (Daily Segments)**
183|- New preset system with 4 time-of-day slots: Morning 🌅, Midday ☀️, Afternoon 🌤️, Night 🌙
184|- Create preset tasks that auto-appear every day in their assigned slot
185|- Move tasks between segments via click-to-open dropdown menu
186|- Each slot shows progress counter; tasks get ✓ when done
187|- DB schema v7: new `taskTemplates` table for preset and weekly definitions
188|
189|**📆 Weekly Tasks**
190|- Define tasks with configurable frequency (1–7× per week)
191|- Each week gets individual checkbox buttons — tick them off throughout the week
192|- Progress dots visualize completions vs. needed count
193|- "Running week" = Monday to Sunday — resets automatically
194|- Stalling detection: AI nudges when weekly tasks are behind schedule
195|
196|**📝 To-Dos (Persistent Tasks)**
197|- Tasks that persist until done — not tied to any specific day
198|- Optional due date with visual urgency cues:
199|  - 🔴 Red border + "Overdue" badge when past due
200|  - 🟡 Amber border + "Today" badge when due today
201|  - 🔵 Blue border when due within 3 days
202|- DB schema v8: `type` and `dueDate` fields on tasks
203|
204|**🔔 PWA Notifications**
205|- 3 configurable notification types with custom times:
206|  - 🌅 Morning: journal reminder
207|  - 🌙 Evening: only fires if no journal entry today
208|  - 📋 Tasks: only fires if there are undone tasks or overdue to-dos
209|- Settings UI with toggle + time pickers
210|- Best-effort while app is open; uses service worker `showNotification` when available
211|- Permission re-check on browser tab focus change
212|
213|**🧠 AI Nudges**
214|- New `getTaskNudgeSummary()` builds context for AI: undone daily tasks, overdue to-dos, stalling weekly tasks
215|- Injected into reflection prompt via `<task_nudge>` tag
216|- Injected into coach chat context as `[Task status]` section
217|- Reflection weaves ONE gentle nudge naturally — most urgent item first
218|- Coach gets full nudge context for relevant references
219|
220|**✅ Bug Fixes (22 issues across 3 GPT-5.6 Luna Pro review rounds)**
221|- Dexie v3 migration: added dedup `upgrade()` callback for duplicate `entryId` records
222|- `getTodaysTasks` now excludes to-dos (previously returned them as daily tasks)
223|- Notification timers: idempotent init, generation-token concurrency safety, DST-safe midnight reschedule
224|- Weekly checkboxes: now correctly call `toggleTask` (was non-functional before fix)
225|- Auto-save/Done race: `draftSessionRef` token prevents orphan drafts after Done
226|- handleDone/save race: save checks session token before applying post-save state
227|- Draft recovery: fixed to restore newest draft (was restoring oldest)
228|- Save error handling: try/catch/finally with visible error messages
229|- DB init timeout: shows error state with Retry button instead of nuking caches
230|- Settings save: proper error handling with loading state
231|- Move menu: keyboard accessible (click toggle, outside-click close, aria attributes)
232|- Tabs: ARIA roles (`tab`, `tabpanel`, `aria-selected`, `aria-controls`)
233|- Sidebar: `aria-label="Primary navigation"`, emoji `aria-hidden`
234|- 404 catch-all route added
235|- Notification permission re-checked on `visibilitychange`
236|
237|**Upgrade Notes (v0.3.x → v0.4.0)**
238|> ⚠️ **Database migration is automatic** — Dexie handles schema upgrades transparently.
239|
240|1. **DB schema v7** — New `taskTemplates` table + task indexes (`templateId`, `weekKey`)
241|2. **DB schema v8** — Tasks gain `type` and `dueDate` fields
242|3. **Task tab redesign** — Tasks page now has 4 tabs: Daily · Weekly · To-Dos · Custom
243|4. **Notification settings** — New section in Settings (disabled by default)
244|5. **AI reflections** — Now include task nudge context (one gentle reminder per reflection)
245|
246|### v0.3.0 — Context Memory + Enhanced Reflection + Tasks
247|
248|Major feature release: the app now remembers you across sessions and reflects with full context.
249|
250|**🧠 Context Memory (the core upgrade)**
251|- New `contextMemory` table stores a rolling profile: patterns, key facts, open loops, recent wins, mood trend
252|- Background refresh via DeepSeek Flash every ~5 entries (fire-and-forget)
253|- Analyzes tagged summaries + recent entry full text, merges incrementally
254|- Profile validated on save (array types, length limits)
255|
256|**✅ Daily Tasks**
257|- Tasks page for managing today's tasks (add, complete, delete)
258|- Inline task checkboxes on the Journal page
259|- Tasks auto-extracted from journal entries via background tagging (`tasks_open`/`tasks_done`)
260|- Per-day reset — each morning starts fresh
261|
262|**🔗 Enhanced Reflection Prompt**
263|- Reflection now includes: context memory + last 3 entry summaries + today's tasks + current entry
264|- Data injected via `<context_memory>`, `<recent_entries>`, `<today_tasks>`, `<current_entry>` delimiters
265|- Anti-injection instruction in system prompt
266|
267|**Bug fixes from review**
268|- Tasks table indexes `entryId` (DB v6 migration)
269|- Single `tagEntry` call chains extraction + refresh (no duplicate API calls)
270|- `deleteEntry` cascades to tasks
271|- `toggleTask` uses atomic Dexie `modify()`
272|- Historical reflection skips today's tasks
273|- Reflection excludes current entry from summaries (case-insensitive prefix match)
274|- Context memory output validated (array types, limits: patterns:5, keyFacts:8, openLoops:5, wins:5)
275|- `clearAllData` and `exportAllData` include tasks + contextMemory
276|- Re-tag on edit uses original entry date, clears old extracted tasks
277|
278|### v0.2.0 — Comprehensive Bug Fix Release
279|
280|Major bug fix pass based on a 4-round code review by GPT-5.6-Terra. 18 bugs fixed + 6 edge cases resolved.
281|
282|**Critical fixes:**
283|- **Streaming AI output corrupted** — All streamed responses had spaces stripped between words. Fixed by removing `.trim()` from per-chunk processing.
284|- **Prompt injection via journal entries** — Journal context was sent as `role: 'system'`, giving user text system-level authority. Changed to `role: 'user'` with explicit delimiters and anti-injection instructions.
285|- **Draft/save race condition** — Auto-save and manual Save could create duplicate drafts. Now uses a serialized promise chain and finalizes drafts in-place.
286|- **Drafts inflated all stats** — Drafts were included in entry counts, word totals, streaks, and coach context. All queries now filter `isDraft`.
287|- **Deleting entries left orphaned data** — Tags, moods, and sessions were not cleaned up. Now uses cascading Dexie transactions.
288|- **Mood history out of sync** — Editing or deleting entries didn't update mood records. Now synced transactionally.
289|
290|**High fixes:**
291|- Dashboard "Total entries" now uses full database, not just last 20
292|- Coach session end now cancels in-flight AI streams
293|- Separate abort controllers per operation (no more cross-interference)
294|- Auto-tagging errors tracked on entries with retry path
295|- Service worker replaced with vite-plugin-pwa (precaches all hashed bundles)
296|- Achievements now actually awarded on save
297|
298|**Edge cases resolved:**
299|- Streak forgiveness limited to one missed day per streak (was unlimited)
300|- Longest streak preserved even after current streak lapses
301|- Mood chart 30-day range now inclusive (was off-by-one)
302|- DST-safe date calculations for streak tracking
303|- Stateful reasoning-tag filter handles tags spanning multiple stream chunks
304|- Drafts recovered on app reload
305|- Tag resurrection after deletion prevented via transactional existence check
306|- Reward awards made atomic with backward-compatible lookup
307|- Settings toggles have proper accessibility attributes
308|- Privacy claims updated to accurately reflect AI data usage
309|
310|**Infrastructure:**
311|- PWA upgraded from handwritten `sw.js` to `vite-plugin-pwa` with Workbox
312|- DB schema v3: `entryTags.entryId` as primary key (prevents duplicate tags)
313|- New `taggingStatus`/`taggingError` fields on entries
314|
315|### Upgrade Notes (v0.2.x → v0.3.0)
316|
317|> ⚠️ **Database migration is automatic** — Dexie handles schema upgrades transparently. No data loss.
318|
319|**What changes:**
320|1. **DB schema v6** — `tasks` table gains an `entryId` index. Auto-migrated.
321|2. **New `contextMemory` table** — Starts empty, populated after ~5 entries with AI-generated profile.
322|3. **Enhanced reflection** — Reflections now reference your history, tasks, and patterns. They'll be longer and more specific.
323|4. **Auto-extracted tasks** — Entries mentioning tasks will now populate your task list automatically.
324|5. **Reflection prompt size** — Reflections now send more context (memory + summaries + tasks), so they use slightly more tokens.
325|
326|**What to check after upgrading:**
327|- Context memory starts empty — write ~5 entries and it will build automatically
328|- Tasks page may show auto-extracted tasks from recent entries
329|- Reflections should feel more personal and specific
330|
331|### Upgrade Notes (v0.1.x → v0.2.0)
332|
333|> ⚠️ **Database migration is automatic** — Dexie handles schema upgrades transparently. No data loss.
334|
335|**What changes:**
336|1. **PWA service worker** — The old handwritten `sw.js` is replaced by Workbox-generated service workers. After updating, your browser may cache the old service worker briefly. To force the update:
337|   - Open Drift → DevTools → Application → Service Workers → "Unregister"
338|   - Or hard-refresh (Ctrl+Shift+R / Cmd+Shift+R)
339|   - The new SW will activate on next load
340|
341|2. **Reward records** — New rewards use the reward `type` as the primary key instead of random UUIDs. Existing rewards (from v0.1.x) with UUID keys will still display correctly. New awards will not duplicate existing ones even if the old UUID record exists.
342|
343|3. **Entry tags** — The `entryTags` table schema changed from `id` primary key to `entryId` primary key. Dexie auto-migrates, but if you had duplicate tag records for the same entry (possible in v0.1.x due to a bug), only one will survive the migration.
344|
345|4. **Personality storage** — Personality is now read from IndexedDB instead of localStorage. If you previously set a personality, it was already saved to IndexedDB by Settings. No action needed.
346|
347|5. **Service worker precache** — The PWA now properly precaches all build assets (JS, CSS, fonts). First load after update may re-download all assets. Subsequent loads will be fully offline-capable.
348|
349|**What to check after upgrading (v0.1.x → v0.2.0):**
350|- Streak counter may show different numbers (fixed forgiveness logic — was counting every-other-day indefinitely as a streak)
351|- Dashboard total entries/words should now be accurate (was capped at 20)
352|- Existing drafts will be restored to the journal editor on first load
353|- AI streaming responses should display with proper spacing (was previously corrupted)
354|
355|---
356|
357|### v0.2.1 — PWA Stale Cache Fix
358|
359|**Fixed: App stuck on "Loading Drift…" in normal browser (works in incognito)**
360|
361|The PWA was precaching `index.html` and serving it via Workbox's `NavigationRoute`. After deploying a new build, the old service worker kept serving the stale `index.html` which referenced deleted JS chunk hashes. The app JS failed to load silently, and `getApiKey()` hung forever — leaving users stuck on the loading screen.
362|
363|**Changes:**
364|- **`vite.config.ts`** — Removed `html` from `globPatterns` (no longer precaches `index.html`). Disabled `navigateFallback`. Added `NetworkFirst` runtime caching for all navigation requests. The browser always tries to fetch `index.html` from the network first, falling back to cache only when offline.
365|- **`src/App.tsx`** — Added 5-second timeout + `.catch()` to `getApiKey()` initialization. If the DB init hangs (e.g. corrupted IndexedDB, stale SW), the app auto-clears the service worker and all caches, then proceeds to onboarding. Users are never stuck on the loading screen again.
366|
367|**If you're currently stuck on "Loading Drift…":**
368|1. Open Drift in **incognito mode** (works immediately)
369|2. Go to **Settings** → **Export** to back up your data
370|3. Then either:
371|   - Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) to pick up the new SW
372|   - Or: Chrome → Settings → Site settings → find Drift → Clear & reset (⚠️ wipes IndexedDB — export first!)
373|
374|> ⚠️ **Do NOT "Clear & reset" without exporting first** — this deletes all your journal entries stored in IndexedDB.
375|---
376|
377|<p align="center">
378|  <strong>🌊 Drift — Journal freely. Reflect deeply. Stay private.</strong>
379|</p>
380|