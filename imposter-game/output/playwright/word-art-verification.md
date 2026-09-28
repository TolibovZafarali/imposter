# Word illustration pilot verification

Verified on 2026-09-27 against the 24 pilot assets and the reveal implementation in this workspace.

## Result

The pilot's rendering and interaction checks passed with the scope below. All 24 artworks were visually inspected in actual browser and native Release screenshots. The native offline check used an isolated fixture build that denied HTTP and HTTPS inside the application. This is qualified pilot evidence, not a claim that the final distribution build was tested with the device's networking disabled.

## Browser checks

- Rendered all 24 pilot entries at 390 × 844 and 375 × 667. Every image decoded at 512 × 512, the corresponding word was visible, and no image remained before reveal or after hiding. Artwork measured 200 points on the larger viewport and 121 points on the smaller viewport.
- Confirmed text-only cards at 320 × 568, failed image requests, and missing artwork.
- Delayed image completion during a held reveal did not insert artwork or move the word. A subsequent reveal displayed the decoded image.
- Tested long Latin text, Cyrillic, Arabic, and Japanese with the shared umbrella image. These were layout fixtures, not provider translation reviews.
- Tested pointer and screen-reader-style tap behavior, reduced-motion media, round replacement while held, and the document-visibility callback. The browser background check simulated the visibility event; native application backgrounding was tested separately.

Evidence: `word-art-web-pilot-results.txt` (48 renders), `word-art-web-behavior-results.txt`, `word-art/web-pilot-contact-sheet.png`, and the individual `word-art/web-*.png` screenshots.

## Native Release checks

Used a separate iPhone 17 Pro simulator on iOS 26.5. The existing development simulator and Metro process remained available. Xcode compiled and installed a local Release application with the assets in its application bundle.

- All 24 entries passed a real three-second long press, release, and next-player availability assertion. Screenshots captured during the press show the actual reveal screen, each matching artwork and word, and no rectangular image background.
- A regular → imposter → regular handoff passed. Both regular players received the umbrella image. The imposter displayed only the existing icon, role, and hint on the preserved white card surface.
- Launched Settings while a regular player's card was held, then returned to the game. The card was hidden on resume. The resumed screenshot was captured during the application transition; the settled hidden state is verified by the successful subsequent assertions.
- At the largest accessibility text size tested (`accessibility-extra-extra-large`), the artwork was omitted and the word remained readable.
- Arabic and Japanese layout fixtures passed on the native screen.
- After restoring the application's normal context and native delegate, rebuilt and installed Release, then passed the normal category selection → round → three player handoffs → discussion → results → replay flow. This normal round selected an entry without pilot artwork and confirmed the text-only fallback. The replay also passed. No fixture route or round injection remained in this final application source.

Evidence: `word-art-native-pilot-results.json`, `word-art-native-pilot.log`, `word-art/native-pilot-contact-sheet.png`, `native-privacy-results.json`, `native-background-results.json`, `word-art-native-large-text-results.json`, `word-art-native-arabic-results.json`, `word-art-native-japanese-results.json`, `native-normal-source-results.json`, and the corresponding screenshots/logs.

## Scoped offline evidence

The fixture Release build registered a native URL protocol that rejected every HTTP and HTTPS request with `notConnectedToInternet`. An application-start URL-session probe returned error code `-1009` with no response. All 24 illustrations subsequently displayed from the installed application bundle. This build used a Release JavaScript bundle and did not require Metro.

Evidence: `word-art-release-offline-proof.json` and all 24 `word-art/native-release-*.png` screenshots.

The final normal-source build restored the original native delegate and therefore did not retain this network-denial fixture. Host networking was not disabled. A final distribution-build test with device networking disabled remains a release check.

## Build isolation and limitations

The native project and dependencies were copied to `/tmp/imposter-word-art-release.L5Gf6i`; no native project was generated in the workspace. The copied dependency tree was an independent filesystem clone, not a symlink.

An existing ads-off native build problem required removing the mobile-ads package's code-generation configuration in that temporary dependency copy. Without this workaround, native component registration referenced an unavailable class and crashed at launch. The workspace dependency retained its original configuration. Xcode also required a 15.1 deployment-target override for older pod targets. Both fixture and normal-source Release runs used these local native build adjustments, so neither is an untouched production distribution binary.

No physical device, Android release, spoken VoiceOver session, live translation-provider semantic review, or store distribution was tested. Automated checks exercise image exclusion and existing accessibility gating, but they do not establish spoken screen-reader behavior. The native reduced-motion setting was not separately exercised; browser reduced-motion behavior was.

## Automated implementation checks

The six focused illustration tests passed: responsive sizing, role/round/canonical-ID eligibility, stale decode cancellation, cleanup, missing/decode failure fallback, and stable held-card artwork selection. Frontend type checking, targeted lint, and whitespace-diff checks passed. Broader project test results are recorded separately by the implementation workflow.

## Implementation snapshot

The verified application reveal files had these SHA-256 hashes:

| File | SHA-256 |
| --- | --- |
| `app/reveal.tsx` | `8787d927d6f358b6345f000d0402e48557608d32761c9c716590a7d407fdaf6a` |
| `components/word-illustration-state.ts` | `a16a60838b9ffd455898bd8c878ddd652b6c106290c21c4b962eb2be3c6b39ee` |
| `components/word-illustration.tsx` | `b3dbddc6ea856f24c25b911e2fffd5c9f7dc3501d967955e46dd938377078b4b` |
| `hooks/use-round-illustration.ts` | `080e18be19ea4d8f035c7432574a3e6cf8cefed28a13317358bcf1e2690a5d5d` |
| `data/wordIllustrations.ts` (24-entry pilot) | `5df6cfc400e51201f8a0fd36ca83666cb1a5628889cdc1338b649d280037676a` |
