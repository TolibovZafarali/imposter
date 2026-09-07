# Imposter second development pass

Assessment and implementation record, September 7, 2026. Local source and runtime evidence; no production deployment, commit, or push.

## Product assessment

The weakest part of the original journey was its ending. Setup and private roles led to a timer with a Back to Setup button and copy referring to a voting phase that did not exist. There was no group result reveal, real completion event, or direct replay. This undermined both repeat play and sensible placement of reviews or ads.

The existing bright burgundy identity, one-phone format, spoken clues/voting, random assignment, one/two imposter settings, and server protections are worth preserving. The implementation now closes that loop with a group-confirmed result and replay, without introducing accounts, online multiplayer, scores, or secret on-device voting.

Repository inventory:

- Expo 54, React Native 0.81.5, React 19.1, Expo Router, strict TypeScript, Context/useReducer, AsyncStorage.
- Five screens: setup, settings, word-language selection, private reveal, and discussion. Results now live in the discussion screen.
- Existing Reanimated, native Animated and haptics are reused. No animation or UI framework added.
- Bright background, burgundy accent, Plus Jakarta Sans, token-based spacing/cards. Old dark-theme/template descriptions in the repository guidance are stale.
- 2,985 static English entries: activities 613, food 391, animals 380, objects 562, places 564, sports 475. Movies and celebrities use server generation.
- 133 selectable word languages. The interface remains English; this is not 133 fully localized interfaces. Generated content quality across these languages is not established by the catalog count.
- Language persists on device; setup and current rounds remain in memory. Recent-word exclusion is bounded and lasts for the process. This pass adds only persistent completion/ad/review counters.
- Server generation uses canonical payloads, idempotency, quotas, bounded execution, and App Attest. No backend code or hosted settings changed.
- Existing icon/logo assets, legal/support website, wireframes, bundle identifier and EAS project. No maintained App Store screenshot set or localized metadata catalog was found. Store analytics and current store screenshots were not available in the checkout.

## Implemented changes

- Explicit round completion after the group confirms its spoken vote; reveal all imposters and the secret word together.
- One-tap replay with the same group/settings and a newly generated round. Random mode draws a new category; selected-category mode keeps the selected pool.
- A native-driven 320 ms perspective flip, content retained until the reverse animation finishes, input locks during handoff, and completion only after a successful reveal. App backgrounding hides the card; screen readers have a tap-to-reveal/tap-to-hide action with private content omitted while hidden.
- Recorded discussion start time and a wall-clock deadline; backgrounding does not stretch the timer. Expiry invites voting instead of automatically exposing roles.
- Fixed setup action, clearer loading/errors, failure-safe replay, meaningful vote instructions, minimum button touch height, safe-area bottom spacing, reduced-motion transitions and shorter splash dwell. Font-load failure no longer leaves a permanent splash.
- Automatic native review request after four completions and three days, delayed while results are visible, at most once per version, 120 days between attempts, and at most three attempts per rolling year. No sentiment filtering or rewards. Manual Rate app opens the store review link; sharing includes the store link.
- iOS-only AdMob integration with persistent conservative limits, consent checks, optional future purchase suppression, explicit test/live/off builds, and ad-free native dependency exclusion. See [ad release guide](ad-release.md).
- SDK-compatible Expo patch updates and a compatible transitive shell-quote update. No SDK-major migration.

## Cost model

Costs occur at round creation, not role reveal, each player, timer tick, result reveal, or review request. Replaying creates one new round. English static rounds make zero backend/provider calls. The default random-category weights allocate 6% to movies/celebrities and 94% to static categories; that does not apply when users select specific categories.

Dynamic content normally makes one provider call with a word and eight candidate clues. Static non-English rounds make one translation call. Transport retries reuse request identity; there is no automatic paid semantic retry. A manually retried failed round can incur another call. Existing English emergency content on a generation failure remains unchanged.

