# Release Blockers

## Fixed

- Public legal/support pages are deployed and verified with valid HTTPS:
  - Privacy Policy: `https://cnfstudios.com/privacy`
  - Terms of Use: `https://cnfstudios.com/terms`
  - Support: `https://cnfstudios.com/support`
- The in-app Privacy policy, Terms of use, and Support buttons now open those
  verified public URLs.

## Remaining Notes

- `https://www.cnfstudios.com` redirects cleanly to `https://cnfstudios.com`
  with a 308 redirect and should not be used as the primary App Store metadata
  URL.
- No dedicated public support email was found in the project or config. The
  deployed Support page uses the existing public GitHub Issues page:
  `https://github.com/TolibovZafarali/imposter/issues`.
