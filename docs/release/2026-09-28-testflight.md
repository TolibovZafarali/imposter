# iOS 1.0.3 build 7 TestFlight release

- App version: `1.0.3`, iOS build `7`, bundle `com.cnfstudios.imposter`.
- Production build: `52b95457-5629-4f32-8ab9-c621dc6a5ee2` (finished).
- Apple upload: `15360de9-5acc-49a4-97ad-27680d0baead` (finished).
- Apple build: `25e85ec3-7bc1-43f4-b6e8-d48a3c17ffa3` (processed).
- TestFlight: `1.0.3 (7)` is **Testing** in the existing `Team (Expo)` internal group with its existing tester. Testing notes are saved.
- Scope: internal TestFlight distribution to the existing `Team (Expo)` group.
- Confirmation: [TestFlight group](https://appstoreconnect.apple.com/teams/2fdb50d2-59ff-4d86-980f-08d9c1879108/apps/6771144493/testflight/groups/d0cfffab-f294-4464-9c94-a18c7b4d6774/builds), [screenshot](2026-09-28-testflight.png).
- Signed archive SHA-256: `cea06b746a18ed7e986f07092222a8d5dde9f5979a4c7e3333a73372bd65f1e5`.

## Included changes

The uploaded source includes the current working tree on top of `bb5ddcd`, including uncommitted app changes and new assets. The inspected upload snapshot contains 424 files; its path-and-content manifest SHA-256 is `d9be8a7b63e4ea0003d9a2edd6dd8602ace5097b462dc779faa6f479be96decf`.

- Ten animal avatars with varied expressions, randomly assigned on each fresh app launch. Tapping an avatar during setup changes it while keeping player avatars unique.
- Custom language flags, revised player setup controls, and removal of the avatar and edit-button background boxes.
- Per-player languages, mixed-language rounds, and the interactive first-launch tutorial.
- Existing native launch and round-preparation fixes.

## Verification

- 89 app tests, TypeScript, lint, and whitespace checks pass.
- Backend type checking, 50 tests, lint, and formatting checks pass.
- The signed archive identifies itself as `1.0.3 (7)` and includes the JavaScript bundle.
- All 10 avatar images and all 91 flag images are present in the archive with exact source-file hashes.
- Deep, strict signature verification passes. App Attest uses the production environment, and debugging entitlement is disabled.
- The archive contains none of the three previously excluded advertising view class names and no advertising frameworks.
- Native development checks verified avatar changes, unique assignments, full-roster swaps, and a new assignment after relaunch. Physical iPhone testing of the signed build remains the purpose of this TestFlight release.

## Backend compatibility

The deployed round endpoint still used the older single-language request contract. Deployed the current `generate-round` function to project `wqryrqffcldnpubcgtyh`; version `7` is active, and all 18 downloaded source files match the repository. The update accepts the optional additional player languages while retaining the older request path.

Extended the allowed App Attest bundle versions from `3,4,5,6` to `3,4,5,6,7`, verifying the previous and updated values by digest. Existing authentication policy and support for older builds remain in place. No database migration was required.

Cost-free endpoint checks returned the expected OPTIONS `204`, GET `405`, and invalid-request POST `400`. No new paid generation request was performed during this release.

## iPhone checks

Install `1.0.3 (7)` from TestFlight. Tap player avatars, close and relaunch the app to check the new shuffle, and try different player languages within one round. Also start a generated round, test a non-English round, and replay the tutorial from Settings.

This release does not submit the new build for public App Review or release it on the App Store.
