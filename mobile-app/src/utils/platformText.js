import { Platform } from 'react-native';

export const getPlatformText = (textKey) => {
  const platformTexts = {
    // Welcome messages
    welcome: {
      ios: 'Welcome to FlipStar on iOS!',
      android: 'Welcome to FlipStar on Android!',
      default: 'Welcome to FlipStar!'
    },
    
    // Button texts
    getStarted: {
      ios: 'Get Started on iOS',
      android: 'Get Started on Android',
      default: 'Get Started'
    },
    
    // Navigation titles
    campaigns: {
      ios: 'Campaigns (iOS)',
      android: 'Campaigns (Android)',
      default: 'Campaigns'
    },
    
    // Camera permissions
    cameraPermission: {
      ios: 'Please allow camera access in Settings',
      android: 'Please allow camera permission',
      default: 'Please allow camera access'
    },
    
    // Storage permissions
    storagePermission: {
      ios: 'Please allow photo library access',
      android: 'Please allow storage permission',
      default: 'Please allow storage access'
    },
    
    // Share functionality
    shareButton: {
      ios: 'Share via iOS Share Sheet',
      android: 'Share via Android Share',
      default: 'Share'
    },
    
    // Platform-specific features
    faceIdAvailable: {
      ios: 'Use Face ID to login',
      android: 'Use fingerprint to login',
      default: 'Use biometric authentication'
    },
    
    // Error messages
    networkError: {
      ios: 'Network error. Please check your connection.',
      android: 'Network error. Please check your internet connection.',
      default: 'Network error. Please check your connection.'
    },
    
    // Subscription/Register text
    subscribe: {
      ios: 'Register',
      android: 'Subscribe',
      default: 'Subscribe'
    },
    
    subscribeAnd: {
      ios: 'Register and',
      android: 'Subscribe and',
      default: 'Subscribe and'
    },
    
    subscribeTo: {
      ios: 'Register to',
      android: 'Subscribe to',
      default: 'Subscribe to'
    },
    
    subscribeVia: {
      ios: 'Register via',
      android: 'Subscribe via',
      default: 'Subscribe via'
    },
    
    canSubscribe: {
      ios: 'can register',
      android: 'can subscribe',
      default: 'can subscribe'
    },
    
    toSubscribe: {
      ios: 'to register',
      android: 'to subscribe',
      default: 'to subscribe'
    },
    
    subscribers: {
      ios: 'registered users',
      android: 'subscribers',
      default: 'subscribers'
    },
    
    subscription: {
      ios: 'registration',
      android: 'subscription',
      default: 'subscription'
    },
    
    subscriptions: {
      ios: 'registrations',
      android: 'subscriptions',
      default: 'subscriptions'
    },
    
    unsubscribed: {
      ios: 'unregistered',
      android: 'unsubscribed',
      default: 'unsubscribed'
    },
    
    unsubscribe: {
      ios: 'unregister',
      android: 'unsubscribe',
      default: 'unsubscribe'
    }
  };

  const platformKey = Platform.OS;
  const textConfig = platformTexts[textKey];
  
  if (!textConfig) {
    console.warn(`Text key "${textKey}" not found in platformTexts`);
    return '';
  }
  
  return textConfig[platformKey] || textConfig.default || '';
};

// Helper function for conditional rendering
export const isPlatform = (platform) => Platform.OS === platform;

export const PlatformText = ({ textKey, style }) => {
  const text = getPlatformText(textKey);
  return <Text style={style}>{text}</Text>;
};
