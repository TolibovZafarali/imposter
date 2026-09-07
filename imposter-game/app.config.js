const { resolveAdsConfig } = require('./config/ads.cjs');

module.exports = ({ config }) => {
  const ads = resolveAdsConfig(process.env);
  return {
    ...config,
    ios: { ...config.ios, appStoreUrl: 'https://apps.apple.com/app/id6771144493' },
    extra: { ...config.extra, ads: { mode: ads.mode, interstitialId: ads.interstitialId } },
    plugins: [
      ...(config.plugins || []),
      'expo-font',
      ['./plugins/with-ads-ios', { enabled: ads.mode !== 'off' }],
      ...(ads.mode === 'off' ? [] : [['react-native-google-mobile-ads', {
        iosAppId: ads.appId,
        delayAppMeasurementInit: true,
        skAdNetworkItems: require('./config/ad-networks.json'),
        userTrackingUsageDescription: 'Your permission helps our advertising partner measure ads that support the game.',
      }]]),
    ],
  };
};
