const { withPlugins, withPodfile } = require('@expo/config-plugins');

/**
 * Plugin to ensure react-native-iap iOS dependencies are correctly configured
 * in the Podfile for Expo managed workflow.
 */
function withReactNativeIapPodspec(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;
    
    // Add StoreKit framework if not already present
    if (!contents.includes('pod \'StoreKit\'')) {
      const podfileLines = contents.split('\n');
      const targetIndex = podfileLines.findIndex(line => 
        line.includes('target') && line.includes('do')
      );
      
      if (targetIndex !== -1) {
        podfileLines.splice(targetIndex + 1, 0, '  pod \'StoreKit\'');
        config.modResults.contents = podfileLines.join('\n');
      }
    }
    
    return config;
  });
}

module.exports = withReactNativeIapPodspec;