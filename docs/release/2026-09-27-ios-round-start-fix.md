# iOS 1.0.2 build 6 round-start fix

- Source: `154dd2a06522310742eeec3a98ff03c8059c7656`.
- App version: `1.0.2`, iOS build `6`.
- Production build: `7c9a8705-0909-414b-a1b1-706cdce3f88f` (finished).
- App Store upload: `8e68f085-4e34-48dc-8e6f-b9c9959d122d` (finished).
- Apple build: `fcc21058-036b-41f4-9162-f53dcc529191` (processed).
- TestFlight: `1.0.2 (6)` is Testing in the existing `Team (Expo)` internal group.
- App Review: `bf17017a-b492-480c-92bf-0307d66f8189`, Waiting for Review, submitted September 27, 2026 at 7:15 PM CDT.
- Signed archive SHA-256: `cc2f3ef037fd61ea3c8cf802be96bc706b3245c3d2323c0993b077a754d92195`.
- Supersedes build 5. Its review submission `02e2b40a-95d7-428c-8b1e-d02a6b016021` was canceled and Apple shows it as Removed.
- Public release remains manual, pending a physical iPhone test.

## Reproduction and cause

The native Release build from the build 5 source launches successfully but closes immediately when Movies is selected and Start Game is pressed. The captured log reports `Unhandled JS Exception: Invariant Violation: new NativeEventEmitter() requires a non-null argument.` A new crash report confirms termination with `SIGABRT`.

`services/appAttest.ts` dynamically imported the entire `react-native` namespace just to read `Platform.OS`. Metro's namespace loader enumerates exports, evaluating the lazy `PushNotificationIOS` getter. That module constructs a native event emitter without a linked notification manager and triggers fatal error reporting. Both generated rounds and translated static rounds enter this preparation path before their endpoint request. Offline English static rounds do not.

The loader now uses Expo's compile-time platform value, avoiding the namespace import while keeping App Attest enabled on supported iOS devices. The earlier native advertising registration fix is retained. No gameplay or backend code changes are included.

## Verification

- 73 app tests pass; TypeScript, lint, and `git diff --check` pass.
- New runtime tests execute the default integrity loader through the installed Expo Babel preset and Metro namespace loader, with an unavailable lazy native export. The old code reproduces the failure; the correction passes for iOS, Android, and web while retaining the platform support guard and attestation functions.
- Native Release compilation succeeds. The simulator app identifies itself as `1.0.2 (6)` and uses bundled JavaScript without a development server.
- On the corrected native app, Movies in English reaches player reveal after a production endpoint HTTP 200 response (about 4.5 seconds).
- After termination and relaunch, Food in Spanish also reaches player reveal after HTTP 200 (about 3.5 seconds).
- Neither corrected process logs a fatal JavaScript exception. These checks cover the request preparation and response paths; they do not establish physical-device App Attest enrollment.
- The signed production archive is `com.cnfstudios.imposter`, version `1.0.2`, build `6`, includes its JavaScript bundle, and contains none of the three excluded advertising view class names.

## Backend compatibility

Extended `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS` from `3,4,5` to `3,4,5,6` on project `wqryrqffcldnpubcgtyh`. Both the previous and resulting values were verified by digest. Existing build support and observe-mode attestation policy are preserved. No backend code or migrations were deployed.

## Physical-device release gate

Install build 6 through TestFlight. Select Movies or Celebrities and start a round, then test a non-English round, and close and reopen the app. Release publicly only after the affected iPhone completes these checks. Unrelated local artwork and backend changes remain outside this release.
