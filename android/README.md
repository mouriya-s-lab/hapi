# HAPI Android Companion

Native Android client (Kotlin + Jetpack Compose) for the HAPI hub. Fully
independent from the web app; shares only the protocol contract
(`docs/api/`) and the golden fixtures (`shared/fixtures/`).

- **applicationId**: `run.hapi.companion` · **minSdk** 26 · **target/compileSdk** 36
- **Toolchain**: Gradle 8.14.2 (wrapper) · AGP 8.11.1 · Kotlin 2.1.21 · Compose BOM 2025.05.00 · JDK 17+ (CI uses 21)

## Modules

| Module | Type | Responsibility |
|---|---|---|
| `:core:protocol` | **pure Kotlin/JVM** (no Android) | Hub wire types (kotlinx.serialization), chat pipeline port (normalize → reduce → tool groups), message-window/pagination logic, versioned patch application, modes catalog, git output parsers, `BindLink` pairing-link parsing. |
| `:core:data` | Android library | Transport + persistence: `HapiApi` (OkHttp REST, single-flight 401 re-auth), `SseEngine` (okhttp-sse, resume/backoff state machine), StateFlow stores + AtomicFile JSON snapshots, credential store, FCM registration, WorkManager workers. Placeholder in M0 — see `DataModule.kt`. |
| `:app` | Android application | Compose UI, navigation, deep links (`hapicompanion://bind`), FCM service (M4), hand-rolled DI (`AppGraph`, no Hilt). |

Dependency direction: `:app` → `:core:data` → `:core:protocol`.

## Protocol conformance fixtures

`:core:protocol` is the porting target for `web/src/chat/` and is verified
against golden fixtures generated from the web implementation (track K).
The test task already passes the fixtures location as a system property:

```kotlin
// core/protocol/build.gradle.kts
tasks.test {
    systemProperty("hapi.fixtures.dir", rootDir.parentFile.resolve("shared/fixtures").absolutePath)
}
```

Fixture-driven tests (M2) read `System.getProperty("hapi.fixtures.dir")` —
no further build changes are needed when `shared/fixtures/**` lands. CI
re-runs this suite whenever `android/**` or `shared/fixtures/**` change.

## Building

Requires an Android SDK for `:app`/`:core:data` (set `ANDROID_HOME` or
`android/local.properties` with `sdk.dir=...`). `:core:protocol` alone needs
only a JDK.

```sh
cd android
./gradlew :core:protocol:test        # pure JVM protocol tests (fast)
./gradlew :app:assembleDebug         # debug APK
./gradlew :app:installDebug          # install on a connected device
```

Without an Android SDK you can still run the protocol suite by configuring
only the needed projects:

```sh
./gradlew --no-configuration-cache --configure-on-demand :core:protocol:test
```

CI (`.github/workflows/android.yml`) runs the protocol tests and
`:app:assembleDebug` on every PR touching `android/**` or `shared/fixtures/**`.

## Milestones (track B of the native-clients plan)

- **M0** — this scaffold: modules, version catalog, CI, placeholder screen.
- **M1** — foundations: wire types + modes catalog; auth + `HapiApi` (MockWebServer-tested); `SseEngine` reconnect state machine + versioned patches (gzip streaming verified); pairing UI + `hapicompanion://bind` deep link.
- **M2** — read-only chat: chat pipeline port gated on fixtures all-green; session list; `MessageWindowStore` port; Markdown renderer; read-only chat screen (`LazyColumn(reverseLayout = true)`).
- **M3** — interaction: composer (optimistic send/queue/steer/drafts), permission approvals UX, session controls (mode/model/abort/resume/rename/archive), new session, dictation.
- **M4** — FCM push (register → notification actions via expedited WorkManager) + files/git viewer, Scratchlist, usage/storage stats.
- **M5** — polish: zh-CN i18n, OLED/Material You theming, predictive back, LeakCanary pass, Play listing + self-build docs.

## Firebase / push (self-build note)

M0 deliberately does **not** apply the `com.google.gms.google-services`
plugin and has no Firebase dependency, so the project builds without any
`google-services.json`. In M4a the plugin lands together with the FCM
service: official builds inject the default Firebase project config in CI,
while self-builders drop in their own `app/google-services.json` (docs will
accompany M4a; a `PushBinding` seam for hub-provided `FirebaseOptions` is
planned for v1.x).
