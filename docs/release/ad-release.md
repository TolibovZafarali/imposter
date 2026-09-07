# iOS ads and reviews release guide

## Runtime behavior

`react-native-google-mobile-ads` 16.5.0 is pinned. Its native dependencies in the verified simulator build are Google Mobile Ads 13.5.0 and UMP 3.1.0. Android and web use the no-ad service.

An interstitial is eligible only on an explicit exit from completed results (Play again or Change setup), after three completed rounds and 24 hours since the local history was first initialized. Require three rounds and ten minutes between attempts, at most two attempts per rolling 24 hours, and ten minutes away from a review attempt. Abandoned rounds do not count. Failed/late loads are skipped with no waiting for an ad to load. Presentation waits for close/error before navigation; no ad appears later because a load finally completed. Caps persist before showing, so a crash or failed presentation conservatively consumes the opportunity.

No banners, launch ads, rewards, role/handoff ads or mid-game ads. `setAdsRemoved(true)` discards prepared ads and suppresses future requests; connect this to a verified purchase entitlement if Remove Ads is added. There is no fake purchase screen or client-controlled entitlement storage.

UMP consent information refreshes during setup each process launch. Required forms are requested before starting an eligible game from setup, with navigation controls unavailable during that preparation. New users can start without a consent interruption. Settings always offers Ad privacy choices in enabled native builds; changing consent discards prepared ads. Failed consent refresh or storage means no ads. The SDK initializes only after fresh `canRequestAds`; consent status "obtained" alone is not used as permission.

Requests explicitly ask for non-personalized ads and use a G content filter. That is not equivalent to no data collection, a Kids Category configuration, or proof that all SDK/account uses of data are outside ATT. No player names, words, language, keywords or custom user identifiers are sent as ad targeting signals. Optional ATT messaging can be handled by UMP when configured in the account; a purpose string is present in enabled builds. No separate ATT dependency/prompt is added. Review the actual account choices, publisher first-party ID behavior and data use before enabling live ads.

## Build configuration

Run all commands from `imposter-game/`, with `EXPO_NO_DOTENV=1` for local work. Keep provider/service secrets outside the mobile environment. Ad app/unit IDs are public identifiers, not credentials.

| Mode | Requirements | Native behavior |
| --- | --- | --- |
| `IMPOSTER_ADS_MODE=off` or unset | none | iOS ad pods excluded; no SDK requests |
| `IMPOSTER_ADS_MODE=test` | local/internal build | Google sample app and interstitial IDs; no production revenue |
| `IMPOSTER_ADS_MODE=live` | real matching IDs and release attestations below | consent-gated production unit, debug sessions still request a test unit |

Live variables:

- `ADMOB_IOS_APP_ID`: the actual iOS app ID with `~` separator.
- `ADMOB_IOS_INTERSTITIAL_ID`: the actual interstitial unit ID with `/` separator, same publisher.
- `IMPOSTER_ADS_AUDIENCE=general`: set only after confirming the app's audience. Child-directed/mixed-audience treatment is not implemented; leave live ads off until that decision is resolved.
- `IMPOSTER_ADS_PRIVACY_READY=true`: set only after completing the account/disclosure/device work below.

Production profile carries `IMPOSTER_STORE_BUILD=true`; production and store builds reject test mode. Custom store profiles must preserve this flag. No test-ID fallback exists in live mode. Invalid/missing IDs, sample publisher IDs, mismatched publishers or absent release attestations stop configuration.

The EAS `ads-preview` profile extends internal preview and builds an iOS simulator binary using sample IDs. For local native test builds use `IMPOSTER_ADS_MODE=test EXPO_NO_DOTENV=1 npx expo run:ios`. Expo Go cannot load the ad SDK. Every mode change that adds/removes the SDK requires a native rebuild. Do not enable ads using a JavaScript-only update on an ad-free binary.

`plugins/with-ads-ios.js` explicitly excludes the module from the Expo autolinking command in ad-free prebuilds because SDK 54's nested null override merge retains this library's default native configuration. The plugin fails if the expected Podfile insertion point changes. Use Expo autolinking, not `EXPO_USE_COMMUNITY_AUTOLINKING=1`. Android exclusion is fixed in package configuration. The SDK plugin may warn about a missing Android app ID; Android linking is intentionally excluded and no dummy Android ID is shipped.

