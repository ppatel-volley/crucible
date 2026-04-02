# Proto-Hub Android APK Research

Research into wrapping the Proto-Hub (Foundry) web app as an Android APK for Fire TV deployment.

**Date:** 2026-03-31

---

## 1. How the Existing Hub Deploys to Fire TV

The existing Hub does **not** ship as an APK. It is a purely web-based deployment:

- **Build:** Vite builds the React SPA into static files (`apps/client/dist`).
- **Deploy:** Static files are synced to S3 (`s3://volley-game-clients-{env}/hub/`), fronted by CloudFront.
- **Runtime config:** A `config.js` file is generated per-environment at deploy time and injected into the S3 bucket. This provides runtime variables (backend endpoint, analytics keys, Datadog tokens) without rebuilding the app.
- **Fire TV access:** The Volley Platform SDK (native Fire TV app) opens the Hub URL in a WebView. The SDK detects the platform via user agent (`Android` + `AFT[A-Z]+` pattern) and provides native bridge APIs (device info, session management, game launching, splash screen).

There are **no** Android project files, Capacitor configs, Cordova configs, or TWA configurations in either the Hub or ProtoHub repos. The only Android-related dependency is `@capacitor/splash-screen`, which is used purely as a JavaScript API -- the splash screen is controlled by the Platform SDK's native layer, not a Capacitor Android project.

**Key insight:** Fire TV games at Volley run inside the Platform SDK's native WebView shell. The SDK app is already installed on Fire TV devices and acts as the native Android container. Individual games (including Hub) are web apps loaded by URL.

---

## 2. Options for Wrapping a Web App as an Android APK

### Option A: Trusted Web Activity (TWA)

A TWA runs a Progressive Web App (PWA) fullscreen in Chrome Custom Tabs, effectively getting Chrome's rendering engine without any visible browser chrome.

