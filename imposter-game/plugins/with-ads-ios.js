const { withPodfile } = require('expo/config-plugins');

module.exports = (config, { enabled }) => withPodfile(config, (result) => {
  const marker = "  config_command += ['--exclude', 'react-native-google-mobile-ads']\n";
  let contents = result.modResults.contents.replace(marker, '');
  const insertion = '  config = use_native_modules!(config_command)';
  if (!contents.includes(insertion)) throw new Error('Could not configure ad-free iOS autolinking');
  // SDK 54 merges nested null platform overrides into the library defaults.
  // Exclude through the supported autolinking command instead.
  if (!enabled) contents = contents.replace(insertion, marker + insertion);
  result.modResults.contents = contents;
  return result;
});
