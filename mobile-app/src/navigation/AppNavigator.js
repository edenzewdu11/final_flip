import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Linking, Platform } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';

import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ConsentProvider } from '../contexts/ConsentContext';
import { AppAlertProvider } from '../components/common/AppAlert';
import { LanguageProvider } from '../contexts/LanguageContext';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { BlockProvider } from '../contexts/BlockContext';
import SubscriptionGate from '../components/subscription/SubscriptionGate';

// Import screens directly (no lazy loading) to prevent blank screen flash
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import HomeScreen from '../screens/feed/HomeScreen';
import ReelsScreen from '../screens/feed/ReelsScreen';
import CreateScreen from '../screens/general/CreateScreen';
import MessagesScreen from '../screens/messaging/MessagesScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import ExploreScreen from '../screens/feed/ExploreScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import FollowListScreen from '../screens/profile/FollowListScreen';
import CampaignsScreen from '../screens/campaign/CampaignsScreen';
import CampaignDetailScreen from '../screens/campaign/CampaignDetailScreen';
import LeaderboardScreen from '../screens/campaign/LeaderboardScreen';
import GlobalLeaderboardScreen from '../screens/campaign/GlobalLeaderboardScreen';
import WalletScreen from '../screens/subscription/WalletScreen';
import SubscriptionScreen from '../screens/subscription/SubscriptionScreen';
import GamificationScreen from '../screens/general/GamificationScreen';
import NotificationsScreen from '../screens/general/NotificationsScreen';
import WebsiteCoinScreen from '../screens/subscription/WebsiteCoinScreen';
import ConsentDashboard from '../screens/settings/ConsentDashboard';
import DataExportScreen from '../screens/settings/DataExportScreen';
import PrivacyPolicyScreen from '../screens/settings/PrivacyPolicyScreen';
import EURightsScreen from '../screens/settings/EURightsScreen';
import AccountDeletionScreen from '../screens/settings/AccountDeletionScreen';

// Configure deep linking
const linking = {
  prefixes: [
    'https://flipstar.et', 
    'flipstar.et', 
    'https://www.flipstar.et',
    'www.flipstar.et',
    'https://uat.flipstar.et',
    'uat.flipstar.et',
    'https://flipstar.app', 
    'flipstar.app',
    'flipstar://'
  ],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home: 'home',
          Reels: 'reels',
        },
      },
      ReelsDetail: {
        path: 'post/:id',
        parse: {
          id: (id) => parseInt(id, 10),
        },
      },
    },
  },
};

// ReelsDetail wrapper to avoid navigation conflicts
function ReelsDetailWrapper({ route, navigation }) {
  const { id, initialVideoId, initialReel } = route.params || {};
  const videoId = initialVideoId || id || initialReel?.id;
  console.log('ReelsDetailWrapper - received params:', route.params);
  console.log('ReelsDetailWrapper - using videoId:', videoId);
  
  // Ensure we have a valid video ID
  if (!videoId && !initialReel) {
    console.log('No video ID found, navigating to Home');
    return <HomeScreen />;
  }
  
  // Pass the route params directly to ReelsScreen with key to guarantee clean state and immediate playback
  return <ReelsScreen key={`reel_${videoId}`} navigation={navigation} route={route} />;
}

