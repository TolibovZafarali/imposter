const { resolveAdsConfig } = require('./config/ads.cjs');

const ads = resolveAdsConfig(process.env);

module.exports = {
  dependencies: {
    'react-native-google-mobile-ads': {
      platforms: {
        android: null,
        // Codegen can run without the Podfile's cached autolinking output.
        ...(ads.mode === 'off' ? { ios: null } : {}),
      },
    },
  },
};
