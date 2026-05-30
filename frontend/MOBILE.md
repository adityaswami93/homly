# Homly — Mobile App Setup (Capacitor)

The Homly web app is wrapped as a native Android and iOS app using [Capacitor](https://capacitorjs.com). The Next.js frontend is built as a static export (`out/`) and embedded inside each native project. No React Native, no UI rewrites — the same web code runs on every platform.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 22.0.0 | Capacitor CLI requires Node 22+ |
| npm | ≥ 10 | Comes with Node 22 |
| Android Studio | Latest stable | For Android builds |
| Xcode | ≥ 15 | For iOS builds — macOS only |
| CocoaPods / Swift Package Manager | — | iOS deps handled via SPM automatically |
| Java (JDK) | ≥ 17 | Required by Android Gradle |

> **nvm users:** run `nvm use 22` before any `npx cap` commands.

---

## Environment variables

Create `frontend/.env.local` (copy from `frontend/.env.example` and fill in):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
```

These values are baked into the static build at compile time. The app talks to the hosted FastAPI backend over HTTPS — nothing runs locally on-device.

---

## First-time setup

Run these once after cloning, from inside `frontend/`:

```bash
cd frontend
npm install
npx cap sync
```

`cap sync` copies the compiled web assets into both native projects and installs Capacitor plugins. Run it again any time you change plugin config in `capacitor.config.ts`.

---

## Build → sync → run (daily workflow)

Every time you change frontend code:

```bash
cd frontend

# 1. Build the static export
npm run build          # produces out/

# 2. Push web assets into native projects
npx cap sync

# 3. Open in IDE and run on device / emulator
npx cap open android   # opens Android Studio
npx cap open ios       # opens Xcode
```

> You must run `npm run build` before `cap sync` — Capacitor copies whatever is in `out/`. Skipping the build means your native app runs stale code.

---

## Android

### Requirements
- Android Studio (Hedgehog or newer)
- Android SDK — `compileSdkVersion 36`, `minSdkVersion 24` (Android 7.0+)
- A device or emulator running API level 24+

### Steps
1. `npm run build && npx cap sync`
2. `npx cap open android`
3. In Android Studio: wait for Gradle sync to finish
4. Select a device/emulator → click **Run ▶**

### Permissions granted
The app declares these in `android/app/src/main/AndroidManifest.xml`:
- `INTERNET`
- `CAMERA`
- `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`
- `POST_NOTIFICATIONS`

Runtime permission prompts (camera, notifications) appear the first time the relevant feature is used.

### Signed release APK
Keystore setup and signing config are not included in this repo. Configure `android/app/build.gradle` with your keystore before submitting to the Play Store. See the [Android signing docs](https://developer.android.com/studio/publish/app-signing).

---

## iOS

### Requirements
- macOS with Xcode 15+
- iOS 15.0+ device or simulator
- Apple Developer account (for device builds and TestFlight)

### Steps
1. `npm run build && npx cap sync`
2. `npx cap open ios`
3. In Xcode: select your team under **Signing & Capabilities**
4. Select a simulator or connected device → click **Run ▶**

### Permissions declared
The app declares these in `ios/App/App/Info.plist`:
- `NSCameraUsageDescription` — receipt capture
- `NSPhotoLibraryUsageDescription` — attach photos from library
- `NSPhotoLibraryAddUsageDescription` — save receipt photos

### Provisioning profiles
Provisioning profiles and entitlements are not included. Set up your bundle ID (`com.homly.app`) and signing certificate in Xcode before building for a real device or submitting to the App Store.

---

## Capacitor config

`frontend/capacitor.config.ts` controls native behaviour:

```ts
{
  appId: 'com.homly.app',
  appName: 'Homly',
  webDir: 'out',               // static export directory
  server: {
    androidScheme: 'https',    // prevents mixed-content issues
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#111827',
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#111827',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}
```

After editing this file, run `npx cap sync` to apply changes to both native projects.

---

## Platform detection

Use the helpers in `frontend/lib/platform.ts` whenever you need to branch native vs. web behaviour:

```ts
import { isNativeApp, isAndroid, isIOS } from '@/lib/platform';

if (isNativeApp()) {
  // native-only code (camera, push, etc.)
} else {
  // web fallback
}
```

Never inline `Capacitor.isNativePlatform()` directly — always import from `lib/platform.ts`.

---

## Native features

| Feature | Web | Native |
|---------|-----|--------|
| Receipt capture | File `<input>` on expenses page | Device camera via `@capacitor/camera` |
| Push notifications | Not supported | Registers on first app open; token logged to console |
| Status bar | n/a | Dark style, `#111827` background |
| Splash screen | n/a | 1.5s dark screen, then hidden |
| Safe area insets | CSS env() vars | Same — Capacitor exposes them to the web layer |

### Push notification token
The FCM/APNs token is currently logged to the console only. Persisting it to the backend for server-side delivery is tracked separately (Issue 013).

---

## Adding a new Next.js API route

**Do not add files under `frontend/app/api/`.** Static export cannot serve them at runtime.

Add the endpoint to FastAPI instead:

1. Create or edit a router in `backend/api/routers/`
2. Register it in `backend/api/main.py`
3. If the route is public (no auth), add the path to `SKIP_AUTH_PATHS` in `backend/api/middleware/auth.py`
4. Call it from the frontend as `${process.env.NEXT_PUBLIC_API_URL}/your-endpoint`

---

## Troubleshooting

**`Capacitor CLI requires NodeJS >=22.0.0`**
Switch to Node 22: `nvm use 22`

**`lightningcss native binary not found` during build**
Run `npm install lightningcss --force` inside `frontend/`, then rebuild.

**`already used by worktree` in Sourcetree / git**
Claude Code creates a git worktree for this branch. The message is harmless — ignore it in Sourcetree. It clears automatically when the session ends, or manually with:
```bash
git worktree remove /Users/adityaswami/homly/.claude/worktrees/<branch-name> --force
```

**Gradle sync fails in Android Studio**
Open Android Studio, let it finish downloading SDK components, then sync manually via **File → Sync Project with Gradle Files**.

**Xcode signing error**
Go to **Signing & Capabilities**, select your team, and let Xcode auto-manage provisioning.

**Changes not reflecting on device after code edit**
Run `npm run build && npx cap sync`, then rebuild in the IDE. Capacitor does not hot-reload from the IDE.
