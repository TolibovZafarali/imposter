import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveAdsConfig } = require('../config/ads.cjs');

test('unconfigured builds are ad-free; test mode is explicit and prohibited for stores', () => {
  assert.deepEqual(resolveAdsConfig({}), { mode: 'off' });
  assert.equal(resolveAdsConfig({ IMPOSTER_ADS_MODE: 'test' }).mode, 'test');
  assert.throws(() => resolveAdsConfig({ IMPOSTER_ADS_MODE: 'test', EAS_BUILD_PROFILE: 'production' }));
  assert.throws(() => resolveAdsConfig({ IMPOSTER_ADS_MODE: 'test', IMPOSTER_STORE_BUILD: 'true' }));
  assert.throws(() => resolveAdsConfig({ IMPOSTER_ADS_MODE: 'oops' }));
});

test('live mode requires matching real IDs and reviewed audience/privacy configuration', () => {
  const env = { IMPOSTER_ADS_MODE: 'live', ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
    ADMOB_IOS_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/1234567890',
    IMPOSTER_ADS_PRIVACY_READY: 'true', IMPOSTER_ADS_AUDIENCE: 'general' };
  assert.equal(resolveAdsConfig(env).mode, 'live');
  for (const override of [
    { ADMOB_IOS_APP_ID: '' }, { ADMOB_IOS_INTERSTITIAL_ID: '' },
    { ADMOB_IOS_APP_ID: 'ca-app-pub-3940256099942544~1458002511' },
    { ADMOB_IOS_INTERSTITIAL_ID: 'ca-app-pub-2345678901234567/1234567890' },
    { IMPOSTER_ADS_PRIVACY_READY: 'false' }, { IMPOSTER_ADS_AUDIENCE: 'unknown' },
  ]) assert.throws(() => resolveAdsConfig({ ...env, ...override }));
});
