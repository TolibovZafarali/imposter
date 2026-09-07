const TEST_PUBLISHER = '3940256099942544';

function resolveAdsConfig(env) {
  const mode = env.IMPOSTER_ADS_MODE || 'off';
  if (!['off', 'test', 'live'].includes(mode)) throw new Error('Invalid IMPOSTER_ADS_MODE');
  if (mode === 'off') return { mode };
  const storeBuild = env.EAS_BUILD_PROFILE === 'production' || env.IMPOSTER_STORE_BUILD === 'true';
  if (mode === 'test') {
    if (storeBuild) throw new Error('Test ads are forbidden in store builds');
    return {
      mode,
      appId: `ca-app-pub-${TEST_PUBLISHER}~1458002511`,
      interstitialId: `ca-app-pub-${TEST_PUBLISHER}/4411468910`,
    };
  }
  const appId = env.ADMOB_IOS_APP_ID?.trim();
  const interstitialId = env.ADMOB_IOS_INTERSTITIAL_ID?.trim();
  if (!/^ca-app-pub-\d{16}~\d{10}$/.test(appId || '') ||
    !/^ca-app-pub-\d{16}\/\d{10}$/.test(interstitialId || '') ||
    appId.includes(TEST_PUBLISHER) || interstitialId.includes(TEST_PUBLISHER) ||
    appId.split('~')[0] !== interstitialId.split('/')[0]) {
    throw new Error('Live ads require valid matching production iOS app and interstitial IDs');
  }
  if (env.IMPOSTER_ADS_PRIVACY_READY !== 'true' || env.IMPOSTER_ADS_AUDIENCE !== 'general') {
    throw new Error('Live ads require reviewed privacy disclosures and confirmed general audience');
  }
  return { mode, appId, interstitialId };
}

module.exports = { resolveAdsConfig };