const GOLD = '#C8B56A';
const BG = '#0B0B0C';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function MainTabs() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [unreadMessages, setUnreadMessages] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await api.request('/messages/unread-count/').catch(() => null);
      if (data?.unread_count !== undefined) setUnreadMessages(data.unread_count);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.cardBg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.primary + '30',
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        gestureEnabled: false,
        swipeEnabled: false,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Home:     focused ? 'home'          : 'home-outline',
            Reels:    focused ? 'film'          : 'film-outline',
            Create:   'add',
            Messages: focused ? 'chatbubble'    : 'chatbubble-outline',
            Profile:  focused ? 'person'        : 'person-outline',
          };
          if (route.name === 'Create') {
            return (
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 4, elevation: 8, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 }}>
                <Ionicons name="add" size={26} color="#000" />
              </View>
            );
          }
          if (route.name === 'Messages' && unreadMessages > 0) {
            return (
              <View>
                <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={size} color={color} />
                <View style={{ position: 'absolute', top: -4, right: -6, backgroundColor: colors.error, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{unreadMessages > 99 ? '99+' : unreadMessages}</Text>
                </View>
              </View>
            );
          }
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarLabel: ({ color }) => {
          if (route.name === 'Create') return null;
          const labels = { Home: 'Home', Reels: 'Reels', Messages: 'Messages', Profile: 'Profile' };
          return <Text style={{ fontSize: 10, color, fontWeight: '600' }}>{labels[route.name]}</Text>;
        },
      })}
    >
      <Tab.Screen name="Home"     component={HomeScreen} />
      <Tab.Screen name="Reels"    component={ReelsScreen} />
      <Tab.Screen name="Create"   component={CreateScreen} />
      <Tab.Screen 
        name="Messages" 
        component={MessagesScreen}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!user) {
              e.preventDefault();
              navigation.navigate('Login');
            }
          },
        })}
      />
      <Tab.Screen name="Profile"  component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function MainStack() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  
  return (
    <SubscriptionGate navigation={navigation}>
      <Stack.Navigator 
        screenOptions={{ 
          headerShown: false, 
          cardStyle: { backgroundColor: colors.bg },
          gestureEnabled: false,
          animationEnabled: true,
        }}
      >
        <Stack.Screen name="MainTabs"        component={MainTabs} />
        <Stack.Screen name="Explore"         component={ExploreScreen} />
        <Stack.Screen name="ReelsDetail"     component={ReelsDetailWrapper} />
        <Stack.Screen name="ProfileStack"    component={ProfileScreen} options={{ headerShown: false }} />
        <Stack.Screen name="EditProfile"     component={EditProfileScreen} />
        <Stack.Screen name="Settings"        component={SettingsScreen} />
        <Stack.Screen name="MessagesStack"   component={MessagesScreen} options={{ headerShown: false }} />
        <Stack.Screen name="FollowList"      component={FollowListScreen} />
        <Stack.Screen name="Campaigns"       component={CampaignsScreen} />
        <Stack.Screen name="CampaignDetail"  component={CampaignDetailScreen} />
        <Stack.Screen name="Leaderboard"    component={LeaderboardScreen} />
        <Stack.Screen name="GlobalLeaderboard" component={GlobalLeaderboardScreen} />
        <Stack.Screen name="Wallet"          component={WalletScreen} />
        <Stack.Screen name="Subscription"    component={SubscriptionScreen} />
        <Stack.Screen name="Gamification"    component={GamificationScreen} />
        <Stack.Screen name="Notifications"   component={NotificationsScreen} />
        <Stack.Screen name="WebsiteCoin"     component={WebsiteCoinScreen} />
        <Stack.Screen name="CoinPurchase"    component={WebsiteCoinScreen} />
        <Stack.Screen name="ConsentDashboard" component={ConsentDashboard} />
        <Stack.Screen name="DataExportScreen" component={DataExportScreen} />
        <Stack.Screen name="PrivacyPolicyScreen" component={PrivacyPolicyScreen} />
        <Stack.Screen name="EURightsScreen" component={EURightsScreen} />
        <Stack.Screen name="AccountDeletionScreen" component={AccountDeletionScreen} />
      </Stack.Navigator>
    </SubscriptionGate>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login"    component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const { subscriptionChecked, hasActiveSubscription, refreshSubscriptionStatus } = useAuth();
  const navigation = useNavigation();
  
  console.log('[ROOT_NAV] Subscription status:', { user: !!user, loading, subscriptionChecked, hasActiveSubscription });
  
  // NOTE: We no longer force-redirect the whole app to the Subscription screen
  // when the user has no active subscription. Users without a subscription can
  // still freely browse Home/Reels/etc. Individual interactive actions (like,
  // comment, gift, share, post, etc.) are responsible for checking
  // `hasActiveSubscription` themselves and navigating to 'Subscription' when needed.
  
  // Periodically check subscription status (every 30 seconds like website)
  useEffect(() => {
    if (!user || !api.hasToken()) return;
    
    const interval = setInterval(async () => {
      console.log('[ROOT_NAV] Checking subscription status (30-second interval)...');
      try {
        await refreshSubscriptionStatus();
        console.log('[ROOT_NAV] Subscription status refreshed');
      } catch (error) {
        console.log('[ROOT_NAV] Failed to refresh subscription status:', error.message);
      }
    }, 30 * 1000); // 30 seconds
    
    return () => clearInterval(interval);
  }, [user, refreshSubscriptionStatus]);
  
  if (loading) {
    console.log('[ROOT_NAV] Still loading auth...');
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  
  // Users without an active subscription can still browse the app freely
  // (Home, Reels, etc.). Interactive actions gate themselves individually.
  console.log('[ROOT_NAV] Rendering normal navigation:', { user: !!user, hasActiveSubscription });
  return user ? <MainStack /> : <AuthStack />;
}

function AppNavigatorContent() {
  const { colors } = useTheme();
  
  // Wake up the backend immediately on app open (Render free tier cold starts)
  React.useEffect(() => { api.warmUp(); }, []);
  
  // Handle incoming deep links
  const handleDeepLink = useCallback(({ url }) => {
    // Parse the URL to extract post ID
    const match = url.match(/\/post\/(\d+)/);
    if (match) {
      const postId = parseInt(match[1], 10);
      console.log('Deep link to post:', postId);
      // Navigation will be handled by the linking config
    }
  }, []);

  const linkingConfig = React.useMemo(() => ({
    ...linking,
    subscribe: (listener) => {
      const onReceiveURL = ({ url }) => {
        handleDeepLink({ url });
        listener(url);
      };
      
      // Listen for incoming links
      const subscription = Linking.addEventListener('url', onReceiveURL);
      
      // Check if app was opened with a URL
      Linking.getInitialURL().then((url) => {
        if (url) {
          listener(url);
        }
      });
      
      return () => {
        subscription?.remove();
      };
    },
  }), [handleDeepLink]);

  const navTheme = React.useMemo(() => ({
    dark: true,
    colors: {
      primary: colors.primary,
      background: colors.bg,
      card: colors.cardBg,
      text: colors.text,
      border: colors.border,
      notification: colors.primary,
    },
  }), [colors]);

  return (
    <GestureHandlerRootView style={{ flex: 1, minHeight: Platform.OS === 'web' ? '100%' : undefined, backgroundColor: colors.bg }}>
      <AuthProvider>
        <ConsentProvider>
          <AppAlertProvider>
            <NavigationContainer linking={linkingConfig} theme={navTheme}>
              <RootNavigator />
            </NavigationContainer>
          </AppAlertProvider>
        </ConsentProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

export default function AppNavigator() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BlockProvider>
          <AppNavigatorContent />
        </BlockProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