`config/ad-networks.json` contains the 50 identifiers in Google's official iOS privacy-strategy guide retrieved September 7, 2026. Refresh that list against the official guide when changing ad sources or SDKs.

## Required before a live ad release

1. Confirm intended age audience and store category; configure suitable treatment for known minors before enabling monetization for them. A G ad-content filter does not solve age/consent obligations.
2. Register the real bundle `com.cnfstudios.imposter` in AdMob, create an iOS interstitial and configure account-side conservative caps. Review app verification and publish your actual app-ads.txt publisher record on the store-listed developer domain. No publisher record was fabricated here.
3. Configure and publish applicable UMP messages for EEA/UK/Switzerland and applicable US states. Validate consent accepted/declined, privacy-options changes and network failures using registered test devices and debug geographies. Do not leave forced geography in production.
4. Decide whether any ad-partner data use requires ATT. If it does, configure UMP's ATT message, verify denial still permits gameplay, and ensure tracking does not begin without permission. Non-personalized requests alone do not establish an ATT exemption. Review first-party identifier/account controls; this wrapper does not expose a first-party-ID toggle.
5. Publish accurate privacy text before releasing ads. The existing public privacy page says there are no advertising SDKs and must change for an ad-enabled release. A draft appears in [privacy-draft.md](privacy-draft.md); it has not been published.
6. Update App Store Connect privacy answers from the final archive and SDK/account behavior: review coarse location/IP, device identifiers, advertising and interaction data, crash/performance diagnostics, purposes, linkage and tracking. Validate the aggregated privacy report and required-reason API declarations. Manifest presence alone does not complete store disclosures.
7. Verify native test ad load/show/close/failure, no-fill, offline play, frequency after relaunch, background during flip, rapid taps, VoiceOver, largest text, reduced motion and real iPhone frame pacing. TestFlight suppresses actual review prompts; use the appropriate development build to exercise the native request and rely on Apple's production discretion.
8. Increment the app version/build for release and capture current iPhone/iPad screenshots. The existing 1.0.0/build 3 identifiers were intentionally retained pending release planning.

## Verification record

- TypeScript and lint pass.
- 50 mobile tests pass, including lifecycle, assignment, timer, persistent caps, SDK callback mocks and build-ID validation.
- 44 backend tests pass with network/environment denied; backend format, lint and type checks pass.
- Expo dependency check passes; Expo Doctor passes 18/18 after SDK 54 patch alignment.
- iOS and web exports pass.
- Dependency audit after compatible updates: 32 findings (13 high, 18 moderate, 1 low), zero critical. Remaining transitive advisories need a separate SDK/toolchain upgrade assessment; this is not a clean security audit.
- Isolated ad-enabled iOS simulator prebuild, CocoaPods install and Xcode compilation pass; native setup and reveal launch and render.
- Isolated ad-free iOS simulator Xcode build also passes. Ad-free prebuild excludes the SDK; CocoaPods resolves 99 pods with no Google Mobile Ads/UMP entries. Android autolinking also excludes the ad module.
- Browser flow: local Food round, three private cards, discussion, explicit result confirmation, stored completion and immediate replay; repeated at 375×667 with no horizontal overflow and one increment per completion.
- Full-screen callback tests are synthetic; actual network test-ad presentation and real consent regions remain device/account release checks.
- Device frame rate, physical-device hold/interrupt edge cases, App Store review presentation, live ads/revenue and production generation were not signed off.

## Official references

- [SDK/Expo installation](https://docs.page/invertase/react-native-google-mobile-ads)
- [Interstitial lifecycle](https://docs.page/invertase/react-native-google-mobile-ads/displaying-ads)
- [Wrapper consent and UMP-managed ATT](https://docs.page/invertase/react-native-google-mobile-ads/european-user-consent)
- [Google UMP setup](https://developers.google.com/admob/ios/privacy)
- [Google privacy strategies and network identifiers](https://developers.google.com/admob/ios/privacy/strategies)
- [Google SDK data disclosure](https://developers.google.com/admob/ios/privacy/data-disclosure)
- [Apple privacy and tracking](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- [Apple review timing](https://developer.apple.com/documentation/StoreKit/requesting-app-store-reviews)
- [Expo StoreReview](https://docs.expo.dev/versions/v54.0.0/sdk/storereview/)
