import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, TextInput, Image, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../api';

const GOLD = '#8fc441';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#262626';
const TEXT = '#fff';
const SUB = '#666';

// ── Terms table helper ─────────────────────────────────────────────────────
function TermsTable({ headers, rows, flex }) {
  const colFlex = flex || headers.map(() => 1);
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        {headers.map((h, i) => (
          <Text key={i} style={[styles.cell, styles.headerCell, { flex: colFlex[i] }]}>{h}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.row, ri % 2 === 1 && styles.altRow]}>
          {row.map((cell, ci) => (
            <Text key={ci} style={[styles.cell, styles.dataCell, { flex: colFlex[ci] }]}>{cell}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// FAQ Items from LoginScreen
const FAQ_ITEMS = [
  {
    q: "What is FlipStar?",
    a: "FlipStar is a premium, subscription-based gamified social media platform by Ethio telecom and SkykinTechnologies PLC. It lets you upload short-form videos and photos ('Flips'), compete in daily, weekly, monthly, and grand prize campaigns, earn and spend digital coins, and participate in a creator economy powered by telebirr."
  },
  {
    q: "Who can use FlipStar?",
    a: "All active Ethio telecom prepaid, postpaid, and hybrid mobile customers with a smartphone (Android or iOS) or any HTML5-capable browser for web access. Users must be at least 18 years of age."
  },
  {
    q: "What devices and platforms does FlipStar support?",
    a: "Android App: Available on Google Play Store (search: FlipStar). iOS App: Available on Apple App Store (search: FlipStar). Web: Visit https://flipstar.et in any modern browser."
  },
  {
    q: "Is FlipStar available to all Ethio telecom customers?",
    a: "Yes. All active prepaid, postpaid, and hybrid Ethio telecom mobile customers can subscribe and use the service. The subscriber's number must be in 'Active' status at the time of subscription."
  },
  {
    q: "How do I subscribe to FlipStar?",
    a: "Via SMS: Send 1, 2, or 3 to the FlipStar shortcode — all three keywords activate the same service. Via App/Web: Download the FlipStar app or visit https://flipstar.et, select 'Sign Up', enter your full name and mobile number, enter the confirmation code sent to your number. Via telebirr: Open the telebirr app, navigate to the FlipStar service page, and select 'Subscribe'."
  },
  {
    q: "What subscription plans are available?",
    a: "Flip Daily: 3 ETB/24hrs • Flip Weekly: 20 ETB/7days • Flip Monthly: 70 ETB/30days • Flip On-Demand: 10 ETB for 100 Coins (one-time purchase, no recurring charge)."
  },
  {
    q: "How am I charged?",
    a: "Prepaid: fee deducted from airtime balance. Postpaid: fee added to monthly bill. Hybrid: charged from your default account. A maximum of one charge applies per 24-hour cycle. Failed charges are retried automatically if you recharge within the same day."
  },
  {
    q: "How do I unsubscribe?",
    a: "Via SMS: Send STOP1, STOP2, or STOP3 to the FlipStar shortcode — all three keywords cancel your subscription immediately. Via App/Web: Go to Account Settings and select Unsubscribe. Via telebirr: Open the telebirr app, navigate to the FlipStar service page, and select 'Unsubscribe'. You will receive a confirmation SMS upon successful unsubscription."
  },
  {
    q: "What happens to my coins and progress if I unsubscribe?",
    a: "Your coins and digital assets remain valid for 30 days after unsubscription. If you re-subscribe within 30 days, your unexpired coins and progress are restored. Assets not recovered within 30 days will expire."
  },
  {
    q: "What are coins and how do I earn them?",
    a: "Coins are FlipStar's internal digital currency. Earn them through: Daily login bonus (3 Coins/day), Weekly loyalty bonus (50 Coins for 7 consecutive days), Monthly loyalty bonus (150 Coins for consistent daily usage for a full month — credited on the last day of your subscription month), or On-Demand purchase (10 ETB = 100 Coins via telebirr or Airtime)."
  },
  {
    q: "What can I do with coins?",
    a: "Gift creators with virtual gifts (Rose, Heart, Star, Teddy Bear, Diamond, Crown, Sports Car, or Rocket) — gifting converts your Coins into Points for the creator. Boost your content visibility, unlock extended video uploads (up to 90–120 seconds), level up, and unlock premium features."
  },
  {
    q: "What gift types are available and how many points does each give?",
    a: "All gifts give 1 Point per Coin spent. Rose: 10 Coins (max 500 Points/day to same creator). Heart: 50 Coins (max 500 Points/day). Star: 100 Coins (max 500 Points/day). Teddy Bear: 200 Coins (max 2,000 Points/day). Diamond: 500 Coins (max 5,000 Points/day). Crown: 750 Coins (max 7,500 Points/day). Sports Car: 1,000 Coins (max 10,000 Points/day). Rocket: 2,000 Coins (max 20,000 Points/day)."
  },
  {
    q: "Are there daily limits on gifting and point transfers?",
    a: "Yes. Minimum per transaction: 10 Points. Maximum per transaction: 10,000 Points. Maximum to one creator per day: 20,000 Points (24-hour rolling window). Maximum total outbound per user per day: 44,500 Points. Maximum cash-out per request: 50,000 Points. Minimum cash-out threshold: 1,000 Points (80 ETB net after 20% commission)."
  },
  {
    q: "How does the score system work?",
    a: "Vote on a Flip: +1 Score to creator. Comment on a Flip: +2 Score to creator. Share a Flip: +5 Score to creator. Send any gift: +10 Score to creator (per transaction). Upload a Flip: +5 XP to yourself. Daily login: +1 XP to yourself. Weekly loyalty bonus achieved: +10 XP to yourself. Monthly loyalty bonus achieved: +50 XP to yourself."
  },
  {
    q: "Can I cash out my coins?",
    a: "Coins earned through daily login bonuses and loyalty rewards (bonus coins) cannot be cashed out — they can only be spent within the platform. Points earned by creators from gifts received can be cashed out via telebirr. Minimum cash-out threshold: 1,000 Points (equivalent to 80 ETB net, after 20% platform commission)."
  },
  {
    q: "What is the platform commission?",
    a: "A 20% commission is applied to all gifting transaction payouts. For example: if a creator earns 1,000 Points from gifts, 200 Points (20%) are retained as platform commission, and the creator receives 800 Points (equivalent to 80 ETB) via telebirr."
  },
  {
    q: "Can I convert my Points back into Coins?",
    a: "Yes. The swap rate is 1 Point = 1 Coin. You can use earned Points to purchase more Coins for in-app spending instead of cashing out."
  },
  {
    q: "What is a Flip and how do I upload one?",
    a: "A Flip is a short video (15–120 seconds depending on your tier) or a photo that you upload to the platform. Tap the '+' button (mobile) or '+ New Flip' button (web), select or record your content, add a caption and hashtags, optionally link it to a campaign, and tap 'Post'."
  },
  {
    q: "How long can my videos be?",
    a: "Standard subscribers: 15 to 60 seconds. Coin buyers (On-Demand / Premium): up to 90–120 seconds."
  },
  {
    q: "What are the competition tiers and prizes?",
    a: "Daily Sprint (50 winners): 1 GB Daily Data — credited within 24 hours. Weekly Battle (10 winners): 1,000 ETB via telebirr — sent within 10 days. Monthly Star (5 winners): 10,000 ETB via telebirr — sent within 10 days. Grand Final — 1st place (Legend): 500,000 ETB. Grand Final — 2nd place (Icon): 300,000 ETB. Grand Final — 3rd place (Spark): 200,000 ETB. All Grand Final prizes sent via telebirr within 20 days of the 6-month campaign close."
  },
  {
    q: "How is my competition score calculated?",
    a: "Score = (Votes × 1) + (Comments × 2) + (Shares × 5) + (Gifts × 10). The user with the highest Engagement Score at the end of each competition period wins that tier."
  },
  {
    q: "Can I win multiple prizes?",
    a: "Yes, with rules. After winning a tier (e.g. Daily Sprint), you are ineligible to win that same tier again for 30 days but can still win other tiers. The Grand Final has a separate 6-month cooldown: if you win any Grand Final prize (1st, 2nd, or 3rd), you are ineligible to compete for any Grand Final prize for 6 months. You remain fully eligible for Daily, Weekly, and Monthly competitions during this period."
  },
  {
    q: "How do I claim my prize?",
    a: "Cash prizes (ETB): sent automatically via telebirr to your registered mobile number. Daily Data prizes: credited directly to your Ethio telecom account within 24 hours. Grand Final prizes: our team will contact you — you must present a valid National ID or passport. All prizes must be claimed within 30 days of notification. Unclaimed prizes are awarded to the next eligible runner-up."
  },
  {
    q: "Is there a daily limit on voting or gifting for one creator?",
    a: "Yes. Voting Cap: a single user can contribute a maximum of 5,000 Score Points (equivalent to 500 Coins) per day to any one specific creator's leaderboard score. Point Transfer Cap: up to 20,000 Points total can be transferred (gifted) to a single creator within a 24-hour rolling window. Total outbound cap: 44,500 Points per day across all creators."
  },
  {
    q: "Do boosted views count toward my leaderboard score?",
    a: "No. Views and impressions generated through paid content boosts do not count toward your organic Engagement Score. Only genuine, unboosted engagement contributes to your score."
  },
  {
    q: "Are there internet data charges for using FlipStar?",
    a: "Yes. Accessing FlipStar via the app or the web portal uses your regular Ethio telecom data plan. You are responsible for any data charges incurred."
  },
  {
    q: "Is my personal data safe?",
    a: "Yes. FlipStar is hosted exclusively on the Ethio telecom InfraCloud within Ethiopia — all your data stays in the country. Your phone number is stored in encrypted form and is never displayed publicly. All personal metadata (GPS, device info) is automatically removed from every Flip you upload before it is stored or published."
  },
  {
    q: "Can Ethio telecom change the Terms or cancel the service?",
    a: "Yes. Ethio telecom reserves the right to modify, suspend, or terminate the FlipStar service or these Terms at any time, in accordance with applicable Ethiopian laws. Any changes will be published at https://flipstar.et."
  },
  {
    q: "How do I contact support?",
    a: "In-App: Profile → Help & Support → Contact Us • SMS: 9286 • Website: https://www.ethiotelecom.et/ • Email (Ethio telecom): 994@ethionet.et • WhatsApp: +251 99 400 0000 • Telegram: https://t.me/ethio_telecom"
  },
];

function SettingRow({ icon, label, subtitle, value, onPress, isSwitch, switchValue, onSwitch, danger, chevron = true, iconColor, iconBg, colors }) {
  const bg = iconBg || (danger ? (colors.error + '22') : (colors.primary + '18'));
  const ic = iconColor || (danger ? colors.error : colors.primary);
  return (
    <TouchableOpacity style={[styles.row, { borderBottomColor: colors.border + '60' }]} onPress={onPress} disabled={isSwitch} activeOpacity={0.7}>
      <View style={[styles.rowIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={ic} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowLabel, { color: danger ? colors.error : colors.text }]}>{label}</Text>
        {subtitle && <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {value && <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{value}</Text>}
        {isSwitch && <Switch value={switchValue} onValueChange={onSwitch} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />}
        {!isSwitch && chevron && <Ionicons name="chevron-forward" size={17} color={colors.textSecondary + '80'} />}
      </View>
    </TouchableOpacity>
  );
}

function Section({ title, children, colors }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

function SectionLabel({ icon, children, colors }) {
  return (
    <View style={styles.sectionLabelContainer}>
      {icon && (
        <View style={[styles.sectionLabelIconWrap, { backgroundColor: colors.primary + '18' }]}>
          <Ionicons name={icon} size={13} color={colors.primary} />
        </View>
      )}
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{children}</Text>
    </View>
  );
}

function SectionCard({ children, colors, danger }) {
  return (
    <View style={[
      styles.sectionCard, 
      { 
        backgroundColor: colors.cardBg, 
        borderColor: danger ? 'rgba(239, 68, 68, 0.35)' : colors.border,
      }
    ]}>
      {children}
    </View>
  );
}

function BeautifulModal({ visible, onClose, title, children, height = '70%', colors, keyboardAware = false }) {
  if (!visible) return null;

  const Wrapper = keyboardAware ? KeyboardAvoidingView : View;
  const wrapperProps = keyboardAware
    ? {
        behavior: Platform.OS === 'ios' ? 'padding' : 'height',
        keyboardVerticalOffset: Platform.OS === 'ios' ? 24 : 0,
      }
    : {};
  
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Wrapper style={styles.beautifulModalOverlay} {...wrapperProps}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <TouchableOpacity 
          style={[styles.beautifulModal, { height, backgroundColor: colors.cardBg, borderColor: colors.border }]} 
          activeOpacity={1}
          onPress={e => e.stopPropagation()}
        >
          {/* Modal Header */}
          <View style={[styles.beautifulModalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.beautifulModalTitle, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity 
              style={[styles.beautifulModalCloseButton, { backgroundColor: colors.border + '40' }]}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          
          {/* Modal Content */}
          <View style={styles.beautifulModalContent}>
            {children}
          </View>
        </TouchableOpacity>
      </Wrapper>
    </Modal>
  );
}

export default function SettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { colors, darkMode, toggleDarkMode } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  
  const [notifications, setNotifications] = useState(() => {
    return {
      likes: true,
      comments: true,
      follows: true,
      messages: true,
    };
  });
  
  const [privacy, setPrivacy] = useState(() => {
    return {
      privateAccount: false,
      showActivity: true,
      allowMessages: true,
    };
  });
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  
  const [showPassModal, setShowPassModal] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsType, setTermsType] = useState('terms'); // 'terms' or 'privacy'
  const [faqOpen, setFaqOpen] = useState(null);
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });
  
  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });

  const [profileData, setProfileData] = useState(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Fetch full profile on mount to guarantee fresh phone number and verified status
  useEffect(() => {
    let isMounted = true;
    api.getProfile().then(data => {
      if (isMounted && data) {
        setProfileData(data);
      }
    }).catch(() => {});
    return () => { isMounted = false; };
  }, []);

  // Format phone number cleanly (+251 9... / Ethio telecom format)
  const displayPhone = useMemo(() => {
    const raw = 
      profileData?.phone_number ||
      profileData?.phone ||
      user?.phone_number ||
      user?.phone ||
      user?.user?.phone_number ||
      user?.user?.phone ||
      (user?.username && /^(?:\+251|09|07|\d{9,12})/.test(user?.username) ? user?.username : null);

    if (!raw) return null;
    const clean = String(raw).trim();
    if (/^(\+?251|0)?(9|7)\d{8}$/.test(clean)) {
      let digits = clean.replace(/^\+/, '');
      if (digits.startsWith('0')) {
        digits = '251' + digits.slice(1);
      } else if (!digits.startsWith('251')) {
        digits = '251' + digits;
      }
      return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    }
    return clean;
  }, [profileData, user]);

  // Load settings from AsyncStorage and backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load notification settings from backend
        try {
          const notifData = await api.getNotificationSettings();
          if (notifData) {
            setNotifications({
              likes: notifData.likes ?? true,
              comments: notifData.comments ?? true,
              follows: notifData.follows ?? true,
              messages: notifData.messages ?? true,
            });
          }
        } catch (e) {
          // Fallback to AsyncStorage if backend fails
          const notifData = await AsyncStorage.getItem('notifications');
          if (notifData) setNotifications(JSON.parse(notifData));
        }
        
        // Load privacy settings from backend
        try {
          const privacyData = await api.getPrivacySettings();
          if (privacyData) {
            setPrivacy({
              privateAccount: privacyData.privateAccount ?? false,
              showActivity: privacyData.showActivity ?? true,
              allowMessages: privacyData.allowMessages ?? true,
            });
          }
        } catch (e) {
          // Fallback to AsyncStorage if backend fails
          const privacyData = await AsyncStorage.getItem('privacy');
          if (privacyData) setPrivacy(JSON.parse(privacyData));
        }
      } catch {}
    };
    loadSettings();

    // Load blocked users
    const loadBlockedUsers = async () => {
      try {
        setLoadingBlocked(true);
        const data = await api.getBlockedUsers();
        const users = Array.isArray(data) ? data : (data.results || []);
        setBlockedUsers(users.map(b => b.blocked));
      } catch {
        // backend may not support this endpoint
      } finally {
        setLoadingBlocked(false);
      }
    };
    loadBlockedUsers();
  }, []);

  // Save settings to AsyncStorage whenever they change
  useEffect(() => {
    AsyncStorage.setItem('notifications', JSON.stringify(notifications)).catch(() => {});
  }, [notifications]);

  useEffect(() => {
    AsyncStorage.setItem('privacy', JSON.stringify(privacy)).catch(() => {});
  }, [privacy]);

  const handleNotificationToggle = async (key) => {
    const newVal = !notifications[key];
    const next = { ...notifications, [key]: newVal };
    setNotifications(next);
    
    // Sync with backend
    try {
      await api.updateNotificationSettings({ [key]: newVal });
      console.log(`Updated ${key} notification setting to:`, newVal);
    } catch (error) {
      console.error('Failed to update notification settings:', error);
      // Revert on error
      setNotifications({ ...notifications, [key]: !newVal });
      Alert.alert('Error', 'Failed to update notification settings');
    }
  };

  const handlePrivacyToggle = async (key) => {
    const newVal = !privacy[key];
    const next = { ...privacy, [key]: newVal };
    setPrivacy(next);
    
    // Map frontend keys to backend keys
    const backendKeyMap = {
      privateAccount: 'privateAccount',
      showActivity: 'showActivity', 
      allowMessages: 'allowMessages',
    };
    
    // Sync with backend
    try {
      await api.updatePrivacySettings({ [backendKeyMap[key]]: newVal });
    } catch (error) {
      // Revert on error
      setPrivacy({ ...privacy, [key]: !newVal });
      Alert.alert('Error', 'Failed to update privacy settings');
    }
  };

  const handleDarkModeToggle = () => {
    toggleDarkMode();
  };

  const handleLanguageChange = (langId) => {
    setLanguage(langId);
    setShowLangModal(false);
    Alert.alert('Language Changed', `Language has been changed to ${languages.find(l => l.id === langId)?.label}`);
  };

  const handleResetSuggestions = async () => {
    Alert.alert(
      'Reset Suggested Content',
      'This will clear your recommendation history and start fresh. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear dismissed users from AsyncStorage
              await AsyncStorage.removeItem('dismissedSuggestions');
              // Clear any other suggestion-related data
              await AsyncStorage.removeItem('suggestionHistory');
              Alert.alert('Success', 'Your suggested content has been reset');
            } catch (error) {
              Alert.alert('Error', 'Failed to reset suggestions');
            }
          }
        }
      ]
    );
  };

  const handlePasswordChange = async () => {
    if (!password.current) {
      Alert.alert('Error', 'Please enter your current PIN');
      return;
    }
    if (password.new !== password.confirm) {
      Alert.alert('Error', 'PINs do not match');
      return;
    }
    if (!/^\d{6}$/.test(password.new)) {
      Alert.alert('Error', 'PIN must be exactly 6 digits');
      return;
    }
    
    try {
      console.log('Attempting to change PIN...');
      const response = await api.changePassword(password.current, password.new);
      
      console.log('PIN change response:', response);
      setPassword({ current: '', new: '', confirm: '' });
      setShowPassModal(false);
      Alert.alert('Success', 'PIN changed successfully. Please login again.', [
        { text: 'OK', onPress: () => logout() }
      ]);
    } catch (error) {
      console.error('PIN change error:', error);
      const errMsg = error?.message || 'Failed to change PIN';
      if (errMsg.includes('Current password is incorrect')) {
        Alert.alert('Error', 'Current PIN is incorrect');
      } else {
        Alert.alert('Error', errMsg);
      }
    }
  };

  
  
  const handleUnblockUser = async (userId, username) => {
    try {
      await api.unblockUser(userId);
      setBlockedUsers(prev => prev.filter(u => u.id !== userId));
      Alert.alert('Success', `Unblocked ${username}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to unblock user');
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const languages = [
    { id: 'en', label: 'English' },
  ];

  
  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      {/* Ambient background decorative glow */}
      <View style={styles.ambientTopGlow} pointerEvents="none" />
      <View style={styles.ambientBottomGlow} pointerEvents="none" />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.backButton, { backgroundColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} 
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings')}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Account & Preferences</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* VIP Profile Showcase Card */}
        <View style={[styles.profileShowcaseCard, { backgroundColor: darkMode ? '#15191E' : '#FFFFFF', borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]}>
          <LinearGradient
            colors={darkMode ? ['rgba(143,196,65,0.18)', 'rgba(20,24,30,0.0)'] : ['rgba(143,196,65,0.25)', 'rgba(240,243,246,0.0)']}
            style={styles.profileShowcaseBanner}
          />
          
          <View style={styles.profileShowcaseTopRow}>
            {/* Avatar with Glow Ring */}
            <View style={styles.avatarGlowContainer}>
              <View style={[styles.avatarGlowOuter, { borderColor: colors.primary }]}>
                {user?.profile_photo || profileData?.profile_photo ? (
                  <Image source={{ uri: user?.profile_photo || profileData?.profile_photo }} style={styles.showcaseAvatarImg} />
                ) : (
                  <View style={[styles.showcaseAvatarFallback, { backgroundColor: colors.primary }]}>
                    <Text style={styles.showcaseAvatarText}>
                      {(user?.username || profileData?.username || 'U')[0]?.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.avatarOnlineBadge}>
                <Ionicons name="checkmark" size={10} color="#000" />
              </View>
            </View>

            {/* User Meta */}
            <View style={{ flex: 1, marginLeft: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.showcaseName, { color: colors.text }]} numberOfLines={1}>
                  @{user?.username || profileData?.username || 'user'}
                </Text>
                <Ionicons name="checkmark-circle" size={18} color="#8fc441" />
              </View>

              {user?.email ? (
                <Text style={[styles.showcaseEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}

              {/* Decorative Verified Phone Chip */}
              {displayPhone ? (
                <View style={styles.phoneChip}>
                  <Ionicons name="call" size={12} color="#8fc441" />
                  <Text style={styles.phoneChipText}>{displayPhone}</Text>
                  <View style={styles.phoneVerifiedDot} />
                </View>
              ) : null}
            </View>
          </View>

          {/* Action Row on Profile Card */}
          <View style={[styles.showcaseActionRow, { borderTopColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
            <View style={styles.statusBadge}>
              <Ionicons name="sparkles" size={13} color="#8fc441" />
              <Text style={styles.statusBadgeText}>Ethio Telecom Verified</Text>
            </View>
            <TouchableOpacity 
              style={[styles.editProfileBtn, { backgroundColor: colors.primary + '1F', borderColor: colors.primary + '40' }]}
              onPress={() => navigation.navigate('EditProfile')}
            >
              <Ionicons name="pencil-outline" size={14} color={colors.primary} />
              <Text style={[styles.editProfileBtnText, { color: colors.primary }]}>{t('editProfile')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Account */}
        <SectionLabel icon="person-circle-outline" colors={colors}>{t('account')}</SectionLabel>
        <SectionCard colors={colors}>
          <SettingRow icon="person-outline" iconColor="#6366F1" iconBg="rgba(99, 102, 241, 0.14)" label={t('editProfile')} subtitle="Update your personal details & bio" onPress={() => navigation.navigate('EditProfile')} colors={colors} />
          <SettingRow icon="wallet-outline" iconColor="#F59E0B" iconBg="rgba(245, 158, 11, 0.14)" label={t('wallet')} subtitle="Balance, coins, transactions & payout" onPress={() => navigation.navigate('Wallet')} colors={colors} />
          <SettingRow icon="ribbon-outline" iconColor="#8fc441" iconBg="rgba(143, 196, 65, 0.14)" label={t('subscription')} subtitle="telebirr VIP membership & benefits" onPress={() => navigation.navigate('Subscription')} colors={colors} />
          <SettingRow icon="key-outline" iconColor="#06B6D4" iconBg="rgba(6, 182, 212, 0.14)" label={t('changePassword')} subtitle="Manage your secure 6-digit PIN" onPress={() => setShowPassModal(true)} colors={colors} />
        </SectionCard>

        {/* Notifications */}
        <SectionLabel icon="notifications-outline" colors={colors}>{t('notifications')}</SectionLabel>
        <SectionCard colors={colors}>
          <SettingRow icon="heart-outline" iconColor="#EC4899" iconBg="rgba(236, 72, 153, 0.14)" label={t('likes')} isSwitch switchValue={notifications.likes} onSwitch={() => handleNotificationToggle('likes')} colors={colors} />
          <SettingRow icon="chatbubble-ellipses-outline" iconColor="#3B82F6" iconBg="rgba(59, 130, 246, 0.14)" label={t('comments')} isSwitch switchValue={notifications.comments} onSwitch={() => handleNotificationToggle('comments')} colors={colors} />
          <SettingRow icon="people-outline" iconColor="#8B5CF6" iconBg="rgba(139, 92, 246, 0.14)" label={t('follows')} isSwitch switchValue={notifications.follows} onSwitch={() => handleNotificationToggle('follows')} colors={colors} />
          <SettingRow icon="mail-outline" iconColor="#10B981" iconBg="rgba(16, 185, 129, 0.14)" label={t('messages')} isSwitch switchValue={notifications.messages} onSwitch={() => handleNotificationToggle('messages')} colors={colors} />
        </SectionCard>

        {/* Privacy */}
        <SectionLabel icon="shield-checkmark-outline" colors={colors}>{t('privacy')}</SectionLabel>
        <SectionCard colors={colors}>
          <SettingRow icon="lock-closed-outline" iconColor="#F97316" iconBg="rgba(249, 115, 22, 0.14)" label={t('privateAccount')} subtitle="Only approved followers can see your Flips" isSwitch switchValue={privacy.privateAccount} onSwitch={() => handlePrivacyToggle('privateAccount')} colors={colors} />
          <SettingRow icon="pulse-outline" iconColor="#14B8A6" iconBg="rgba(20, 184, 166, 0.14)" label={t('showActivity')} subtitle="Show when you're online to others" isSwitch switchValue={privacy.showActivity} onSwitch={() => handlePrivacyToggle('showActivity')} colors={colors} />
          <SettingRow icon="chatbox-ellipses-outline" iconColor="#3B82F6" iconBg="rgba(59, 130, 246, 0.14)" label={t('allowMessages')} subtitle="Receive direct messages from creators" isSwitch switchValue={privacy.allowMessages} onSwitch={() => handlePrivacyToggle('allowMessages')} colors={colors} />
          <SettingRow icon="shield-half-outline" iconColor="#8B5CF6" iconBg="rgba(139, 92, 246, 0.14)" label="Consent Dashboard" onPress={() => navigation.navigate('ConsentDashboard')} colors={colors} />
          <SettingRow icon="cloud-download-outline" iconColor="#06B6D4" iconBg="rgba(6, 182, 212, 0.14)" label="Export My Data" onPress={() => navigation.navigate('DataExportScreen')} colors={colors} />
          <SettingRow icon="document-text-outline" iconColor="#64748B" iconBg="rgba(100, 116, 139, 0.14)" label="EU Privacy Rights" onPress={() => navigation.navigate('EURightsScreen')} colors={colors} />
          <SettingRow icon="refresh-outline" iconColor="#EAB308" iconBg="rgba(234, 179, 8, 0.14)" label={t('resetSuggestions')} onPress={handleResetSuggestions} colors={colors} />
        </SectionCard>

        {/* Appearance */}
        <SectionLabel icon="color-palette-outline" colors={colors}>{t('appearance')}</SectionLabel>
        <SectionCard colors={colors}>
          <SettingRow icon={darkMode ? "moon" : "sunny"} iconColor="#F59E0B" iconBg="rgba(245, 158, 11, 0.14)" label={t('darkMode')} isSwitch switchValue={darkMode} onSwitch={handleDarkModeToggle} colors={colors} />
          <SettingRow icon="globe-outline" iconColor="#3B82F6" iconBg="rgba(59, 130, 246, 0.14)" label={t('language')} value="English" onPress={() => setShowLangModal(true)} colors={colors} />
        </SectionCard>

        {/* FAQ */}
        <SectionLabel icon="help-circle-outline" colors={colors}>FAQ & Community</SectionLabel>
        <SectionCard colors={colors}>
          <SettingRow icon="help-outline" iconColor="#A855F7" iconBg="rgba(168, 85, 247, 0.14)" label="Frequently Asked Questions" subtitle="Learn about rewards, gifts & coins" onPress={() => setShowFaqModal(true)} colors={colors} />
        </SectionCard>

        {/* Help */}
        <SectionLabel icon="information-circle-outline" colors={colors}>{t('help')}</SectionLabel>
        <SectionCard colors={colors}>
          <SettingRow icon="headset-outline" iconColor="#10B981" iconBg="rgba(16, 185, 129, 0.14)" label={t('helpCenter')} subtitle="Ethio telecom 994 & Telegram support" onPress={() => Alert.alert('Help Center', 'For support:\n\nIn-App: Profile → Help & Support\nSMS: 9286\nEmail: 994@ethionet.et\nWhatsApp: +251 99 400 0000\nTelegram: https://t.me/ethio_telecom\nWebsite: https://www.ethiotelecom.et/')} colors={colors} />
          <SettingRow icon="shield-checkmark-outline" iconColor="#0EA5E9" iconBg="rgba(14, 165, 233, 0.14)" label={t('privacyPolicy')} onPress={() => navigation.navigate('PrivacyPolicyScreen')} colors={colors} />
          <SettingRow icon="reader-outline" iconColor="#F59E0B" iconBg="rgba(245, 158, 11, 0.14)" label={t('termsOfService')} onPress={() => { setTermsType('terms'); setShowTermsModal(true); }} colors={colors} />
        </SectionCard>

        {/* Danger Zone */}
        <SectionLabel icon="warning-outline" colors={colors}>{t('dangerZone')}</SectionLabel>
        <SectionCard colors={colors} danger>
          <SettingRow icon="trash-bin-outline" iconColor="#EF4444" iconBg="rgba(239, 68, 68, 0.14)" label={t('deleteAccount')} subtitle="Permanently delete profile and data" onPress={() => navigation.navigate('AccountDeletionScreen')} danger colors={colors} />
        </SectionCard>

        {/* Blocked Users */}
        <SectionLabel icon="ban-outline" colors={colors}>{t('blockedUsers')}</SectionLabel>
        <SectionCard colors={colors}>
          {loadingBlocked ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : blockedUsers.length === 0 ? (
            <Text style={{ color: colors.textSecondary, fontSize: 14, padding: 20, textAlign: 'center' }}>No blocked users</Text>
          ) : (
            blockedUsers.map(blockedUser => (
              <View key={blockedUser.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border + '80' }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                  {blockedUser.profile_photo ? (
                    <Image source={{ uri: blockedUser.profile_photo }} style={{ width: '100%', height: '100%' }} />
                  ) : (
                    <Ionicons name="person" size={16} color={colors.textSecondary} />
                  )}
                </View>
                <Text style={{ flex: 1, marginLeft: 12, color: colors.text, fontSize: 15 }}>{blockedUser.username}</Text>
                <TouchableOpacity onPress={() => handleUnblockUser(blockedUser.id, blockedUser.username)}>
                  <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>Unblock</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </SectionCard>

        {/* Decorative Logout Button Card */}
        <TouchableOpacity 
          style={[styles.decorativeLogoutCard, { backgroundColor: darkMode ? '#1A1113' : '#FFF1F2', borderColor: darkMode ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.2)' }]} 
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <View style={styles.logoutCardIconBox}>
            <Ionicons name="log-out-outline" size={22} color="#EF4444" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.logoutCardTitle}>{t('logout') || 'Log Out'}</Text>
            <Text style={styles.logoutCardSubtitle}>
              {displayPhone ? `Signed in as ${displayPhone}` : 'End your session on this device'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#EF4444" />
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={[styles.version, { color: colors.textSecondary }]}>FlipStar by Ethio telecom • v1.0.0</Text>
        </View>
      </ScrollView>

      
      {/* Password Modal */}
      <BeautifulModal
        visible={showPassModal}
        onClose={() => setShowPassModal(false)}
        title={t('changePassword')}
        height="60%"
        keyboardAware
        colors={colors}
      >
        <View style={{ gap: 20 }}>
          <View style={styles.passwordField}>
            <Text style={[styles.passwordLabel, { color: colors.text }]}>{t('currentPassword')}</Text>
            <View style={[styles.passwordInputContainer, { borderColor: colors.border, backgroundColor: colors.bg }]}>
              <TextInput
                style={[styles.passwordInputWithIcon, { color: colors.text }]}
                secureTextEntry={!showPasswords.current}
                placeholder="Enter current 6-digit PIN"
                placeholderTextColor={colors.textSecondary}
                value={password.current}
                onChangeText={text => setPassword(prev => ({ ...prev, current: text.replace(/\D/g, '').slice(0, 6) }))}
                keyboardType="number-pad"
                maxLength={6}
              />
              <TouchableOpacity 
                onPress={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                style={styles.eyeIcon}
              >
                <Ionicons 
                  name={showPasswords.current ? "eye-off" : "eye"} 
                  size={20} 
                  color={colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.passwordField}>
            <Text style={[styles.passwordLabel, { color: colors.text }]}>{t('newPassword')}</Text>
            <View style={[styles.passwordInputContainer, { borderColor: colors.border, backgroundColor: colors.bg }]}>
              <TextInput
                style={[styles.passwordInputWithIcon, { color: colors.text }]}
                secureTextEntry={!showPasswords.new}
                placeholder="Enter new 6-digit PIN"
                placeholderTextColor={colors.textSecondary}
                value={password.new}
                onChangeText={text => setPassword(prev => ({ ...prev, new: text.replace(/\D/g, '').slice(0, 6) }))}
                keyboardType="number-pad"
                maxLength={6}
              />
              <TouchableOpacity 
                onPress={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                style={styles.eyeIcon}
              >
                <Ionicons 
                  name={showPasswords.new ? "eye-off" : "eye"} 
                  size={20} 
                  color={colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.passwordField}>
            <Text style={[styles.passwordLabel, { color: colors.text }]}>{t('confirmNewPassword')}</Text>
            <View style={[styles.passwordInputContainer, { borderColor: colors.border, backgroundColor: colors.bg }]}>
              <TextInput
                style={[styles.passwordInputWithIcon, { color: colors.text }]}
                secureTextEntry={!showPasswords.confirm}
                placeholder="Confirm new 6-digit PIN"
                placeholderTextColor={colors.textSecondary}
                value={password.confirm}
                onChangeText={text => setPassword(prev => ({ ...prev, confirm: text.replace(/\D/g, '').slice(0, 6) }))}
                keyboardType="number-pad"
                maxLength={6}
              />
              <TouchableOpacity 
                onPress={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                style={styles.eyeIcon}
              >
                <Ionicons 
                  name={showPasswords.confirm ? "eye-off" : "eye"} 
                  size={20} 
                  color={colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={[styles.beautifulUpdateButton, { backgroundColor: colors.primary }]} onPress={handlePasswordChange}>
            <Text style={[styles.updateButtonText, { color: darkMode ? '#000' : '#fff' }]}>{t('updatePassword')}</Text>
          </TouchableOpacity>
        </View>
      </BeautifulModal>

      {/* Language Modal */}
      <BeautifulModal
        visible={showLangModal}
        onClose={() => setShowLangModal(false)}
        title={t('chooseLanguage')}
        height="40%"
        colors={colors}
      >
        <View style={{ gap: 8 }}>
          {languages.map(l => (
            <TouchableOpacity
              key={l.id}
              onPress={() => handleLanguageChange(l.id)}
              style={[styles.languageOption, { backgroundColor: colors.bg, borderColor: colors.border }]}
            >
              <View style={styles.languageOptionContent}>
                <Text style={[styles.languageLabel, { color: language === l.id ? colors.primary : colors.text }]}>{l.label}</Text>
                {language === l.id && (
                  <View style={[styles.languageSelectedIndicator, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={16} color={darkMode ? '#000' : '#fff'} />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </BeautifulModal>

      {/* FAQ Modal */}
      <Modal visible={showFaqModal} animationType="slide" transparent onRequestClose={() => setShowFaqModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Frequently Asked Questions</Text>
              <TouchableOpacity onPress={() => setShowFaqModal(false)}>
                <Ionicons name="close" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {FAQ_ITEMS.map((item, i) => (
                <View key={i} style={styles.faqItem}>
                  <TouchableOpacity style={styles.faqQ} onPress={() => setFaqOpen(faqOpen === i ? null : i)}>
                    <Text style={styles.faqQText}>{item.q}</Text>
                    <Ionicons name={faqOpen === i ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
                  </TouchableOpacity>
                  {faqOpen === i && <Text style={styles.faqA}>{item.a}</Text>}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Terms Modal */}
      <Modal visible={showTermsModal} animationType="slide" transparent onRequestClose={() => setShowTermsModal(false)}>
        <View style={[styles.modalOverlay, { justifyContent: 'flex-start' }]}>
          <View style={[styles.modalSheet, { maxHeight: '100%', minHeight: '100%', borderRadius: 0, paddingTop: 48 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{termsType === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}</Text>
              <TouchableOpacity onPress={() => setShowTermsModal(false)}>
                <Ionicons name="close" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ padding: 4 }}>
              {/* Preamble */}
              <Text style={styles.para}>Please read these Terms and Conditions ("Terms") carefully before using the FlipStar service ("FlipStar", "the Service") provided by Ethio telecom and SkykinTechnologies PLC ("the Providers"). These Terms apply to all visitors, users, and others who access or use the Service via the FlipStar mobile application (Android and iOS) or web portal at https://flipstar.et.</Text>
              <Text style={styles.para}>By subscribing, downloading, installing, or otherwise accessing FlipStar, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you do not agree, do not use the Service.</Text>

              {/* 1 */}
              <Text style={styles.sectionTitle}>1. Introduction</Text>
              <Text style={styles.para}>FlipStar is a premium, subscription-based gamified social media platform developed for Ethio telecom customers. The platform enables users to create, share, and discover short-form videos and photos ('Flips'), participate in competitive campaigns, earn rewards, and engage in a digital creator economy powered by the telebirr wallet.</Text>
              <Text style={styles.para}>FlipStar is accessible via:</Text>
              <Text style={styles.bullet}>• Web Portal: https://flipstar.et</Text>
              <Text style={styles.bullet}>• Android App: Available on Google Play Store (search: FlipStar)</Text>
              <Text style={styles.bullet}>• iOS App: Available on Apple App Store (search: FlipStar)</Text>

              {/* 2 */}
              <Text style={styles.sectionTitle}>2. Service Overview</Text>
              <Text style={styles.bullet}>• FlipStar is available to all active Ethio telecom prepaid, postpaid, and hybrid mobile customers with a smartphone (Android, iOS) or web browser.</Text>
              <Text style={styles.bullet}>• The Service allows users to upload short-form videos (15–120 seconds depending on user tier) and photos, interact with content, participate in daily, weekly, monthly, and grand prize competitions, and earn and spend digital coins.</Text>
              <Text style={styles.bullet}>• To subscribe via SMS: send 1, 2, or 3 to the FlipStar shortcode. To unsubscribe: send STOP1, STOP2, or STOP3 to the same shortcode.</Text>
              <Text style={styles.bullet}>• To subscribe via app or web: download the FlipStar app or visit https://flipstar.et, select Sign Up, and follow the on-screen registration flow.</Text>

              {/* 3 */}
              <Text style={styles.sectionTitle}>3. Subscription and Billing</Text>
              <Text style={styles.subSectionTitle}>3.1 Subscription Plans</Text>
              <TermsTable
                headers={['Plan', 'Price', 'Billing Cycle', 'Notes']}
                flex={[1.1, 0.9, 1, 1.5]}
                rows={[
                  ['Flip Daily', '3 ETB', 'Every 24 hours', 'Charged daily. Auto-renewed while active.'],
                  ['Flip Weekly', '20 ETB', 'Every 7 days', 'Charged weekly. Auto-renewed while active.'],
                  ['Flip Monthly', '70 ETB', 'Every 30 days', 'Charged monthly. Auto-renewed while active.'],
                  ['Flip On-Demand', '10 ETB / 100 Coins', 'One-time purchase', 'Coins purchased on demand. No recurring charge.'],
                ]}
              />
              <Text style={styles.subSectionTitle}>3.2 SMS Subscription and Unsubscription Keywords</Text>
              <TermsTable
                headers={['Action', 'Accepted Keywords', 'Effect']}
                flex={[1, 1.5, 2]}
                rows={[
                  ['Subscribe', '1, 2, 3', 'Any of these keywords sent to the FlipStar shortcode will initiate a new subscription. All three keywords are equivalent and activate the same service.'],
                  ['Unsubscribe', 'STOP1, STOP2, STOP3', 'Any of these keywords sent to the FlipStar shortcode will immediately cancel the active subscription. A confirmation SMS will be sent upon successful unsubscription.'],
                ]}
              />
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>ⓘ SMS Keyword Note: All subscription and unsubscription keywords are case-insensitive (e.g. 'ok1' and 'OK1' are treated identically). Sending any of the subscribe keywords while already subscribed will return a confirmation of your existing subscription status. Sending any of the unsubscribe keywords while not subscribed will return an informational response with no charge.</Text>
              </View>
              <Text style={styles.subSectionTitle}>3.3 telebirr Subscription and Unsubscription</Text>
              <TermsTable
                headers={['Action', 'Accepted Actions', 'Effect']}
                flex={[0.8, 1.2, 2]}
                rows={[
                  ['Subscribe', 'Subscribe', 'Open the telebirr app, navigate to the FlipStar service page, and select Subscribe to initiate a new subscription.'],
                  ['Unsubscribe', 'Unsubscribe', 'Open the telebirr app, navigate to the FlipStar service page, and select Unsubscribe to immediately cancel the active subscription. A confirmation SMS will be sent.'],
                ]}
              />
              <Text style={styles.subSectionTitle}>3.4 Eligibility</Text>
              <Text style={styles.bullet}>• All active prepaid, postpaid, and hybrid Ethio telecom mobile customers are eligible to subscribe.</Text>
              <Text style={styles.bullet}>• The subscriber's service number must be in 'Active' status at the time of subscription.</Text>
              <Text style={styles.subSectionTitle}>3.6 Charging Logic</Text>
              <Text style={styles.bullet}>• Prepaid customers: Subscription fees are deducted from the current airtime balance.</Text>
              <Text style={styles.bullet}>• Postpaid customers: Subscription fees are added to the monthly bill.</Text>
              <Text style={styles.bullet}>• Hybrid customers: Fees are charged from the default account.</Text>
              <Text style={styles.bullet}>• A maximum of one subscription charge per 24-hour cycle applies.</Text>
              <Text style={styles.bullet}>• Failed billing attempts will be retried automatically per Ethio telecom Main Account (MA) time standards, or if the customer recharges their balance within the same day.</Text>
              <Text style={styles.bullet}>• The service will be activated automatically after a successful subscription or payment.</Text>
              <Text style={styles.subSectionTitle}>3.7 Auto-Renewal</Text>
              <Text style={styles.bullet}>• FlipStar subscriptions auto-renew at the end of each billing cycle if the subscriber has sufficient balance.</Text>
              <Text style={styles.bullet}>• Upon successful renewal, the subscriber will receive an SMS notification confirming the renewal and extended service period.</Text>
              <Text style={styles.bullet}>• If auto-renewal fails due to insufficient balance, service access may be suspended until the next successful charge or manual resubscription.</Text>
              <Text style={styles.subSectionTitle}>3.8 Unsubscription</Text>
              <Text style={styles.bullet}>• To unsubscribe via SMS, send STOP1, STOP2, or STOP3 to the FlipStar shortcode. All three keywords have identical effect.</Text>
              <Text style={styles.bullet}>• To unsubscribe via app or web, or via telebirr: use the unsubscription option within the app, web portal under Account Settings, or via the FlipStar service page in the telebirr app.</Text>
              <Text style={styles.bullet}>• Unsubscription requests are processed immediately.</Text>
              <Text style={styles.bullet}>• A subscriber is considered active until they explicitly unsubscribe. Once cancelled, the user must re-subscribe to regain access to premium features.</Text>
              <Text style={styles.bullet}>• Coins and digital assets earned or purchased prior to unsubscription remain valid for 30 days and are restored upon re-subscription within that period if not expired.</Text>
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>ⓘ SMS Notifications: You will receive an automatic SMS notification for: successful subscription, successful unsubscription, and each auto-renewal.</Text>
              </View>

              {/* 4 */}
              <Text style={styles.sectionTitle}>4. Accounts</Text>
              <Text style={styles.bullet}>• Once you subscribe via SMS or complete registration via the app or web portal, FlipStar will automatically create an account using your Ethio telecom mobile number as your unique account identifier.</Text>
              <Text style={styles.bullet}>• By accessing the service, you agree to be solely responsible for all activities that occur under your account and mobile number.</Text>
              <Text style={styles.bullet}>• You agree to provide true, current, and complete information during registration and at all times during your use of the service.</Text>
              <Text style={styles.bullet}>• Only one active account per mobile number is permitted.</Text>

              {/* 5 */}
              <Text style={styles.sectionTitle}>5. Digital Coins, Points, and the Creator Economy</Text>
              <Text style={styles.subSectionTitle}>5.1 Coins Overview</Text>
              <Text style={styles.para}>FlipStar operates a digital coin system that powers the platform's creator economy. Coins are the platform's internal currency used for content interaction, gifting, and access to premium features.</Text>
              <TermsTable
                headers={['Action', 'Rate / Rule']}
                flex={[1, 2]}
                rows={[
                  ['On-Demand Purchase coins', '10 ETB = 100 Coins. Purchased via telebirr or Airtime. No commission at purchase.'],
                  ['Daily login bonus', '3 Coins per day for opening the FlipStar app.'],
                  ['Weekly loyalty bonus', '50 Coins bonus for consistent daily usage for a full week.'],
                  ['Monthly loyalty bonus', '150 Coins bonus for consistent daily usage for a full month. Credited on the last day of the subscription month if all daily logins are recorded.'],
                  ['Gift a creator', 'Convert Coins into virtual Gifts sent to other users\' content.'],
                  ['Creator earns Points', 'Creator receives 100% of the Gift Value as Points (1 Coin gifted = 1 Point earned).'],
                  ['Cash out Points', '10 Points = 0.8 ETB (20% platform commission applied at payout).'],
                  ['Re-invest Points', '1 Point = 1 Coin (swap earned Points back to Coins for in-app spending).'],
                  ['Minimum cash-out threshold', '1,000 Points (equivalent to 80 ETB net after commission) required to trigger a telebirr payout.'],
                ]}
              />
                <Text style={styles.subSectionTitle}>5.2 Wallet Impact Matrix</Text>
              <Text style={styles.para}>The table below summarises how each engagement action affects the three parties in the FlipStar economy. Only gifting triggers a real coin movement; all other actions generate score or non-monetary value only.</Text>
              <TermsTable
                headers={['Action', 'Fan Wallet', 'Creator Wallet', 'Platform', 'Score Impact']}
                flex={[0.8, 1, 1, 1.2, 1]}
                rows={[
                  ['Vote', '1 Coin', '+1 Score', 'No Impact (Data Gain)', '+1 Score'],
                  ['Comment', '2 Coins', '+2 Score', 'No Impact (Data Gain)', '+2 Score'],
                  ['Share', '5 Coins', '+5 Score', 'Marketing Gain', '+5 Score'],
                  ['Gift', 'Decrease (Coins)', 'Increase (Points)', 'Liability Transferred', '+10 Score'],
                ]}
              />
              <Text style={styles.subSectionTitle}>5.3 Gift Types and Point Values</Text>
              <TermsTable
                headers={['Gift Name', 'Cost per Unit (Coins)', 'Min Gift (per transaction)', 'Max Gift (per transaction)', 'Points to Creator', 'Max per Day (same creator)']}
                flex={[1, 1.2, 1.2, 1.2, 1, 1.2]}
                rows={[
                  ['Rose', '10 Coins', '10 Points (×1 unit)', '500 Points (×50 units)', '1 Point per Coin', '500 Points'],
                  ['Heart', '50 Coins', '50 Points (×1 unit)', '500 Points (×10 units)', '1 Point per Coin', '500 Points'],
                  ['Star', '100 Coins', '100 Points (×1 unit)', '500 Points (×5 units)', '1 Point per Coin', '500 Points'],
                  ['Teddy Bear', '200 Coins', '200 Points (×1 unit)', '1,000 Points (×5 units)', '1 Point per Coin', '2,000 Points'],
                  ['Diamond', '500 Coins', '500 Points (×1 unit)', '2,500 Points (×5 units)', '1 Point per Coin', '5,000 Points'],
                  ['Crown', '750 Coins', '750 Points (×1 unit)', '3,750 Points (×5 units)', '1 Point per Coin', '7,500 Points'],
                  ['Sports Car', '1,000 Coins', '1,000 Points (×1 unit)', '5,000 Points (×5 units)', '1 Point per Coin', '10,000 Points'],
                  ['Rocket', '2,000 Coins', '2,000 Points (×1 unit)', '10,000 Points (×5 units)', '1 Point per Coin', '20,000 Points'],
                ]}
              />
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>ⓘ Gift Daily Cap: A single user may contribute a combined maximum of 5,000 Score Points per day to any one specific creator across all gift types. This cap applies regardless of which gift types are used.</Text>
              </View>
              <Text style={styles.subSectionTitle}>5.4 Point Transfer Rules</Text>
              <TermsTable
                headers={['Transfer Rule', 'Limit', 'Applies To']}
                flex={[1.8, 1, 1.5]}
                rows={[
                  ['Minimum Points per transaction', '10 Points', 'Single gift or transfer action. Transactions below this threshold are rejected.'],
                  ['Maximum points per transaction', '10,000 Points', 'Single gift or transfer action. Transactions above this threshold are split or rejected.'],
                  ['Maximum points to one creator per day', '20,000 Points', 'Total points transferred to a single creator within a 24-hour rolling window (Voting Cap).'],
                  ['Maximum total points sent per user per day', '44,500 Points', 'Total outbound points from one account across all recipients within a 24-hour rolling window.'],
                  ['Maximum cash-out per request', '50,000 Points', 'Single telebirr withdrawal request. Larger balances require multiple separate withdrawal requests.'],
                  ['Minimum cash-out threshold', '1,000 Points', 'Minimum balance required before a telebirr payout can be initiated (equivalent to 80 ETB net after 20% commission).'],
                ]}
              />
              <Text style={styles.subSectionTitle}>5.5 Coin Rules</Text>
              <Text style={styles.bullet}>• Coins purchased via telebirr or Airtime have no expiry when actively used. Coins not used or converted within 30 days of purchase may expire.</Text>
              <Text style={styles.bullet}>• Points not withdrawn or converted within 180 days of account inactivity are forfeited.</Text>
              <Text style={styles.bullet}>• All coin purchases are non-refundable once processed.</Text>
              <Text style={styles.bullet}>• Coins earned via daily bonuses and loyalty rewards (as opposed to purchased coins) may not be cashed out — they may only be spent within the platform (gifting, boosts, etc.).</Text>
              <Text style={styles.bullet}>• A 20% platform commission is applied to all gifting transactions at the point of payout to a creator.</Text>
              <Text style={styles.bullet}>• The minimum withdrawal threshold is 1,000 Points (net payout: 80 ETB). Payouts are processed via telebirr.</Text>
              <Text style={styles.subSectionTitle}>5.6 Content Boosting (Coin-Powered)</Text>
              <TermsTable
                headers={['Boost Type', 'Cost (Coins)', 'Effect', 'Leaderboard Impact']}
                flex={[1, 0.8, 1.4, 1.5]}
                rows={[
                  ['Standard Boost', '100 Coins', 'Featured in \'Trending\' for 1 hour.', 'Boosted views do NOT count toward organic Leaderboard score.'],
                  ['Premium Boost', '500 Coins', 'Top of \'For You\' feed for 6 hours.', 'Boosted views do NOT count toward organic Leaderboard score.'],
                  ['Viral Boost', '1,000 Coins', '5,000 guaranteed impressions.', 'Boosted views do NOT count toward organic Leaderboard score.'],
                ]}
              />

              {/* 6 */}
              <Text style={styles.sectionTitle}>6. Content and Upload Rules</Text>
              <Text style={styles.subSectionTitle}>6.1 Upload Limits</Text>
              <TermsTable
                headers={['User Type', 'Video Upload Limit', 'Access Method']}
                flex={[1.2, 0.9, 1.5]}
                rows={[
                  ['Standard subscriber', '15 seconds – 60 seconds', 'Available to all active subscribers.'],
                  ['Coin buyer (On-Demand / Premium)', 'Up to 90–120 seconds', 'Unlocked by purchasing coins or on-demand packs.'],
                ]}
              />
              <Text style={styles.subSectionTitle}>6.2 User-Generated Content (UGC)</Text>
              <Text style={styles.bullet}>• By uploading content to FlipStar, you grant Ethio telecom and SkykinTechnologies PLC a non-exclusive, royalty-free, worldwide licence to host, store, reproduce, and promote your content within and in connection with the FlipStar platform.</Text>
              <Text style={styles.bullet}>• By participating in the service, you agree that your data (including name, initials, photos, and video images) may be used by Ethio telecom for promotional and advertising purposes at no charge and without requiring prior individual consent.</Text>
              <Text style={styles.bullet}>• All content uploaded for Weekly reward campaigns and above must pass AI and/or manual moderation for brand safety before becoming eligible for rewards.</Text>
              <Text style={styles.bullet}>• All personal metadata (GPS location, device information) is automatically removed from all uploaded Flips before storage and publication.</Text>
              <Text style={styles.subSectionTitle}>6.3 Prohibited Content and Behaviour</Text>
              <Text style={styles.bullet}>• Users must not upload content that is unlawful, harmful, threatening, abusive, defamatory, or otherwise objectionable under Ethiopian law.</Text>
              <Text style={styles.bullet}>• Botting, automated engagement, self-gifting, vote manipulation, or any attempt to artificially inflate scores or leaderboard rankings is strictly prohibited and results in immediate permanent account ban.</Text>
              <Text style={styles.bullet}>• A single user may contribute a maximum of 5,000 Score Points (equivalent to 500 Coins) per day to any one specific creator ('Voting Cap'). This rule exists to prevent pay-to-win manipulation.</Text>
              <Text style={styles.bullet}>• Ethio telecom and SkykinTechnologies PLC reserve the right to disqualify any participant found to have breached these Terms and to ban any user who engages in inappropriate behaviour.</Text>

              {/* 7 */}
              <Text style={styles.sectionTitle}>7. Competitions and Rewards</Text>
              <Text style={styles.subSectionTitle}>7.1 The Engagement Score Formula</Text>
              <Text style={styles.para}>Your position on the competition leaderboard is determined by your Engagement Index, calculated as follows:</Text>
              <View style={styles.formulaBox}>
                <Text style={styles.formulaText}>Score = (Votes × 1) + (Comments × 2) + (Shares × 5) + (Gift × 10)</Text>
              </View>
              <Text style={styles.para}>The user with the highest Engagement Score at the end of each competition period is declared the winner for that tier.</Text>
              <Text style={styles.subSectionTitle}>7.2 Competition Tiers and Prize Structure</Text>
              <TermsTable
                headers={['Competition Tier', 'Winner Count', 'Prize', 'Prize Delivery']}
                flex={[1.3, 0.8, 1.1, 1.5]}
                rows={[
                  ['Daily Sprint', '50 winners', '1 GB Daily Data', 'Credited to telebirr/account within 24 hours.'],
                  ['Weekly Battle', '10 winners', '1,000 ETB (via telebirr)', 'Sent via telebirr within 10 days of competition close.'],
                  ['Monthly Star', '5 winners', '10,000 ETB (via telebirr)', 'Sent via telebirr within 10 days of competition close.'],
                  ['Grand Final — 1st (Legend) [6-Month Campaign]', '1 winner', '500,000 ETB (via telebirr)', 'Sent via telebirr within 20 days of Grand Final campaign close (6-month campaign). Winner contacted by phone.'],
                  ['Grand Final — 2nd (Icon) [6-Month Campaign]', '1 winner', '300,000 ETB (via telebirr)', 'Sent via telebirr within 20 days of Grand Final campaign close (6-month campaign). Winner contacted by phone.'],
                  ['Grand Final — 3rd (Spark) [6-Month Campaign]', '1 winner', '200,000 ETB (via telebirr)', 'Sent via telebirr within 20 days of Grand Final campaign close (6-month campaign). Winner contacted by phone.'],
                ]}
              />
              <Text style={styles.subSectionTitle}>7.3 Winner Cooldown Rules</Text>
              <Text style={styles.bullet}>• Winners of a specific tier (Daily, Weekly, or Monthly) are ineligible to win that same tier again for 30 days from the date of winning.</Text>
              <Text style={styles.bullet}>• During the 30-day cooldown, winners remain fully eligible to compete for all other tiers.</Text>
              <Text style={styles.bullet}>• Eligibility for the same tier is automatically restored after 30 days.</Text>
              <Text style={styles.bullet}>• A single user may win Daily, Weekly, and Monthly rewards within the same 30-day period, provided each win is in a different tier.</Text>
              <Text style={styles.bullet}>• The Grand Final is a 6-month competition cycle. Grand Final winners (1st, 2nd, and 3rd place) are ineligible to compete for any Grand Final prize for a full 6 months from the date of their win. During this period, Grand Final winners remain fully eligible to compete in Daily, Weekly, and Monthly tiers.</Text>
              <Text style={styles.subSectionTitle}>7.4 Prize Redemption</Text>
              <Text style={styles.bullet}>• Cash prizes (ETB) will be sent via telebirr to the mobile number registered with the winning account.</Text>
              <Text style={styles.bullet}>• Daily Data prizes are credited directly to the winner's Ethio telecom account within 24 hours.</Text>
              <Text style={styles.bullet}>• Grand Final and non-cash prize winners will be contacted by Ethio telecom or SkykinTechnologies PLC representatives via the registered phone number.</Text>
              <Text style={styles.bullet}>• All winners must present a valid identification document (National ID card or valid passport) to receive non-cash prizes.</Text>
              <Text style={styles.bullet}>• Prizes may be received by an authorised representative upon written proxy confirmation from the winner, accompanied by valid identification of both parties.</Text>
              <Text style={styles.bullet}>• Unclaimed prizes expire after 30 days from the date of notification. Expired prizes are awarded to the next eligible runner-up.</Text>
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>ⓘ Grand Final Winner Note: If a winner of the Grand Final is found to have won a Grand Final prize previously using the same mobile number within the past 6 months, the prize will be awarded to the next eligible participant who has not yet received a Grand Final prize within the current 6-month campaign cycle.</Text>
              </View>

              {/* 8 */}
              <Text style={styles.sectionTitle}>8. Eligibility</Text>
              <Text style={styles.subSectionTitle}>8.1 Eligible Participants</Text>
              <Text style={styles.bullet}>• Individuals aged 18 years and above.</Text>
              <Text style={styles.bullet}>• Legal entities with duly authorised representatives.</Text>
              <Text style={styles.bullet}>• All active Ethio telecom prepaid, postpaid, and hybrid mobile customers.</Text>
              <Text style={styles.subSectionTitle}>8.2 Non-Eligible Participants</Text>
              <Text style={styles.bullet}>• Employees of Ethio telecom and all directly associated partner organisations are not eligible to participate in prize competitions.</Text>
              <Text style={styles.bullet}>• Any user found to have used automated tools (bots), multiple accounts, or any form of manipulation to influence competition results will be immediately and permanently disqualified and banned from the service.</Text>

              {/* 9 */}
              <Text style={styles.sectionTitle}>9. Data Usage Fees</Text>
              <Text style={styles.bullet}>• Accessing FlipStar via https://flipstar.et or the mobile app uses your regular Ethio telecom data plan.</Text>
              <Text style={styles.bullet}>• You are solely responsible for any internet access or data charges incurred from your mobile carrier in connection with using the FlipStar service.</Text>
              <Text style={styles.bullet}>• Ethio telecom is not responsible for data charges incurred as a result of using the FlipStar service.</Text>

              {/* 10 */}
              <Text style={styles.sectionTitle}>10. Service Updates</Text>
              <Text style={styles.bullet}>• For FlipStar to function properly, certain components may require updates from time to time. By accepting these Terms, you consent to the automatic installation of such updates.</Text>
              <Text style={styles.bullet}>• During system updates, ongoing transactions, digital coins, earned points, and accumulated data remain unaffected.</Text>
              <Text style={styles.bullet}>• Ethio telecom reserves the right to temporarily suspend the service for operational reasons. The service will be restored as soon as reasonably possible following any temporary suspension.</Text>

              {/* 11 */}
              <Text style={styles.sectionTitle}>11. Inactivity Policy</Text>
              <Text style={styles.bullet}>• Points not withdrawn or converted within 180 days of account inactivity are permanently forfeited.</Text>
              <Text style={styles.bullet}>• Coins remain valid for up to 30 days for unsubscribed users and are restored upon re-subscription within that period, provided they have not expired.</Text>
              <Text style={styles.bullet}>• Users are encouraged to log in daily to maintain activity, protect their earned assets, and qualify for daily, weekly, and monthly loyalty bonuses.</Text>

              {/* 12 */}
              <Text style={styles.sectionTitle}>12. Content Moderation</Text>
              <Text style={styles.bullet}>• FlipStar employs a hybrid AI and manual moderation system to review content for brand safety, legal compliance, and community standards.</Text>
              <Text style={styles.bullet}>• All content submitted for Weekly competitions and above must successfully pass moderation review before becoming eligible for rewards.</Text>
              <Text style={styles.bullet}>• Ethio telecom and SkykinTechnologies PLC reserve the right to remove any content that violates these Terms or applicable Ethiopian law without prior notice.</Text>

              {/* 13 */}
              <Text style={styles.sectionTitle}>13. Acceptance of Terms and Modifications</Text>
              <Text style={styles.bullet}>• By subscribing to or using the FlipStar service, you confirm that you have read, understood, and agreed to these Terms and Conditions.</Text>
              <Text style={styles.bullet}>• Ethio telecom reserves the right to cancel, amend, or modify these Terms and the service at any time. Any changes will be published at https://flipstar.et.</Text>
              <Text style={styles.bullet}>• By continuing to access or use the service after revised Terms become effective, you agree to be bound by the revised Terms. If you do not agree to the new Terms, you must stop using the service.</Text>
              <Text style={styles.bullet}>• These Terms shall remain in full force from the launch of the service until it is officially terminated, excluding temporary suspensions for operational reasons.</Text>

              {/* 14 */}
              <Text style={styles.sectionTitle}>14. Participants and Disqualification</Text>
              <Text style={styles.bullet}>• Ethio telecom reserves the right to disqualify any participant who appears to have breached any provision of these Terms.</Text>
              <Text style={styles.bullet}>• Customers participating in the service warrant that all information submitted is true, current, and complete.</Text>
              <Text style={styles.bullet}>• In the event of any dispute regarding these Terms, competition results, or any other matter relating to the service, the decision of Ethio telecom shall be final.</Text>

              {/* 15 */}
              <Text style={styles.sectionTitle}>15. Limitation of Liability</Text>
              <Text style={styles.bullet}>• Ethio telecom accepts no responsibility for errors, omissions, interruptions, defects, delays in operation or transmission, or communications failures that are not within its direct control.</Text>
              <Text style={styles.bullet}>• Ethio telecom is not responsible for problems or technical malfunctions of telephone networks, internet lines, computer systems, servers, or any combination thereof.</Text>
              <Text style={styles.bullet}>• Participants understand and agree that they participate in this service at their own risk and have not been coerced into participation.</Text>
              <Text style={styles.bullet}>• No claim relating to losses or injuries (including special, indirect, and consequential losses) shall be asserted against Ethio telecom, SkykinTechnologies PLC, their parent companies, affiliates, directors, officers, employees, or agents.</Text>

              {/* 16 */}
              <Text style={styles.sectionTitle}>16. Disclaimer of Warranties</Text>
              <Text style={styles.bullet}>• Ethio telecom makes no warranty, implied or express, that any part of the FlipStar service will be uninterrupted and error-free.</Text>
              <Text style={styles.bullet}>• The service is provided on an 'as is' basis. Users accept that technical disruptions may occur.</Text>

              {/* 17 */}
              <Text style={styles.sectionTitle}>17. Governing Law</Text>
              <Text style={styles.para}>In the event of any disagreement arising from the use of this service, participants may present their complaint to Ethio telecom. All disputes shall be resolved in accordance with the laws of the Federal Democratic Republic of Ethiopia (FDRE).</Text>

              {/* 18 */}
              <Text style={styles.sectionTitle}>18. Contact Information</Text>
              <TermsTable
                headers={['Channel', 'Contact Detail']}
                flex={[1, 1.8]}
                rows={[
                  ['In-App Support', 'Profile → Help & Support → Contact Us'],
                  ['SMS', '9286'],
                  ['Website', 'https://www.ethiotelecom.et/'],
                  ['Email (Ethio telecom)', '994@ethionet.et'],
                  ['WhatsApp', '+251 99 400 0000'],
                  ['Telegram', 'https://t.me/ethio_telecom'],
                ]}
              />

              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Decorative Logout Confirmation Modal */}
      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => !loggingOut && setShowLogoutModal(false)}
      >
        <View style={styles.logoutModalOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            activeOpacity={1} 
            onPress={() => !loggingOut && setShowLogoutModal(false)} 
          />
          <View style={[
            styles.logoutModalCard, 
            { 
              backgroundColor: darkMode ? '#16181F' : '#FFFFFF',
              borderColor: darkMode ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.25)',
            }
          ]}>
            {/* Top decorative accent gradient bar */}
            <LinearGradient
              colors={['#EF4444', '#F59E0B', '#EF4444']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.logoutAccentBar}
            />

            {/* Glowing Icon with Dual Rings */}
            <View style={styles.logoutIconCenter}>
              <View style={styles.logoutIconOuterPulse}>
                <View style={styles.logoutIconInnerPulse}>
                  <Ionicons name="log-out" size={30} color="#EF4444" />
                </View>
              </View>
            </View>

            {/* Title & Prompt */}
            <Text style={[styles.logoutModalHeading, { color: colors.text }]}>
              {t('logout') || 'Log Out of FlipStar?'}
            </Text>
            <Text style={[styles.logoutModalBody, { color: colors.textSecondary }]}>
              {t('logoutConfirm') || 'Are you sure you want to log out of your account on this device?'}
            </Text>

            {/* Account & Phone Showcase Box */}
            <View style={[
              styles.logoutAccountBox,
              { 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : '#F4F5F8',
                borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
              }
            ]}>
              <View style={styles.logoutAccountRow}>
                <View style={[styles.logoutAvatar, { backgroundColor: colors.primary }]}>
                  {user?.profile_photo || profileData?.profile_photo ? (
                    <Image source={{ uri: user?.profile_photo || profileData?.profile_photo }} style={styles.logoutAvatarImg} />
                  ) : (
                    <Text style={styles.logoutAvatarLetter}>
                      {(user?.username || profileData?.username || 'U')[0]?.toUpperCase()}
                    </Text>
                  )}
                </View>

                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.logoutAccUsername, { color: colors.text }]} numberOfLines={1}>
                      @{user?.username || profileData?.username || 'user'}
                    </Text>
                    <View style={styles.logoutStatusTag}>
                      <View style={styles.logoutStatusDot} />
                      <Text style={styles.logoutStatusTagText}>Active</Text>
                    </View>
                  </View>
                  <Text style={[styles.logoutAccEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                    {user?.email || 'FlipStar Account'}
                  </Text>
                </View>
              </View>

              {/* Verified Phone Highlight Chip */}
              {displayPhone ? (
                <View style={styles.logoutPhoneBadge}>
                  <View style={styles.logoutPhoneIconWrap}>
                    <Ionicons name="call" size={14} color="#8fc441" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.logoutPhoneTitle}>Registered Phone Number</Text>
                    <Text style={styles.logoutPhoneNumber}>{displayPhone}</Text>
                  </View>
                  <Ionicons name="shield-checkmark" size={18} color="#8fc441" />
                </View>
              ) : null}
            </View>

            {/* Modal Buttons */}
            <View style={styles.logoutModalBtnRow}>
              {/* Cancel / Stay */}
              <TouchableOpacity
                style={[
                  styles.logoutCancelBtn,
                  { 
                    backgroundColor: darkMode ? 'rgba(255,255,255,0.08)' : '#E5E7EB',
                    borderColor: darkMode ? 'rgba(255,255,255,0.12)' : '#D1D5DB',
                  }
                ]}
                onPress={() => setShowLogoutModal(false)}
                disabled={loggingOut}
                activeOpacity={0.7}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                <Text style={[styles.logoutCancelBtnText, { color: colors.text }]}>
                  {t('cancel') || 'Stay Signed In'}
                </Text>
              </TouchableOpacity>

              {/* Confirm Logout */}
              <TouchableOpacity
                style={styles.logoutActionBtn}
                onPress={async () => {
                  try {
                    setLoggingOut(true);
                    setShowLogoutModal(false);
                    await logout();
                  } catch (err) {
                    console.error('Logout error:', err);
                  } finally {
                    setLoggingOut(false);
                  }
                }}
                disabled={loggingOut}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#EF4444', '#DC2626']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.logoutActionGradient}
                >
                  {loggingOut ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="log-out" size={18} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={styles.logoutActionBtnText}>
                        {t('logout') || 'Log Out'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: 18, fontWeight: '800', color: TEXT, letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  headerCenter: { alignItems: 'center' },
  backButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 40 },

  // Ambient glows
  ambientTopGlow: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(143, 196, 65, 0.08)',
    transform: [{ scaleX: 1.5 }],
  },
  ambientBottomGlow: {
    position: 'absolute',
    bottom: 120,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
    transform: [{ scaleY: 1.4 }],
  },

  // VIP Profile Showcase Card
  profileShowcaseCard: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  profileShowcaseBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 90,
  },
  profileShowcaseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 22,
  },
  avatarGlowContainer: {
    position: 'relative',
  },
  avatarGlowOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2.5,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  showcaseAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
  },
  showcaseAvatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  showcaseAvatarText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#000',
  },
  avatarOnlineBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#8fc441',
    borderWidth: 2,
    borderColor: '#15191E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  showcaseName: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  showcaseEmail: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 6,
  },
  phoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(143, 196, 65, 0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.3)',
    gap: 6,
    marginTop: 4,
  },
  phoneChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8fc441',
    letterSpacing: 0.2,
  },
  phoneVerifiedDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#8fc441',
  },
  showcaseActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8fc441',
  },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  editProfileBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Section styling
  sectionLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 26,
    marginBottom: 10,
    gap: 8,
  },
  sectionLabelIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  sectionCard: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, overflow: 'hidden', marginBottom: 18 },
  section: { marginTop: 32, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: SUB, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, textAlign: 'center' },
  
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: BORDER + '80' },
  rowIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  rowLabel: { fontSize: 15, color: TEXT, fontWeight: '700', lineHeight: 20, textAlign: 'left' },
  rowSubtitle: { fontSize: 12, color: SUB, marginTop: 4, lineHeight: 17, textAlign: 'left' },
  rowValue: { fontSize: 13, color: SUB },
  
  // Decorative Logout Trigger Card
  decorativeLogoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 24,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3,
  },
  logoutCardIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: -0.2,
  },
  logoutCardSubtitle: {
    fontSize: 12,
    color: '#EF4444',
    opacity: 0.8,
    marginTop: 2,
  },

  // Decorative Logout Confirmation Modal
  logoutModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoutModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 30,
    elevation: 16,
    overflow: 'hidden',
  },
  logoutAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  logoutIconCenter: {
    marginTop: 8,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIconOuterPulse: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIconInnerPulse: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutModalHeading: {
    fontSize: 21,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  logoutModalBody: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 10,
    marginBottom: 20,
  },
  logoutAccountBox: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 24,
  },
  logoutAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoutAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoutAvatarImg: {
    width: '100%',
    height: '100%',
  },
  logoutAvatarLetter: {
    fontSize: 20,
    fontWeight: '900',
    color: '#000',
  },
  logoutAccUsername: {
    fontSize: 15,
    fontWeight: '800',
  },
  logoutStatusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(143, 196, 65, 0.15)',
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 10,
    gap: 4,
  },
  logoutStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8fc441',
  },
  logoutStatusTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8fc441',
  },
  logoutAccEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  logoutPhoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(143, 196, 65, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.25)',
    borderRadius: 14,
    padding: 10,
    marginTop: 12,
  },
  logoutPhoneIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(143, 196, 65, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutPhoneTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8fc441',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logoutPhoneNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8fc441',
    marginTop: 1,
  },
  logoutModalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  logoutCancelBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  logoutActionBtn: {
    flex: 1.1,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
  },
  logoutActionGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  logoutActionBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },

  // Legacy & other styles
  profileSummary: { flexDirection: 'column', alignItems: 'center', padding: 32, backgroundColor: CARD, marginBottom: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: GOLD, justifyContent: 'center', alignItems: 'center', marginBottom: 16, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: 32, fontWeight: '800', color: '#000' },
  username: { fontSize: 18, fontWeight: '800', color: TEXT },
  email: { fontSize: 13, color: SUB, marginTop: 4 },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginHorizontal: 16, marginTop: 32, padding: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16 },
  logoutText: { color: '#EF4444', fontSize: 15, fontWeight: '800' },
  footer: { alignItems: 'center', padding: 32 },
  version: { fontSize: 12, fontWeight: '600', color: SUB },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  bottomSheet: { width: '100%', backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24 },
  bottomSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: BORDER },
  bottomSheetTitle: { fontSize: 18, fontWeight: '800', color: TEXT },
  bottomSheetContent: { paddingVertical: 8, paddingHorizontal: 20 },
  languageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  languageLabel: { fontSize: 16, fontWeight: '600', textAlign: 'left' },
  
  passwordField: { marginBottom: 14 },
  passwordLabel: { fontSize: 13, fontWeight: '700', color: TEXT, marginBottom: 6, textAlign: 'left' },
  passwordInput: { width: '100%', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: BG, color: TEXT, fontSize: 15 },
  passwordInputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: BORDER, 
    backgroundColor: BG,
  },
  passwordInputWithIcon: { 
    flex: 1, 
    padding: 14, 
    fontSize: 15, 
    color: TEXT,
  },
  eyeIcon: { 
    padding: 10, 
    marginRight: 5,
  },
  updateButton: { width: '100%', marginTop: 12, padding: 16, borderRadius: 14, backgroundColor: GOLD, alignItems: 'center' },
  updateButtonText: { color: '#000', fontSize: 15, fontWeight: '800' },
  
  alertOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  alertBox: { backgroundColor: CARD, borderRadius: 16, padding: 20, maxWidth: 360, width: '100%' },
  alertTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  alertMessage: { fontSize: 14, color: TEXT, lineHeight: 20, marginBottom: 16 },
  alertButtons: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  alertButton: { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  alertButtonText: { fontSize: 13, fontWeight: '600', color: TEXT },
  alertButtonPrimary: { backgroundColor: GOLD, borderWidth: 0 },
  
  // Beautiful Modal Styles
  beautifulModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 20,
  },
  beautifulModal: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: CARD,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    alignSelf: 'center',
  },
  beautifulModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  beautifulModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT,
    flex: 1,
  },
  beautifulModalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: BORDER + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beautifulModalContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  
  beautifulUpdateButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },

  // Language Option Styles
  languageOption: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  languageOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  languageSelectedIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },

  // FAQ and Terms Modal Styles
  modalSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER + '40',
  },
  faqQ: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  faqQText: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    flex: 1,
  },
  faqA: {
    fontSize: 14,
    color: SUB,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  para: {
    fontSize: 11,
    color: '#ccc',
    lineHeight: 17,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
    marginTop: 16,
    marginBottom: 6,
  },
  subSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ddd',
    marginTop: 10,
    marginBottom: 4,
  },
  bullet: {
    fontSize: 11,
    color: '#bbb',
    lineHeight: 17,
    marginBottom: 4,
    paddingLeft: 4,
  },
  table: { borderWidth: 1, borderColor: '#333', borderRadius: 6, marginBottom: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#222' },
  headerRow: { backgroundColor: '#1A1A1A' },
  altRow: { backgroundColor: '#111' },
  cell: { padding: 6, fontSize: 10, color: '#ccc', lineHeight: 14 },
  headerCell: { color: GOLD, fontWeight: '700', fontSize: 10 },
  dataCell: {},
  infoBox: { backgroundColor: '#1A1A2E', borderLeftWidth: 3, borderLeftColor: GOLD, padding: 10, borderRadius: 6, marginBottom: 10 },
  infoText: { fontSize: 11, color: '#aaa', lineHeight: 16 },
  formulaBox: { backgroundColor: '#0D1A2B', borderWidth: 1, borderColor: GOLD, padding: 12, borderRadius: 8, marginBottom: 8 },
  formulaText: { color: GOLD, fontSize: 11, fontWeight: '700', textAlign: 'center' },
});
