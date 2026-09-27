# App Store releases

Use the exact text in [whats-new.txt](whats-new.txt) for the App Store's What's New field on this and future updates. Keep this single short note instead of a detailed change list unless a different note is explicitly requested.

Increment the app version and iOS build number in `imposter-game/app.json` for each release. Build with the production EAS profile, upload the resulting build to App Store Connect, select that build for the new version, and submit it for review with automatic release after approval.

Verify production backend migrations and function compatibility before submitting the mobile release. Record build, deployment, and review status separately; an uploaded build is not yet a public App Store release.