The source defaults are `gpt-5.4-mini` for dynamic generation and `gpt-5.4` for localization. The deployed model overrides and actual invoice were not inspected. Standard prices checked against the official model pages are $0.75/$4.50 and $2.50/$15 per million input/output tokens respectively. Sources: [mini pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [full model pricing](https://developers.openai.com/api/docs/models/gpt-5.4).

Illustrative calculations, assuming 1,000 input tokens and the configured output ceiling (not measured average usage):

| Round path | Example cost per round | Per 1,000 rounds |
| --- | ---: | ---: |
| English static | $0 | $0 |
| Dynamic generation, mini, 260 output tokens | $0.00192 | $1.92 |
| Static translation, full model, 160 output tokens | $0.00490 | $4.90 |

At that illustrative generation size, the default English random mix averages about $0.115 per 1,000 total rounds in provider usage. A mostly translated audience costs materially more. Hosting, failed billable requests, taxes, and actual input sizes are excluded. The backend's $25/day reservation ceiling is a conservative protection, not a measured bill or exact spending guarantee.

Ad revenue must be measured after launch. If every three eligible rounds produced a filled impression, covering three example generation calls would require about $5.76 net eCPM; three translations would require $14.70. Warm-up, daily/time caps, consent, and unfilled ads increase the effective break-even requirement. Do not promise that ads will cover every translated round. Next economic improvement should be evaluated curated translations/caching after real language-mix and token-usage data are available.

## Organic competitiveness

One-phone play, offline play, and many languages are already marketed by competitors; for example [Imposter Spy Party Game](https://apps.apple.com/us/app/imposter-spy-party-game/id1611983535?platform=ipad). This is a limited public comparison, not a comprehensive market study.

The strongest immediate proposition is a smooth social ritual: choose a group, privately flip, pass confidently, discuss, reveal together, and play again immediately. The new result moment and physical reveal give screenshots and a short preview something specific to demonstrate.

Recommended screenshot sequence using real captured screens:

1. "One phone. Everyone is in." — setup and named players.
2. "Keep your card close." — the private reveal.
3. "Someone is bluffing." — the imposter card with optional hint.
4. "Make your call together." — discussion/voting instructions.
5. "One more round?" — group results and replay.

Use English offline categories as a qualified promise. Do not claim all languages/categories work offline or that the full interface is localized. Native review requests are invitations; the system controls whether they appear. Use App Store Connect retention and conversion data to evaluate the update before adding another feature.

The best larger opportunity is culturally curated, downloadable party packs paired with fully localized instructions in a small number of proven languages. That could reduce latency/cost, improve content quality, and support focused localized screenshots. It needs a decision on target languages, human content review and distribution/versioning. It was intentionally not implemented in this pass.

## Validation and limits

Baseline: 34 mobile tests, lint and TypeScript passed. Backend checks remain unchanged.

The completed validation record and release-specific requirements are in [ad-release.md](ad-release.md). Browser UI journeys are bounded proof of the rendered application; SDK lifecycle tests use mocked native callbacks. Native compilation/launch does not prove live ad fill, production consent configuration, physical-device frame rate, TestFlight reviews, or hosted generation health. No real provider calls were needed for the local English flow.

## File map

All paths below are under `imposter-game/` unless stated otherwise.

| File | Change |
| --- | --- |
| `app/index.tsx` | Anchors Start, improves loading/retry behavior, runs eligible setup consent and respects reduced motion. |
| `app/reveal.tsx` | Completes the physical flip, protects handoff, hides backgrounded cards and supports screen readers. |
| `app/play.tsx` | Adds results, direct replay, completion recording and the deadline-based timer. |
| `app/settings.tsx` | Opens the direct review link, shares the store URL, exposes ad privacy and respects reduced motion. |
| `app/_layout.tsx` | Handles font failure and reduced-motion navigation. |
| `components/splash/SplashGate.tsx` | Shortens splash dwell and skips it for reduced motion. |
| `components/ui/button.tsx` | Supplies explicit accessible labels and minimum touch height. |
| `components/ui/screen.tsx` | Includes the bottom safe area. |
| `contexts/game-context.tsx` | Delegates state transitions to the pure reducer and exposes completion. |
| `game/state.ts` | Preserves setup rules while adding guarded completion and play start time. |
| `game/types.ts` | Adds the completed phase. |
| `game/timer.ts` | Calculates remaining time from a deadline. |
| `game/engagement.ts` | Implements validated, serialized local history and conservative prompt policies. |
| `hooks/use-accessibility-settings.ts` | Observes system reduced-motion and screen-reader settings. |
| `services/engagement.ts` | Persists milestones and requests reviews only while results remain active. |
| `services/ads.ios.ts` | Handles native consent, preloading, presentation, frequency checks and removal suppression. |
| `services/ads.ts` | Provides the no-ad implementation for other platforms. |
| `config/ads.cjs` | Validates off/test/live build configuration. |
| `config/ad-networks.json` | Supplies Google's current published iOS attribution identifiers. |
| `plugins/with-ads-ios.js` | Excludes the ad SDK from ad-free native builds. |
| `app.config.js` | Applies the native plugin, build-specific public configuration and store URL. |
| `eas.json` | Adds a simulator ad-test profile and protects store builds from test mode. |
| `package.json`, `package-lock.json` | Pin the ad wrapper, align Expo patches, update shell-quote and add the typecheck command. |
| `tests/gameFlow.test.mjs` | Exercises lifecycle, assignment and timer edge cases. |
| `tests/engagement.test.mjs` | Exercises durable caps, duplicate completions and storage failure. |
| `tests/adsConfig.test.mjs` | Rejects invalid production/test configuration. |
| `tests/adLifecycle.test.mjs` | Exercises actual service code with mocked native SDK and review callbacks. |
| `docs/release/second-pass.md` (repo root) | Records the assessment, changes, economics and product recommendation. |
| `docs/release/ad-release.md` (repo root) | Records build setup, disclosure requirements and validation boundaries. |
| `docs/release/privacy-draft.md` (repo root) | Provides unpublished privacy text for the eventual release. |
