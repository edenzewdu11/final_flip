const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withReactNativeIapPodspec(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podspecPath = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'react-native-iap',
        'RNIap.podspec'
      );

      if (fs.existsSync(podspecPath)) {
        const podspec = fs.readFileSync(podspecPath, 'utf8');
        const patchedPodspec = podspec.replace(
          '    s.dependency "RCT-Folly"\n',
          ''
        );

        if (patchedPodspec !== podspec) {
          fs.writeFileSync(podspecPath, patchedPodspec);
        }
      }

      return config;
    },
  ]);
};