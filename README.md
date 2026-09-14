# Drift for Android

Drift is a native, local-first Android 16+ app for ADHD-friendly journaling and task support. It replaces the prior PWA rather than wrapping it: the UI is built with Jetpack Compose, data is stored in Room, reminders use Android alarms and notifications, and background sync uses WorkManager.

## What is included

- A journal editor with a 450 ms local draft save, a final background flush, topic suggestions, revision-safe insights, and deliberately low-key rewards.
- Saved entries, optional mood tracking, editing and deletion, gentle streak/word/mood insights, and a rolling context that only updates when requested.
- Daily routines by time of day, weekly targets, one-off tasks, persistent to-dos, and routine ordering. Daily and ISO-weekly instances materialize locally and roll over deterministically.
- Native reminder scheduling that survives app restarts and device reboot. Reminders gracefully fall back when exact alarms are unavailable.
- Password-encrypted export and restore archives with AES-256-GCM, plus validation before any existing data is replaced.
- Optional OpenRouter reflections, structured entry insights, weekly summaries, and a coach with brain-dump, morning, evening, and open-conversation modes. Cloud pattern finding after save is opt-in; local saving never waits for it.
- Optional Gemini Nano reflections through Google ML Kit when the phone's AICore service supports them. Journal text stays on-device for this feature.
- Optional WebDAV sync to a single `drift-v2.json` file, with ETag protection and last-write-wins tombstones to prevent deleted records from being resurrected.
- Android Keystore encryption for the local AI and WebDAV credentials.

There is deliberately no migration path from the old PWA/IndexedDB data. This is a clean native rebuild, as requested.

## Run it

1. Install Android Studio (current stable) with Android SDK Platform 36 and a JDK 17 runtime.
2. Clone the repository and open it as a Gradle project.
3. Choose an Android 16+ emulator or device and press Run.

From a shell with `ANDROID_SDK_ROOT` configured:

```bash
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
```

The debug APK is written to `app/build/outputs/apk/debug/`.

## Privacy model

Journal and task data stay in the app's local Room database by default. Drift has no account system, analytics SDK, or background AI job.

- An AI request sends the text needed for that request to OpenRouter and the selected model provider. Drift asks OpenRouter to disable provider data collection. Automatic cloud insights are off until you enable them in Settings.
- Gemini Nano reflections are foreground-only and stay on the device. Availability varies by phone and AICore installation.
- WebDAV runs only after you enable it. Its credentials are encrypted locally, but the remote JSON is not end-to-end encrypted; use HTTPS and a private server or folder you control.
- Backup archives use a password you choose and include no AI key or WebDAV password.
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
| AI | OpenRouter streaming plus optional ML Kit Gemini Nano reflections |

## Notes for contributors

The app targets and requires API 36 (Android 16). Keep the local-first rule intact: every write must complete in Room before optional network work begins. The tests cover ISO week keys, gentle streaks, and sync conflict/tombstone behavior; add coverage whenever touching rollover or merge logic.

## License

MIT
