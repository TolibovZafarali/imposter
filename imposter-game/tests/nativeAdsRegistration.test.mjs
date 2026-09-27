import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const adViews = ['RNGoogleMobileAdsBannerView', 'RNGoogleMobileAdsNativeView', 'RNGoogleMobileAdsMediaView'];

for (const mode of ['off', 'test', 'live']) {
  test(`native component generation respects ${mode} ads mode without cached autolinking`, () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'imposter-native-registration-'));
    try {
      copyFileSync(path.join(projectRoot, 'package.json'), path.join(fixture, 'package.json'));
      symlinkSync(path.join(projectRoot, 'node_modules'), path.join(fixture, 'node_modules'));
      mkdirSync(path.join(fixture, 'config'));
      copyFileSync(path.join(projectRoot, 'config/ads.cjs'), path.join(fixture, 'config/ads.cjs'));
      const nativeConfig = path.join(projectRoot, 'react-native.config.js');
      if (existsSync(nativeConfig)) copyFileSync(nativeConfig, path.join(fixture, 'react-native.config.js'));

      execFileSync(process.execPath, [
        path.join(projectRoot, 'node_modules/react-native/scripts/generate-codegen-artifacts.js'),
        '-p', fixture, '-t', 'ios', '-o', path.join(fixture, 'ios'),
      ], {
        cwd: fixture,
        env: {
          ...process.env,
          EXPO_NO_DOTENV: '1',
          EAS_BUILD_PROFILE: 'preview',
          IMPOSTER_STORE_BUILD: 'false',
          IMPOSTER_ADS_MODE: mode,
          ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
          ADMOB_IOS_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/1234567890',
          IMPOSTER_ADS_AUDIENCE: 'general',
          IMPOSTER_ADS_PRIVACY_READY: 'true',
        },
        stdio: 'pipe',
      });

      const provider = readFileSync(path.join(fixture, 'ios/build/generated/ios/RCTThirdPartyComponentsProvider.mm'), 'utf8');
      assert.match(provider, /RNCSafeAreaViewComponentView/, 'normal native views must stay registered');
      for (const view of adViews) {
        assert.equal(provider.includes(view), mode !== 'off', `${view} must match the linked SDK`);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
