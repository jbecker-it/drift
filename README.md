# Drift for Android

Drift is now a native, local-first Android app for ADHD-friendly journaling and task support. It replaces the prior PWA rather than wrapping it: the UI is built with Jetpack Compose, data is stored in Room, reminders use Android alarms and notifications, and background sync uses WorkManager.

## What is included

- A journal editor with a 450 ms local draft save and a final flush when the app backgrounds.
- Saved entries, optional mood tracking, recent-entry editing, and streak/word/mood insights.
- Daily routines by time of day, weekly targets, one-off tasks, and persistent to-dos. Daily and ISO-weekly instances materialize locally and roll over deterministically.
- Native reminder scheduling that survives app restarts and device reboot. Reminders gracefully fall back when exact alarms are unavailable.
- Optional OpenRouter reflections, coach chat, and weekly summaries. AI is always manually requested; local saving never waits for it.
- Optional WebDAV sync to a single `drift-v2.json` file, with ETag protection and last-write-wins tombstones to prevent deleted records from being resurrected.
- Android Keystore encryption for the local AI and WebDAV credentials.

There is deliberately no migration path from the old PWA/IndexedDB data. This is a clean native rebuild, as requested.

## Run it

1. Install Android Studio (current stable) with Android SDK Platform 35 and a JDK 17 runtime.
2. Clone the repository and open it as a Gradle project.
3. Choose an Android 8.0+ emulator or device and press Run.

From a shell with `ANDROID_SDK_ROOT` configured:

```bash
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
```

The debug APK is written to `app/build/outputs/apk/debug/`.

## Privacy model

Journal and task data stay in the app's local Room database by default. Drift has no account system, analytics SDK, or background AI job.

- An AI request sends the text needed for that request to OpenRouter and the selected model provider. Drift asks OpenRouter to disable provider data collection.
- WebDAV runs only after you enable it. Its credentials are encrypted locally, but the remote JSON is not end-to-end encrypted; use HTTPS and a private server or folder you control.
- Android notification permission is requested only when you choose to enable reminders.

## Architecture

| Concern | Native implementation |
| --- | --- |
| UI | Kotlin + Jetpack Compose + Navigation Compose |
| Local data | Room / SQLite |
| Secure settings | Android Keystore AES-GCM |
| Reminders | AlarmManager + BroadcastReceiver + notification channels |
| Background work | WorkManager with network constraints and retry |
| Sync | WebDAV GET/PUT with ETags and tombstones |
| AI | Direct OkHttp OpenRouter streaming requests |

## Notes for contributors

The app targets API 35 and has a minimum SDK of 26. Keep the local-first rule intact: every write must complete in Room before optional network work begins. The tests cover ISO week keys and sync conflict/tombstone behavior; add coverage whenever touching rollover or merge logic.

## License

MIT
