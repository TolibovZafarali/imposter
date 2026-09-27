# iOS 1.0.2 launch fix

- Source: `a88d96c3504820cd3f44bbfafde38a53ef9b97e2`.
- App version: `1.0.2`, iOS build `5`.
- Production build: `56da8dd9-cfe9-44a7-9478-ac0595962178` (finished).
- App Store upload: `370ced78-d55d-4506-87aa-075f755f0009` (finished).
- Apple build: `ed59300d-faa6-4a0e-8923-e70c5622647b` (processed).
- App Review submission: `02e2b40a-95d7-428c-8b1e-d02a6b016021`, submitted September 27, 2026 at 23:08 UTC; status **Waiting for Review**.
- App Store release setting: **manual**. Hold public release until the physical iPhone test succeeds.
- TestFlight: build `1.0.2 (5)` is **Testing** in the existing `Team (Expo)` internal group.
- What's New: use [the reusable note](whats-new.txt).
- Signed archive SHA-256: `8dbc738d3a3648fda6b0ba66195ebf34f92a4995ffd4a709c02de7f2e8e9b31d`.

## Cause and correction

The ads-off Podfile excluded the advertising SDK from native linking, but standalone React Native code generation could rediscover it when no cached autolinking output was available. The generated third-party component provider then resolved three advertising view classes that were absent from the executable. Inserting those missing classes into its dictionary caused a native exception during startup, before the app could render.

Two local iOS crash reports show the exception in `RCTThirdPartyComponentsProvider`. The exact signed `1.0.1 (4)` archive contains all three view names without their Objective-C classes or advertising frameworks. The user's physical-device report was not retrieved, so device confirmation remains required.

The root `react-native.config.js` now excludes the package from iOS code generation when ads are off. The existing Podfile exclusion remains in place. Test and live ads modes retain the iOS package. No gameplay or backend code changes are included.

## Verification

- 70 app tests pass, including real native-code-generation regressions for ads off, test, and live with no cached autolinking output. The off regression failed before the correction.
- TypeScript, lint, and `git diff --check` pass.
- Fresh iOS prebuild and pod installation omit the advertising SDK and consent framework.
- A local native Release build launches, completes onboarding, survives termination and relaunch, and reaches the first player reveal. This check uses the bundled application, without a development server.
- The local Xcode 27 simulator build required a command-line deployment-target override of 15.1 for older pod targets; this did not alter project configuration.
- The signed production archive is `com.cnfstudios.imposter`, version `1.0.2`, build `5`, includes its JavaScript bundle, retains the new architecture, and contains none of the three excluded advertising view names or advertising frameworks.
- Apple processed the archive; the existing internal TestFlight group shows it as Testing, and the App Store review record shows Waiting for Review.

## Backend compatibility

Updated `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS` on project `wqryrqffcldnpubcgtyh` from `3,4` to `3,4,5`, verifying the resulting secret digest. Existing build support and observe-mode policy are preserved. No backend code or migrations were deployed for this fix.

## Release gate

Install `1.0.2 (5)` through TestFlight on the affected iPhone, open it, start a round, reveal a role, then close and reopen it. Public release remains manual until this succeeds. The simulator check and archive inspection do not establish physical-device launch or production App Attest enrollment.

The unrelated local artwork and backend changes were excluded from this release.