| Aspect | Detail |
|--------|--------|
| **How it works** | Android app contains an intent that launches a Chrome Custom Tab pointing at the PWA's URL. Digital Asset Links (`.well-known/assetlinks.json`) verify ownership. |
| **Requirements** | Web Manifest (`manifest.json`), HTTPS, service worker (at minimum a no-op one), Digital Asset Links file on the web server, Chrome 72+ on device. |
| **Build tool** | [Bubblewrap](https://github.com/nicedayfor/nicedayfor.github.io) (Google's CLI) or [PWABuilder](https://www.pwabuilder.com/) generate the Android project from a manifest URL. |
| **Complexity** | Low -- minimal native code, mostly configuration. |
| **Fire TV issue** | **Fire TV does not ship Chrome.** Fire TV uses Amazon's Silk browser, which is Chromium-based but does NOT support Custom Tabs. TWAs fundamentally require Chrome (or a browser implementing the Custom Tabs protocol). This approach **will not work on Fire TV.** |

### Option B: Capacitor (Ionic)

Capacitor wraps a web app inside an Android WebView with a thin native shell. Vite builds the web app, then `npx cap sync` copies the built files into an Android project.

| Aspect | Detail |
|--------|--------|
| **How it works** | Creates an Android project with a `WebView` that loads the bundled web app from local files. Capacitor plugins provide native API bridges (camera, filesystem, etc). |
| **Requirements** | Android Studio, JDK 17+, Gradle, `capacitor.config.ts` in the project. |
| **Build tool** | `npx cap init`, `npx cap add android`, `npx cap sync`, then build the APK via Gradle or Android Studio. |
| **Complexity** | Medium -- adds an `android/` directory to the project, requires Android toolchain. |
| **Fire TV compatibility** | Good -- uses the system WebView, which on Fire TV is Amazon's WebView (Chromium-based). The `@capacitor/splash-screen` dependency is already in the project. |
| **Pros** | Well-maintained ecosystem, good Vite integration, simple plugin system, official support for Android. |
| **Cons** | Adds ~15 MB to APK size for the Capacitor runtime. Requires maintaining an Android project alongside the web project. |

### Option C: Cordova

Older predecessor to Capacitor. Similar concept (WebView wrapper) but with an XML-based config and a more complex plugin system.

| Aspect | Detail |
|--------|--------|
| **Complexity** | Medium-high -- similar to Capacitor but older tooling, more configuration. |
| **Fire TV compatibility** | Works, but Cordova is in maintenance mode. |
| **Verdict** | **Not recommended.** Capacitor is the successor with better tooling and active development. No reason to choose Cordova for a new project. |

### Option D: Minimal Android WebView App

A hand-written Android project with a single `Activity` containing a `WebView` that loads either local files or a remote URL.

| Aspect | Detail |
|--------|--------|
| **How it works** | ~50 lines of Kotlin/Java: create a `WebView`, enable JavaScript, load the app. |
| **Requirements** | Android Studio, JDK, Gradle. |
| **Complexity** | Low if loading a remote URL, medium if bundling local assets (need to handle asset copying, cache management). |
| **Fire TV compatibility** | Excellent -- direct use of the system WebView, no third-party runtime overhead. |
| **Pros** | Minimal APK size (~2 MB), full control, no dependencies. |
| **Cons** | No plugin ecosystem, manual handling of anything native (permissions, lifecycle, back button). |

### Option E: React Native WebView

Wrapping the entire app in a React Native shell with a `<WebView>` component.

| Aspect | Detail |
|--------|--------|
| **Verdict** | **Massive overkill.** React Native adds ~20+ MB of runtime for a single WebView. No benefit over Capacitor or a raw WebView. |

---

## 3. Fire TV Specific Considerations

### Fire OS and WebView

- Fire OS is a fork of Android (currently based on Android 9-11 depending on device generation).
- Fire TV devices use **Amazon WebView**, which is Chromium-based but lags behind Chrome by 1-2 major versions.
- The Hub's Vite config already targets `chrome >= 68` with `@vitejs/plugin-legacy` providing polyfills. This covers all Fire TV WebView versions.
- Fire TV Stick (3rd gen) has 1 GB RAM; Fire TV Stick 4K has 1.5 GB. Memory is constrained -- the Hub already has mitigations for this (Jeopardy reload mechanism, memory limits via `getTvMemoryLimits.ts`).

### Input Model

- Fire TV uses a directional remote: D-pad (up/down/left/right), Select, Back, Home, Menu.
- Proto-Hub already uses `@noriginmedia/norigin-spatial-navigation` for D-pad navigation. This handles focus management via keyboard events (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`).
- The Platform SDK provides `useKeyDown` for additional key handling.
- No touch input on standard Fire TV. Some Fire TV Cube models support limited touch on the remote, but apps must work without it.

### Amazon Appstore Distribution

- APKs are submitted via the [Amazon Developer Console](https://developer.amazon.com/apps-and-games).
- Amazon requires APK signing with a keystore.
- Fire TV apps need a `android.intent.category.LEANBACK_LAUNCHER` intent filter and a banner image (320x180 px) for the Fire TV home screen.
- Apps must declare `android.hardware.touchscreen` as `android:required="false"` since Fire TV has no touchscreen.
- Amazon has a review process (typically 1-3 days).

### How Does Proto-Hub Currently Run on Fire TV?

It would run the **same way as Hub**: the Volley Platform SDK (already installed on Fire TV devices) opens the Proto-Hub URL in its WebView. No APK is needed for this path.

The question of building an APK only arises if Proto-Hub needs to run **independently of the Platform SDK** -- e.g., as a standalone Fire TV app distributed through the Amazon Appstore without requiring the Volley Platform SDK app to be installed.

---

## 4. Recommendation

### If Proto-Hub Will Run Inside the Platform SDK (Like Hub Does Today)

**No APK needed.** Deploy the Vite build to S3/CloudFront and have the Platform SDK load it by URL. This is the simplest path and matches the existing Hub architecture.

### If Proto-Hub Needs a Standalone Fire TV APK

**Use Capacitor.** Here is why:

1. **Already partially set up** -- `@capacitor/splash-screen` is already a dependency in Proto-Hub. The project was clearly started with Capacitor in mind.
2. **Vite integration is excellent** -- Capacitor's `webDir` config points directly at the Vite build output.
3. **Handles the WebView boilerplate** -- back button handling, lifecycle management, JavaScript bridge, splash screen, status bar hiding.
4. **Plugin ecosystem** -- if native capabilities are needed later (deep linking, push notifications, storage), Capacitor plugins exist.
5. **Lighter than React Native** -- Capacitor adds ~15 MB vs. ~25+ MB for React Native, and there is no JavaScript runtime overhead since the app is already a web app.
6. **Well-documented Fire TV support** -- Capacitor's Android output is a standard Android project that works on Fire TV without modification beyond the manifest tweaks listed above.

**TWA is ruled out** because Fire TV does not have Chrome.

**A raw WebView app** is viable if the goal is absolute minimal APK size and no native plugins are ever needed. But the savings (~13 MB) are not worth losing Capacitor's plugin system and lifecycle management.

---

## 5. Concrete Build Steps: Capacitor APK for Fire TV

### Prerequisites

- Android Studio (latest stable, currently Ladybug)
- JDK 17+
- Android SDK with API level 30+ (Fire OS targets)
- Node.js 22+, pnpm

### Step 1: Install Capacitor Core

```bash
cd C:\volley\dev\ProtoHub\apps\client
pnpm add @capacitor/core @capacitor/cli
```

### Step 2: Initialise Capacitor

```bash
npx cap init "Proto-Hub" "com.volley.protohub" --web-dir dist
```

This creates `capacitor.config.ts` in `apps/client/`. Edit it:

```typescript
import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
    appId: "com.volley.protohub",
    appName: "Proto-Hub",
    webDir: "dist",
    server: {
        // For development: load from dev server instead of local files
        // url: "http://YOUR_DEV_IP:5173",
        // cleartext: true,
    },
    android: {
        // Use the system WebView (Amazon WebView on Fire TV)
        webContentsDebuggingEnabled: true, // Remove for production
    },
    plugins: {
        SplashScreen: {
            launchAutoHide: true,
            launchShowDuration: 2000,
            backgroundColor: "#000000",
        },
    },
}

export default config
```

### Step 3: Add the Android Platform

```bash
npx cap add android
```

This creates an `android/` directory with a full Gradle-based Android project.

### Step 4: Fire TV Manifest Tweaks

Edit `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Add to the <manifest> level: declare touchscreen not required -->
<uses-feature android:name="android.hardware.touchscreen" android:required="false" />

<!-- Add to the <activity> that has the MAIN intent filter: -->
<intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
</intent-filter>
```

Add a Fire TV banner image at `android/app/src/main/res/drawable-xhdpi/banner.png` (320x180 px), and reference it in the `<application>` tag:

```xml
<application android:banner="@drawable/banner" ...>
```

### Step 5: Build the Web App and Sync

```bash
# Build the Vite app
pnpm build

# Copy the build output into the Android project
npx cap sync android
```

### Step 6: Build the APK

Option A -- via Gradle CLI:

```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

Option B -- via Android Studio:

1. Open the `android/` directory in Android Studio.
2. Build > Build Bundle(s) / APK(s) > Build APK(s).

For a signed release APK:

```bash
cd android
./gradlew assembleRelease
```

This requires a signing config in `android/app/build.gradle` with a keystore. See [Android signing docs](https://developer.android.com/studio/publish/app-signing).

### Step 7: Test on Fire TV

```bash
# Connect to Fire TV via ADB (enable Developer Options on Fire TV first)
adb connect <fire-tv-ip>:5555

# Install the APK
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Launch it
adb shell am start -n com.volley.protohub/.MainActivity
```

### Step 8: Remote Debugging

```bash
# With ADB connected and the app running:
chrome://inspect
# Or via Android Studio's Logcat
```

### Step 9: Submit to Amazon Appstore

1. Go to [Amazon Developer Console](https://developer.amazon.com/apps-and-games).
2. Create a new app listing.
3. Upload the signed release APK.
4. Fill in the Fire TV-specific metadata (banner, screenshots, description).
5. Submit for review.

---

## 6. CI/CD Considerations

If automated APK builds are needed, add a GitHub Actions workflow:

```yaml
name: Build Android APK
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [dev, staging, production]

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: cd apps/client && pnpm build
      - run: cd apps/client && npx cap sync android
      - run: cd apps/client/android && ./gradlew assembleRelease
      - uses: actions/upload-artifact@v4
        with:
          name: protohub-${{ inputs.environment }}.apk
          path: apps/client/android/app/build/outputs/apk/release/app-release.apk
```

The keystore and signing credentials would be stored as GitHub secrets.

---

## 7. Open Questions

1. **Is a standalone APK actually needed?** If Proto-Hub will run inside the existing Volley Platform SDK WebView (like Hub does today), no APK is required. The web deployment to S3/CloudFront is sufficient.

2. **Platform SDK dependency** -- Proto-Hub uses `@volley/platform-sdk` for device info, session management, and game launching. If running as a standalone APK (outside the Platform SDK WebView), these APIs will not be available. The app would need fallback behaviour or a mock Platform SDK layer.

3. **Environment config** -- Hub uses a runtime `config.js` pattern for per-environment configuration. If bundling as a local APK, this config either needs to be baked in at build time (one APK per environment) or fetched from a remote endpoint at startup.

4. **WebView version** -- Fire TV's Amazon WebView is Chromium-based but the exact version varies by device. The `@vitejs/plugin-legacy` config targeting `chrome >= 68` should cover all devices, but testing on actual hardware is essential.

5. **Memory constraints** -- Fire TV Stick has 1 GB RAM. The Hub already has memory management mitigations. Proto-Hub should inherit these patterns.
