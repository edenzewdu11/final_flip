import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert,
  TextInput, ActivityIndicator, ScrollView, Dimensions,
  Platform, KeyboardAvoidingView, StatusBar, Modal, Animated, Easing
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useConsent } from '../../contexts/ConsentContext';
import { useTheme } from '../../contexts/ThemeContext';
import CameraDisclosure from '../../components/common/CameraDisclosure';
import StorageDisclosure from '../../components/common/StorageDisclosure';
import PaymentReceiptModal from '../../components/subscription/PaymentReceiptModal';
import api from '../../api';

const { width, height } = Dimensions.get('window');
const GOLD = '#8fc441';  // FlipStar Signature Lime
const BG = '#08090C';

const FILTERS = [
  { id: 'none', name: 'Original', overlay: 'transparent', colors: ['#2a2a2a', '#181818'] },
  { id: 'warm', name: 'Warm Sun', overlay: 'rgba(255,140,0,0.18)', colors: ['#ff8c00', '#ff5722'] },
  { id: 'cool', name: 'Cyber Ice', overlay: 'rgba(30,120,255,0.18)', colors: ['#00c6ff', '#0072ff'] },
  { id: 'vintage', name: 'Vintage', overlay: 'rgba(140,80,20,0.22)', colors: ['#8a5a36', '#4a2c11'] },
  { id: 'golden', name: 'Golden', overlay: 'rgba(235,170,40,0.20)', colors: ['#f6d365', '#fda085'] },
  { id: 'dark', name: 'Noir Luxe', overlay: 'rgba(0,0,0,0.35)', colors: ['#434343', '#000000'] },
  { id: 'emerald', name: 'Emerald', overlay: 'rgba(16,185,129,0.18)', colors: ['#10b981', '#047857'] },
  { id: 'neon', name: 'Neon Glow', overlay: 'rgba(168,85,247,0.20)', colors: ['#a855f7', '#ec4899'] },
];

const FALLBACK_CATEGORIES = [
  { id: null, name: 'None', icon: 'sparkles-outline', emoji: '✨' },
  { id: 'dance', name: 'Dance', icon: 'body-outline', emoji: '💃' },
  { id: 'comedy', name: 'Comedy', icon: 'happy-outline', emoji: '😂' },
  { id: 'music', name: 'Music', icon: 'musical-notes', emoji: '🎵' },
  { id: 'food', name: 'Food', icon: 'restaurant', emoji: '🍔' },
  { id: 'sports', name: 'Sports', icon: 'football-outline', emoji: '⚽' },
  { id: 'fashion', name: 'Fashion', icon: 'shirt-outline', emoji: '👗' },
  { id: 'travel', name: 'Travel', icon: 'airplane-outline', emoji: '✈️' },
  { id: 'education', name: 'Education', icon: 'school-outline', emoji: '🎓' },
  { id: 'lifestyle', name: 'Lifestyle', icon: 'heart-outline', emoji: '🌟' },
  { id: 'other', name: 'Other', icon: 'grid-outline', emoji: '💡' },
];

const QUICK_HASHTAGS = ['#flipstar', '#viral', '#ethiopia', '#trending', '#dance', '#comedy', '#creator'];
const QUICK_EMOJIS = ['🔥', '✨', '🎬', '🚀', '💯', '❤️', '💃', '🇪🇹'];

// Video duration limits
const MAX_VIDEO_DURATION = 95; // 90 seconds reels + 5s buffer
const LONG_VIDEO_THRESHOLD = 60;
const LONG_VIDEO_SURCHARGE = 0;

export default function CreateScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user, hasActiveSubscription } = useAuth();
  const { hasConsent, updateConsent } = useConsent();
  const { colors } = useTheme();

  // State
  const [stage, setStage] = useState('pick'); // 'pick' | 'edit' | 'details' | 'uploading'
  const [activeMode, setActiveMode] = useState('reels'); // 'reels' | 'photo' | 'sound' | 'campaign'
  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [filter, setFilter] = useState(FILTERS[0]);
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [progress, setProgress] = useState(0);

  // In-App Camera State (matching Image 1)
  const isFocused = useIsFocused();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  const cameraRef = useRef(null);
  const [cameraFacing, setCameraFacing] = useState('front'); // Image 1 shows front camera by default
  const [cameraMode, setCameraMode] = useState('video'); // Image 1 shows 'Video' selected by default
  const [cameraFlash, setCameraFlash] = useState('off'); // Image 1 shows flash-off by default
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const isRecordingRef = useRef(false);
  const recordTimerRef = useRef(null);

  // Studio quick controls & overlays
  const [showFilterDock, setShowFilterDock] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showSoundModal, setShowSoundModal] = useState(false);
  const [overlayText, setOverlayText] = useState('');
  const [selectedSound, setSelectedSound] = useState(null);

  // Auto-request permissions when screen is focused in camera mode
  useEffect(() => {
    if (stage === 'camera' && isFocused) {
      if (cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) {
        requestCameraPermission();
      }
      if (microphonePermission && !microphonePermission.granted && microphonePermission.canAskAgain) {
        requestMicrophonePermission();
      }
    }
  }, [stage, isFocused, cameraPermission, microphonePermission]);

  // Video recording timer
  useEffect(() => {
    if (isRecording) {
      setRecordDuration(0);
      recordTimerRef.current = setInterval(() => {
        setRecordDuration(prev => {
          if (prev >= 90) {
            stopRecording();
            return 90;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      setRecordDuration(0);
    }
    return () => {
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
    };
  }, [isRecording]);

  // Campaign param
  const campaignId = route?.params?.campaignId;

  // Wallet
  const [walletConfig, setWalletConfig] = useState(null);
  const [userBalance, setUserBalance] = useState(0);
  const [postCost, setPostCost] = useState(0);
  const [longVideoSurcharge, setLongVideoSurcharge] = useState(0);
  const [showInsufficientCoinsModal, setShowInsufficientCoinsModal] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(true);

  // Permissions / disclosures
  const [showCameraDisclosure, setShowCameraDisclosure] = useState(false);
  const [showStorageDisclosure, setShowStorageDisclosure] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Decorative Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    loadWalletData();
    loadCategories();

    // Pulse animation for record button and badges
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Ambient glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 0.8,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.4,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Screen entrance
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Hide bottom tab bar during edit / details / uploading stages so full screen is available
  useEffect(() => {
    const parent = navigation.getParent();
    if (parent) {
      parent.setOptions({
        tabBarStyle: (stage === 'pick' || stage === 'camera')
          ? undefined
          : { display: 'none' }
      });
    }
    return () => {
      if (parent) {
        parent.setOptions({ tabBarStyle: undefined });
      }
    };
  }, [stage, navigation]);

  const loadCategories = async () => {
    try {
      const data = await api.request('/categories/');
      if (Array.isArray(data) && data.length > 0) {
        const enriched = [
          { id: null, name: 'None', icon: 'sparkles-outline', emoji: '✨' },
          ...data.map(cat => ({
            ...cat,
            icon: cat.icon || 'folder-outline',
            emoji: cat.emoji || '📁',
          }))
        ];
        setCategories(enriched);
      }
    } catch (error) {
      console.error('[CREATE] Failed to load categories:', error);
    }
  };

  const loadWalletData = async () => {
    try {
      setLoadingWallet(true);
      const [configData, balanceData] = await Promise.all([
        api.getWalletConfig(),
        api.getWalletBalance()
      ]);

      setWalletConfig(configData);
      const totalBalance = balanceData?.balance?.total || balanceData?.total || 0;
      setUserBalance(totalBalance);

      const cost = campaignId
        ? (configData?.cost_post_create || 0)
        : (configData?.cost_post_create_non_campaign || 0);
      setPostCost(cost);
    } catch (error) {
      console.error('[CREATE] Failed to load wallet data:', error);
    } finally {
      setLoadingWallet(false);
    }
  };

  const refreshBalance = async () => {
    try {
      const balanceData = await api.getWalletBalance();
      const totalBalance = balanceData?.balance?.total || balanceData?.total || 0;
      setUserBalance(totalBalance);
    } catch (error) {
      console.error('[CREATE] Failed to refresh balance:', error);
    }
  };

  const totalCost = postCost + longVideoSurcharge;

  // Media pickers
  const pickFromLibrary = async () => {
    if (!hasConsent('storage')) {
      setPendingAction('library');
      setShowStorageDisclosure(true);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      quality: 0.88,
    });
    if (!result.canceled && result.assets?.length) {
      const asset = result.assets[0];
      let surcharge = 0;
      if (asset.type === 'video' && asset.duration) {
        if (asset.duration > MAX_VIDEO_DURATION) {
          Alert.alert(
            'Video Too Long',
            `Video duration cannot exceed ${MAX_VIDEO_DURATION} seconds. Please select a shorter video.`,
            [{ text: 'OK', style: 'cancel' }]
          );
          return;
        }

        if (asset.duration > LONG_VIDEO_THRESHOLD) {
          surcharge = LONG_VIDEO_SURCHARGE;
        }
      }
      setLongVideoSurcharge(surcharge);
      setMedia({ uri: asset.uri, type: asset.type || 'image', duration: asset.duration });
      setStage('edit');
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current || isRecordingRef.current) return;
    try {
      if (!cameraPermission?.granted) {
        const camRes = await requestCameraPermission();
        if (!camRes?.granted) {
          Alert.alert('Permission Required', 'Camera permission is required to record video.');
          return;
        }
      }
      if (!microphonePermission?.granted) {
        await requestMicrophonePermission();
      }

      isRecordingRef.current = true;
      setIsRecording(true);

      const videoPromise = cameraRef.current.recordAsync({
        maxDuration: 90,
      });

      const video = await videoPromise;
      if (video?.uri) {
        setLongVideoSurcharge(0);
        setMedia({
          uri: video.uri,
          type: 'video',
          duration: recordDuration || undefined,
        });
        setStage('edit');
      }
    } catch (err) {
      console.error('[CREATE] Video record error:', err);
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecordingRef.current) {
      try {
        cameraRef.current.stopRecording();
      } catch (err) {
        console.error('[CREATE] Stop recording error:', err);
      }
    }
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      if (!cameraPermission?.granted) {
        const camRes = await requestCameraPermission();
        if (!camRes?.granted) {
          Alert.alert('Permission Required', 'Camera permission is required to take photos.');
          return;
        }
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.88,
      });

      if (photo?.uri) {
        setLongVideoSurcharge(0);
        setMedia({
          uri: photo.uri,
          type: 'image',
        });
        setStage('edit');
      }
    } catch (err) {
      console.error('[CREATE] Take photo error:', err);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const handleShutterPress = () => {
    if (cameraMode === 'video') {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    } else {
      takePhoto();
    }
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const pickPhotoFromCamera = async () => {
    setActiveMode('photo');
    setCameraMode('picture');
    if (!hasConsent('camera')) {
      setPendingAction('camera_photo');
      setShowCameraDisclosure(true);
      return;
    }
    setStage('camera');
    if (!cameraPermission?.granted) {
      requestCameraPermission().catch(() => {});
    }
  };

  const pickVideoFromCamera = async () => {
    setActiveMode('reels');
    setCameraMode('video');
    if (!hasConsent('camera')) {
      setPendingAction('camera_video');
      setShowCameraDisclosure(true);
      return;
    }
    setStage('camera');
    if (!cameraPermission?.granted) {
      requestCameraPermission().catch(() => {});
    }
    if (!microphonePermission?.granted) {
      requestMicrophonePermission().catch(() => {});
    }
  };

  const resumePendingAction = async (action) => {
    setPendingAction(null);
    if (action === 'library') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.88,
      });
      if (!result.canceled && result.assets?.length) {
        const asset = result.assets[0];
        let surcharge = 0;
        if (asset.type === 'video' && asset.duration) {
          if (asset.duration > MAX_VIDEO_DURATION) {
            Alert.alert(
              'Video Too Long',
              `Video duration cannot exceed ${MAX_VIDEO_DURATION} seconds. Please select a shorter video.`,
              [{ text: 'OK', style: 'cancel' }]
            );
            return;
          }
          if (asset.duration > LONG_VIDEO_THRESHOLD) {
            surcharge = LONG_VIDEO_SURCHARGE;
          }
        }
        setLongVideoSurcharge(surcharge);
        setMedia({ uri: asset.uri, type: asset.type || 'image', duration: asset.duration });
        setStage('edit');
      }
      return;
    }
    if (action === 'camera_photo') {
      setActiveMode('photo');
      setCameraMode('picture');
      setStage('camera');
      if (!cameraPermission?.granted) {
        requestCameraPermission().catch(() => {});
      }
      return;
    }
    if (action === 'camera_video') {
      setActiveMode('reels');
      setCameraMode('video');
      setStage('camera');
      if (!cameraPermission?.granted) {
        requestCameraPermission().catch(() => {});
      }
      if (!microphonePermission?.granted) {
        requestMicrophonePermission().catch(() => {});
      }
      return;
    }
  };

  const acceptCameraDisclosure = async () => {
    await updateConsent('camera', true, {
      source: 'create_screen',
      metadata: { action: pendingAction || 'camera' },
    });
    const action = pendingAction;
    setShowCameraDisclosure(false);
    await resumePendingAction(action);
  };

  const acceptStorageDisclosure = async () => {
    await updateConsent('storage', true, {
      source: 'create_screen',
      metadata: { action: pendingAction || 'library' },
    });
    const action = pendingAction;
    setShowStorageDisclosure(false);
    await resumePendingAction(action);
  };

  const declineDisclosure = async (type) => {
    await updateConsent(type, false, {
      source: 'create_screen',
      metadata: { action: pendingAction || type, declined: true },
    });
    setPendingAction(null);
    setShowCameraDisclosure(false);
    setShowStorageDisclosure(false);
    Alert.alert(
      'Consent required',
      type === 'camera'
        ? 'Camera access is required to capture content.'
        : 'Storage access is required to choose media from your device.'
    );
  };

  const handlePost = async () => {
    if (!media) return;
    if (!user) {
      Alert.alert('Login Required', 'Please login to post.');
      return;
    }

    if (!hasActiveSubscription) {
      Alert.alert(
        'Subscription Required',
        'You need an active subscription to create posts. Subscribe now to unlock all creator features!',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Subscribe', onPress: () => navigation.navigate('Subscription') }
        ]
      );
      return;
    }

    if (totalCost > 0 && userBalance < totalCost) {
      setShowInsufficientCoinsModal(true);
      return;
    }

    if (totalCost > 0) {
      setShowPostConfirm(true);
    } else {
      executePost();
    }
  };

  const executePost = async () => {
    setStage('uploading');
    setProgress(0);
    try {
      const isVideo = media.type === 'video';
      const fd = new FormData();

      let fileUri = media.uri;
      if (Platform.OS === 'ios' && fileUri.startsWith('file://')) {
        fileUri = fileUri.replace('file://', '');
      }
      if (Platform.OS === 'android' && fileUri.startsWith('file://')) {
        fileUri = fileUri.replace('file://', '');
      }

      const fileName = isVideo ? 'video.mp4' : 'image.jpg';

      let fileToUpload;
      if (media.assets && media.assets[0]) {
        const asset = media.assets[0];
        fileToUpload = {
          uri: asset.uri,
          type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
          name: asset.fileName || fileName,
        };
      } else {
        fileToUpload = {
          uri: media.uri,
          type: isVideo ? 'video/mp4' : 'image/jpeg',
          name: fileName,
        };
      }

      fd.append('file', fileToUpload);
      fd.append('caption', caption || '');
      if (hashtags) fd.append('hashtags', hashtags);
      if (selectedCategory) fd.append('category', String(selectedCategory));

      if (campaignId) {
        fd.append('campaign_id', campaignId);
        fd.append('is_campaign_post', 'true');
      }

      const postResponse = await api.createPost(fd, {
        onProgress: pct => setProgress(Math.min(pct, 99))
      });
      setProgress(100);

      if (totalCost > 0) {
        await refreshBalance();
      }

      setTimeout(() => {
        setMedia(null);
        setCaption('');
        setHashtags('');
        setLongVideoSurcharge(0);
        setFilter(FILTERS[0]);
        setStage('pick');

        if (campaignId) {
          if (route.params?.autoSubmitToCampaign && postResponse && campaignId) {
            (async () => {
              try {
                const postId = postResponse.id || postResponse.post_id;
                if (postId) {
                  await api.request('/campaigns/' + campaignId + '/enter/', {
                    method: 'POST',
                    body: JSON.stringify({ reel_id: postId })
                  });
                  Alert.alert('Success!', 'Your campaign entry has been submitted! Check the leaderboard!');
                } else {
                  const userPosts = await api.request('/reels/?user=me&limit=1');
                  const latestPost = Array.isArray(userPosts) ? userPosts[0] : (userPosts.results?.[0]);
                  if (latestPost) {
                    await api.request('/campaigns/' + campaignId + '/enter/', {
                      method: 'POST',
                      body: JSON.stringify({ reel_id: latestPost.id })
                    });
                    Alert.alert('Success!', 'Your campaign entry has been submitted! Check the leaderboard!');
                  }
                }
              } catch (error) {
                console.error('[CREATE] Auto-submission failed:', error);
              }
            })();
          }

          setTimeout(() => {
            navigation.navigate('CampaignDetail', { campaignId, refresh: true });
          }, 500);
        } else {
          navigation.navigate('Home');
        }
      }, 600);
    } catch (err) {
      const msg = typeof err === 'object' ? (err.detail || err.error || err.message || 'Upload failed') : String(err);
      Alert.alert('Upload Failed', msg);
      setStage('details');
    }
  };

  // Quick Emoji Click Handler
  const handleEmojiPress = (emoji) => {
    setCaption(prev => (prev ? `${prev} ${emoji}` : emoji));
  };

  // Quick Hashtag Click Handler
  const handleHashtagPress = (tag) => {
    setHashtags(prev => {
      if (!prev) return tag;
      if (prev.includes(tag)) return prev;
      return `${prev} ${tag}`;
    });
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ── 1. STAGE: PICK (Studio Landing / Options Screen) ────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'pick') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#08090C" />

        {/* Ambient Aurora Gradient Glows */}
        <Animated.View
          style={[
            styles.ambientAuroraTop,
            { opacity: glowAnim }
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['rgba(143, 196, 65, 0.22)', 'rgba(99, 102, 241, 0.12)', 'transparent']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.8, y: 0 }}
            end={{ x: 0.1, y: 0.8 }}
          />
        </Animated.View>

        <View style={styles.ambientGlowBottom} pointerEvents="none">
          <LinearGradient
            colors={['transparent', 'rgba(143, 196, 65, 0.08)', 'rgba(0, 0, 0, 0.8)']}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Studio Top Navigation */}
        <View style={[styles.studioHeader, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate('Home');
              }
            }}
            style={styles.frostedIconBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>

          <View style={styles.headerTitleWrap}>
            <View style={styles.studioPill}>
              <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.studioPillText}>STUDIO</Text>
            </View>
            <Text style={styles.headerBrandTitle}>FlipStar Create</Text>
          </View>

          {/* Interactive Creator Coin Pill */}
          <TouchableOpacity
            style={styles.coinBalancePill}
            onPress={() => navigation.navigate('WebsiteCoin')}
            activeOpacity={0.8}
          >
            <View style={styles.coinIconCircle}>
              <Ionicons name="sparkles" size={11} color="#000" />
            </View>
            <Text style={styles.coinBalanceText}>
              {loadingWallet ? '...' : userBalance.toLocaleString()}
            </Text>
            <View style={styles.coinAddBadge}>
              <Ionicons name="add" size={12} color="#000" />
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.pickScrollContent, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Inspiration Header */}
          <Animated.View
            style={[
              styles.heroContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              }
            ]}
          >
            <View style={styles.heroSparkleRow}>
              <View style={styles.tagBadge}>
                <Ionicons name="flash" size={12} color="#8fc441" style={{ marginRight: 4 }} />
                <Text style={styles.tagBadgeText}>CREATOR LAB</Text>
              </View>
              {campaignId && (
                <View style={styles.campaignActivePill}>
                  <Ionicons name="trophy" size={12} color="#000" style={{ marginRight: 4 }} />
                  <Text style={styles.campaignActivePillText}>Campaign Mode Active</Text>
                </View>
              )}
            </View>
            <Text style={styles.heroHeading}>
              Bring your stories{'\n'}
              <Text style={styles.heroHeadingHighlight}>to life</Text>
            </Text>
            <Text style={styles.heroSubheading}>
              Record, style with cinema filters, and broadcast to thousands across Ethiopia and beyond.
            </Text>
          </Animated.View>

          {/* Creative Modes Selector */}
          <View style={styles.modeSelectorWrap}>
            {[
              { id: 'reels', label: 'Reel 9:16', icon: 'videocam', badge: 'POPULAR' },
              { id: 'photo', label: 'Snap HD', icon: 'camera' },
              { id: 'sound', label: 'Music FX', icon: 'musical-notes' },
              { id: 'campaign', label: 'Challenges', icon: 'trophy' },
            ].map(m => {
              const isActive = activeMode === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => {
                    setActiveMode(m.id);
                    if (m.id === 'photo') pickPhotoFromCamera();
                    else if (m.id === 'reels') pickVideoFromCamera();
                    else if (m.id === 'campaign') navigation.navigate('Campaigns');
                  }}
                  style={[
                    styles.modeChip,
                    isActive && styles.modeChipActive
                  ]}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={m.icon}
                    size={14}
                    color={isActive ? '#000' : '#8fc441'}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.modeChipText, isActive && styles.modeChipTextActive]}>
                    {m.label}
                  </Text>
                  {m.badge && (
                    <View style={styles.modeMiniBadge}>
                      <Text style={styles.modeMiniBadgeText}>{m.badge}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── SHOWCASE RECORD VIDEO CARD (Primary) ── */}
          <TouchableOpacity
            style={styles.recordHeroCard}
            onPress={pickVideoFromCamera}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['#a2e845', '#8fc441', '#6ea729']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.recordHeroGradient}
            >
              {/* Decorative Viewfinder HUD brackets */}
              <View style={[styles.hudBracket, styles.hudTopLeft]} pointerEvents="none" />
              <View style={[styles.hudBracket, styles.hudTopRight]} pointerEvents="none" />
              <View style={[styles.hudBracket, styles.hudBottomLeft]} pointerEvents="none" />
              <View style={[styles.hudBracket, styles.hudBottomRight]} pointerEvents="none" />

              {/* Floating Badge */}
              <View style={styles.heroPopularBadge}>
                <Ionicons name="flame" size={13} color="#000" style={{ marginRight: 3 }} />
                <Text style={styles.heroPopularBadgeText}>MOST POPULAR</Text>
              </View>

              {/* Center Recording Lens Graphic */}
              <View style={styles.recordLensRow}>
                <View style={styles.lensOuterRing}>
                  <Animated.View
                    style={[
                      styles.lensPulsingGlow,
                      { transform: [{ scale: pulseAnim }] }
                    ]}
                  />
                  <View style={styles.lensCore}>
                    <View style={styles.redRecordDot} />
                  </View>
                </View>

                <View style={styles.recordTextContainer}>
                  <Text style={styles.recordHeroTitle}>Record a Reel</Text>
                  <Text style={styles.recordHeroSubtitle}>
                    Up to 90s • 4K HDR • Filters, dynamic text & music sync
                  </Text>
                </View>
              </View>

              {/* Bottom Specs Strip */}
              <View style={styles.specStrip}>
                <View style={styles.specPill}>
                  <Ionicons name="time-outline" size={12} color="#1b300a" />
                  <Text style={styles.specPillText}>90s Max</Text>
                </View>
                <View style={styles.specPill}>
                  <Ionicons name="color-filter-outline" size={12} color="#1b300a" />
                  <Text style={styles.specPillText}>18 Cinema FX</Text>
                </View>
                <View style={styles.specPill}>
                  <Ionicons name="musical-notes-outline" size={12} color="#1b300a" />
                  <Text style={styles.specPillText}>Audio Sync</Text>
                </View>
                <View style={styles.specArrowCircle}>
                  <Ionicons name="arrow-forward" size={16} color="#8fc441" />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── DUAL ACTION CARDS: Take Photo & Upload Gallery ── */}
          <View style={styles.actionGridRow}>
            {/* Take a Photo Card */}
            <TouchableOpacity
              style={styles.gridCard}
              onPress={pickPhotoFromCamera}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#1c2025', '#121418']}
                style={styles.gridCardGradient}
              >
                <View style={styles.gridCardTopRow}>
                  <View style={[styles.gridIconCircle, { backgroundColor: 'rgba(143, 196, 65, 0.14)' }]}>
                    <Ionicons name="camera" size={24} color="#8fc441" />
                  </View>
                  <View style={styles.gridTag}>
                    <Text style={styles.gridTagText}>PHOTO</Text>
                  </View>
                </View>
                <Text style={styles.gridCardTitle}>Snap Photo</Text>
                <Text style={styles.gridCardSub}>
                  Instant high-res snap with portrait lighting & filters
                </Text>
                <View style={styles.gridCardAction}>
                  <Text style={styles.gridActionText}>Open Camera</Text>
                  <Ionicons name="chevron-forward" size={14} color="#8fc441" />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* Upload Gallery Card */}
            <TouchableOpacity
              style={styles.gridCard}
              onPress={pickFromLibrary}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#201b2c', '#14121c']}
                style={styles.gridCardGradient}
              >
                <View style={styles.gridCardTopRow}>
                  <View style={[styles.gridIconCircle, { backgroundColor: 'rgba(168, 85, 247, 0.16)' }]}>
                    <Ionicons name="images" size={24} color="#c084fc" />
                  </View>
                  <View style={[styles.gridTag, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}>
                    <Text style={[styles.gridTagText, { color: '#c084fc' }]}>GALLERY</Text>
                  </View>
                </View>
                <Text style={styles.gridCardTitle}>Upload Media</Text>
                <Text style={styles.gridCardSub}>
                  Import existing videos or photos from your library
                </Text>
                <View style={styles.gridCardAction}>
                  <Text style={[styles.gridActionText, { color: '#c084fc' }]}>Browse Device</Text>
                  <Ionicons name="chevron-forward" size={14} color="#c084fc" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* ── PRO CREATOR TOOLKIT SHOWCASE ── */}
          <View style={styles.toolkitSection}>
            <View style={styles.toolkitHeaderRow}>
              <Text style={styles.toolkitTitle}>STUDIO SUITE</Text>
              <Text style={styles.toolkitSubtitle}>INCLUDED IN CAMERA</Text>
            </View>

            <View style={styles.toolkitGrid}>
              <View style={styles.toolItem}>
                <LinearGradient
                  colors={['rgba(255, 140, 0, 0.18)', 'rgba(255, 140, 0, 0.04)']}
                  style={styles.toolIconBox}
                >
                  <Ionicons name="musical-notes" size={22} color="#ff9800" />
                </LinearGradient>
                <Text style={styles.toolName}>Trending Audio</Text>
                <Text style={styles.toolDesc}>10,000+ tracks</Text>
              </View>

              <View style={styles.toolItem}>
                <LinearGradient
                  colors={['rgba(143, 196, 65, 0.18)', 'rgba(143, 196, 65, 0.04)']}
                  style={styles.toolIconBox}
                >
                  <Ionicons name="color-filter" size={22} color="#8fc441" />
                </LinearGradient>
                <Text style={styles.toolName}>Color LUTs</Text>
                <Text style={styles.toolDesc}>18 cinema presets</Text>
              </View>

              <View style={styles.toolItem}>
                <LinearGradient
                  colors={['rgba(59, 130, 246, 0.18)', 'rgba(59, 130, 246, 0.04)']}
                  style={styles.toolIconBox}
                >
                  <Ionicons name="sparkles" size={22} color="#60a5fa" />
                </LinearGradient>
                <Text style={styles.toolName}>Auto Retouch</Text>
                <Text style={styles.toolDesc}>Lighting & smooth</Text>
              </View>

              <View style={styles.toolItem}>
                <LinearGradient
                  colors={['rgba(236, 72, 153, 0.18)', 'rgba(236, 72, 153, 0.04)']}
                  style={styles.toolIconBox}
                >
                  <Ionicons name="text" size={22} color="#f472b6" />
                </LinearGradient>
                <Text style={styles.toolName}>Dynamic Text</Text>
                <Text style={styles.toolDesc}>Animated stickers</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Consent Disclosures */}
        <CameraDisclosure
          visible={showCameraDisclosure}
          colors={colors}
          onAccept={acceptCameraDisclosure}
          onDecline={() => declineDisclosure('camera')}
        />
        <StorageDisclosure
          visible={showStorageDisclosure}
          colors={colors}
          onAccept={acceptStorageDisclosure}
          onDecline={() => declineDisclosure('storage')}
        />
      </View>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 2. STAGE: CAMERA (In-App Camera Viewfinder matching Image 1) ───────────
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'camera') {
    const isCameraPermitted = cameraPermission?.granted;

    return (
      <View style={styles.camContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        {/* ── TOP BAR (Black Background) ── */}
        <View style={[styles.camTopBar, { paddingTop: insets.top + 8 }]}>
          {/* Close button -> returns to options screen */}
          <TouchableOpacity
            style={styles.camTopCircleBtn}
            onPress={() => setStage('pick')}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>

          {/* Photo | Video Pill Toggle */}
          <View style={styles.camModePillContainer}>
            <TouchableOpacity
              style={[
                styles.camModePillOption,
                cameraMode === 'picture' && styles.camModePillActive
              ]}
              onPress={() => {
                if (!isRecording) setCameraMode('picture');
              }}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.camModePillText,
                cameraMode === 'picture' && styles.camModePillTextActive
              ]}>
                Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.camModePillOption,
                cameraMode === 'video' && styles.camModePillActive
              ]}
              onPress={() => {
                setCameraMode('video');
              }}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.camModePillText,
                cameraMode === 'video' && styles.camModePillTextActive
              ]}>
                Video
              </Text>
            </TouchableOpacity>
          </View>

          {/* Flash Toggle */}
          <TouchableOpacity
            style={styles.camTopCircleBtn}
            onPress={() => setCameraFlash(prev => prev === 'off' ? 'on' : 'off')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={cameraFlash === 'off' ? 'flash-off' : 'flash'}
              size={20}
              color={cameraFlash === 'off' ? '#ffffff' : '#8fc441'}
            />
          </TouchableOpacity>
        </View>

        {/* Recording active timer banner */}
        {isRecording && (
          <View style={styles.camRecordingBanner}>
            <View style={styles.camRecordingDot} />
            <Text style={styles.camRecordingTimerText}>
              {formatTimer(recordDuration)} / 01:30
            </Text>
          </View>
        )}

        {/* ── VIEWFINDER AREA (Center with Black Letterbox) ── */}
        <View style={styles.camViewfinderArea}>
          {isFocused && isCameraPermitted ? (
            <View style={styles.camViewport}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={cameraFacing}
                flash={cameraFlash}
                mode={cameraMode}
                mute={false}
              />

              {/* Real-time Color Filter Overlay */}
              {filter.overlay !== 'transparent' && (
                <View
                  style={[StyleSheet.absoluteFill, { backgroundColor: filter.overlay }]}
                  pointerEvents="none"
                />
              )}

              {/* Optional Text Overlay preview */}
              {overlayText ? (
                <View style={styles.camLiveTextBadge} pointerEvents="none">
                  <Text style={styles.camLiveTextContent}>{overlayText}</Text>
                </View>
              ) : null}

              {/* ── RIGHT FLOATING SIDEBAR (Filters, Text, Sound) ── */}
              <View style={styles.camRightSidebar}>
                {/* Filters */}
                <TouchableOpacity
                  style={styles.camSideItem}
                  onPress={() => setShowFilterDock(prev => !prev)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.camSideCircleBtn, showFilterDock && styles.camSideCircleBtnActive]}>
                    <Ionicons name="sparkles" size={20} color={showFilterDock ? '#8fc441' : '#ffffff'} />
                  </View>
                  <Text style={styles.camSideLabel}>Filters</Text>
                </TouchableOpacity>

                {/* Text */}
                <TouchableOpacity
                  style={styles.camSideItem}
                  onPress={() => setShowTextModal(true)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.camSideCircleBtn, !!overlayText && styles.camSideCircleBtnActive]}>
                    <Ionicons name="text" size={20} color={overlayText ? '#8fc441' : '#ffffff'} />
                  </View>
                  <Text style={styles.camSideLabel}>Text</Text>
                </TouchableOpacity>

                {/* Sound */}
                <TouchableOpacity
                  style={styles.camSideItem}
                  onPress={() => setShowSoundModal(true)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.camSideCircleBtn, !!selectedSound && styles.camSideCircleBtnActive]}>
                    <Ionicons name="musical-notes" size={20} color={selectedSound ? '#8fc441' : '#ffffff'} />
                  </View>
                  <Text style={styles.camSideLabel}>Sound</Text>
                </TouchableOpacity>
              </View>

              {/* Floating Filter Selector Dock if opened */}
              {showFilterDock && (
                <View style={styles.camFilterDockOverlay}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.camFilterDockScroll}
                  >
                    {FILTERS.map(f => {
                      const isSel = filter.id === f.id;
                      return (
                        <TouchableOpacity
                          key={f.id}
                          style={[styles.camFilterChip, isSel && styles.camFilterChipSelected]}
                          onPress={() => setFilter(f)}
                          activeOpacity={0.8}
                        >
                          <LinearGradient colors={f.colors} style={styles.camFilterChipCircle}>
                            {isSel && <Ionicons name="checkmark" size={12} color="#fff" />}
                          </LinearGradient>
                          <Text style={[styles.camFilterChipText, isSel && styles.camFilterChipTextSel]}>
                            {f.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.camPermissionPlaceholder}>
              <View style={styles.camPermIconWrap}>
                <Ionicons name="camera-outline" size={48} color="#8fc441" />
              </View>
              <Text style={styles.camPermTitle}>Camera Access</Text>
              <Text style={styles.camPermSub}>
                Allow camera permission to capture videos and photos directly in FlipStar.
              </Text>
              <TouchableOpacity
                style={styles.camPermBtn}
                onPress={async () => {
                  await requestCameraPermission();
                  await requestMicrophonePermission();
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.camPermBtnText}>Enable Camera</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── BOTTOM CONTROLS (Upload | Shutter | Flip) ── */}
        <View style={styles.camBottomControlsArea}>
          {/* Upload Button */}
          <TouchableOpacity
            style={styles.camBottomIconBtn}
            onPress={pickFromLibrary}
            activeOpacity={0.7}
            disabled={isRecording}
          >
            <Feather name="upload" size={22} color="#ffffff" />
          </TouchableOpacity>

          {/* Shutter / Record Button */}
          <TouchableOpacity
            style={styles.camShutterOuter}
            onPress={handleShutterPress}
            activeOpacity={0.85}
          >
            {cameraMode === 'video' ? (
              isRecording ? (
                <View style={styles.camShutterRecSquare} />
              ) : (
                <View style={styles.camShutterRecCircle} />
              )
            ) : (
              <View style={styles.camShutterPhotoInner} />
            )}
          </TouchableOpacity>

          {/* Flip Camera Button */}
          <TouchableOpacity
            style={styles.camBottomIconBtn}
            onPress={() => setCameraFacing(prev => prev === 'front' ? 'back' : 'front')}
            activeOpacity={0.7}
            disabled={isRecording}
          >
            <Ionicons name="reload" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Text Modal */}
        <Modal visible={showTextModal} transparent animationType="fade">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.camModalOverlay}
          >
            <View style={styles.camModalCard}>
              <View style={styles.camModalHeader}>
                <Text style={styles.camModalTitle}>Add Text</Text>
                <TouchableOpacity onPress={() => setShowTextModal(false)}>
                  <Ionicons name="close" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.camTextInput}
                placeholder="Enter text sticker / overlay..."
                placeholderTextColor="#666"
                value={overlayText}
                onChangeText={setOverlayText}
                autoFocus
              />
              <View style={styles.camModalActions}>
                {!!overlayText && (
                  <TouchableOpacity
                    style={styles.camModalClearBtn}
                    onPress={() => setOverlayText('')}
                  >
                    <Text style={styles.camModalClearText}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.camModalDoneBtn}
                  onPress={() => {
                    if (overlayText && !caption) setCaption(overlayText);
                    setShowTextModal(false);
                  }}
                >
                  <Text style={styles.camModalDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Sound Modal */}
        <Modal visible={showSoundModal} transparent animationType="slide">
          <View style={styles.camModalOverlay}>
            <View style={styles.camModalCard}>
              <View style={styles.camModalHeader}>
                <Text style={styles.camModalTitle}>Select Sound</Text>
                <TouchableOpacity onPress={() => setShowSoundModal(false)}>
                  <Ionicons name="close" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
              {[
                { id: 'orig', title: 'Original Audio', artist: 'Device Microphone' },
                { id: 'ethio_beat', title: 'Ethiopian Vibes (Trending)', artist: 'FlipStar Audio Lab' },
                { id: 'viral_drop', title: 'Viral Club Beat 2026', artist: 'Addis Beats' },
                { id: 'acoustic', title: 'Acoustic Soul', artist: 'Acoustic Session' },
              ].map(s => {
                const isChosen = selectedSound?.id === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.camSoundRow, isChosen && styles.camSoundRowChosen]}
                    onPress={() => {
                      setSelectedSound(s);
                      setShowSoundModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="musical-note"
                      size={18}
                      color={isChosen ? '#8fc441' : '#fff'}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.camSoundTitle, isChosen && { color: '#8fc441' }]}>
                        {s.title}
                      </Text>
                      <Text style={styles.camSoundArtist}>{s.artist}</Text>
                    </View>
                    {isChosen && <Ionicons name="checkmark-circle" size={18} color="#8fc441" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Modal>

        {/* Consent Disclosures */}
        <CameraDisclosure
          visible={showCameraDisclosure}
          colors={colors}
          onAccept={acceptCameraDisclosure}
          onDecline={() => declineDisclosure('camera')}
        />
        <StorageDisclosure
          visible={showStorageDisclosure}
          colors={colors}
          onAccept={acceptStorageDisclosure}
          onDecline={() => declineDisclosure('storage')}
        />
      </View>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 2. STAGE: EDIT (Viewfinder & Filter Studio) ──────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'edit') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {/* Media Background Preview */}
        <View style={StyleSheet.absoluteFill}>
          <Image
            source={{ uri: media.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          {/* Active Cinema Filter Color Overlay */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: filter.overlay }]}
            pointerEvents="none"
          />
        </View>

        {/* Decorative Camera Viewfinder HUD Overlay */}
        <View style={styles.hudOverlay} pointerEvents="none">
          <View style={[styles.hudCrosshair, styles.hudTopLeft]} />
          <View style={[styles.hudCrosshair, styles.hudTopRight]} />
          <View style={[styles.hudCrosshair, styles.hudBottomLeft]} />
          <View style={[styles.hudCrosshair, styles.hudBottomRight]} />
        </View>

        {/* Top Control Bar */}
        <View style={[styles.editHeaderBar, { top: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => setStage('pick')}
            style={styles.editGlassCircleBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>

          {/* Filter Status Badge */}
          <View style={styles.activeFilterPill}>
            <View style={[styles.filterMiniSwatch, { backgroundColor: filter.colors[0] }]} />
            <Text style={styles.activeFilterText}>{filter.name}</Text>
          </View>

          {/* Top Post / Next Button - High visibility & Guaranteed rendering */}
          <TouchableOpacity
            onPress={() => setStage('details')}
            style={styles.topPostButton}
            activeOpacity={0.8}
            accessibilityLabel="Proceed to post"
          >
            <Text style={styles.topPostButtonText}>Post</Text>
            <Ionicons name="arrow-forward" size={16} color="#000" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>

        {/* Floating Right Studio Toolbar */}
        <View style={[styles.editSideToolbar, { top: insets.top + 80 }]}>
          <TouchableOpacity style={styles.sideToolBtn} activeOpacity={0.8}>
            <Ionicons name="musical-notes-outline" size={20} color="#fff" />
            <Text style={styles.sideToolLabel}>Audio</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sideToolBtn} activeOpacity={0.8}>
            <Ionicons name="text-outline" size={20} color="#fff" />
            <Text style={styles.sideToolLabel}>Text</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sideToolBtn} activeOpacity={0.8}>
            <Ionicons name="happy-outline" size={20} color="#fff" />
            <Text style={styles.sideToolLabel}>Stickers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sideToolBtn} activeOpacity={0.8}>
            <Ionicons name="crop-outline" size={20} color="#fff" />
            <Text style={styles.sideToolLabel}>Crop</Text>
          </TouchableOpacity>
        </View>

        {/* Floating Bottom Continue-to-Post Button - Unmissable primary action */}
        <View style={[styles.floatingBottomPostBar, { bottom: insets.bottom + 125 }]} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => setStage('details')}
            style={styles.floatingBigPostBtn}
            activeOpacity={0.85}
            accessibilityLabel="Continue to Post"
          >
            <Ionicons name="checkmark-circle" size={20} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.floatingBigPostText}>Continue to Post</Text>
            <Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </View>

        {/* Bottom Filter Dock */}
        <View style={[styles.filterDock, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.filterDockHeader}>
            <Ionicons name="color-wand-outline" size={14} color="#8fc441" style={{ marginRight: 6 }} />
            <Text style={styles.filterDockTitle}>CINEMATIC LOOKS</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {FILTERS.map(f => {
              const isSelected = filter.id === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFilter(f)}
                  style={[
                    styles.filterCard,
                    isSelected && styles.filterCardSelected
                  ]}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={f.colors}
                    style={styles.filterSwatchGradient}
                  >
                    {isSelected && (
                      <View style={styles.filterSelectedCheck}>
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      </View>
                    )}
                  </LinearGradient>
                  <Text style={[styles.filterCardName, isSelected && styles.filterCardNameSelected]}>
                    {f.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 3. STAGE: DETAILS (Publishing & Metadata) ───────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'details') {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <StatusBar barStyle="light-content" backgroundColor="#08090C" />

        {/* Details Navigation Bar */}
        <View style={[styles.detailsHeader, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => setStage('edit')}
            style={styles.frostedIconBtn}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>

          <View style={styles.detailsHeaderCenter}>
            <Text style={styles.detailsHeaderTitle}>Post Details</Text>
            <Text style={styles.detailsHeaderSub}>Ready to publish to feed</Text>
          </View>

          <TouchableOpacity
            onPress={handlePost}
            style={styles.postNavBtn}
            activeOpacity={0.85}
            accessibilityLabel="Post now"
          >
            <Text style={styles.postNavText}>Post</Text>
            <Ionicons name="arrow-up" size={16} color="#000" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.detailsScroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Media Preview Thumbnail & Info Card */}
          <View style={styles.mediaPreviewCard}>
            <View style={styles.mediaThumbContainer}>
              <Image
                source={{ uri: media.uri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: filter.overlay }]}
                pointerEvents="none"
              />
              <View style={styles.mediaTypeBadge}>
                <Ionicons
                  name={media.type === 'video' ? 'videocam' : 'image'}
                  size={13}
                  color="#fff"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.mediaTypeBadgeText}>
                  {media.type === 'video'
                    ? (media.duration ? `${Math.round(media.duration)}s Reel` : 'Reel')
                    : 'Photo'}
                </Text>
              </View>

              <View style={styles.mediaFilterTag}>
                <Text style={styles.mediaFilterTagText}>{filter.name}</Text>
              </View>
            </View>

            <View style={styles.mediaMetaRight}>
              <Text style={styles.mediaMetaTitle}>
                {media.type === 'video' ? 'Vertical Video' : 'HQ Photo'}
              </Text>
              <Text style={styles.mediaMetaHint}>
                Format: 9:16 Fullscreen{'\n'}
                Filter: {filter.name}{'\n'}
                Visibility: Public Feed
              </Text>
              <TouchableOpacity
                style={styles.changeFilterLink}
                onPress={() => setStage('edit')}
              >
                <Ionicons name="brush-outline" size={13} color="#8fc441" style={{ marginRight: 4 }} />
                <Text style={styles.changeFilterLinkText}>Change look</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Caption Input Card */}
          <View style={styles.cardSection}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardIconWrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#8fc441" />
              </View>
              <Text style={styles.cardLabel}>CAPTION & STORY</Text>
              <Text style={styles.charCounter}>{caption.length}/500</Text>
            </View>

            <TextInput
              style={styles.captionInputField}
              placeholder="Write a catchy caption... What's this moment about?"
              placeholderTextColor="#666"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
            />

            {/* Quick Emoji Reaction Toolbar */}
            <View style={styles.quickEmojiRow}>
              <Text style={styles.quickEmojiPrompt}>Quick Add:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {QUICK_EMOJIS.map(em => (
                  <TouchableOpacity
                    key={em}
                    style={styles.emojiPill}
                    onPress={() => handleEmojiPress(em)}
                  >
                    <Text style={styles.emojiText}>{em}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Hashtags Input Card */}
          <View style={styles.cardSection}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardIconWrap}>
                <Ionicons name="pricetag-outline" size={16} color="#8fc441" />
              </View>
              <Text style={styles.cardLabel}>HASHTAGS</Text>
            </View>

            <View style={styles.hashtagInputRow}>
              <Text style={styles.hashSymbol}>#</Text>
              <TextInput
                style={styles.hashtagInputField}
                placeholder="Add tags separated by space (e.g. #flipstar #dance)"
                placeholderTextColor="#666"
                value={hashtags}
                onChangeText={setHashtags}
                autoCapitalize="none"
              />
            </View>

            {/* Quick Trending Hashtag Chips */}
            <View style={styles.quickTagsContainer}>
              <Text style={styles.quickTagsLabel}>Trending in Ethiopia:</Text>
              <View style={styles.tagChipsWrap}>
                {QUICK_HASHTAGS.map(tag => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.quickTagChip}
                    onPress={() => handleHashtagPress(tag)}
                  >
                    <Ionicons name="trending-up" size={11} color="#8fc441" style={{ marginRight: 3 }} />
                    <Text style={styles.quickTagChipText}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Category Selector Card */}
          <View style={styles.cardSection}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardIconWrap}>
                <Ionicons name="grid-outline" size={16} color="#8fc441" />
              </View>
              <Text style={styles.cardLabel}>CATEGORY</Text>
            </View>

            <View style={styles.categoryPillsGrid}>
              {categories.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={String(cat.id || cat.name)}
                    onPress={() => setSelectedCategory(cat.id)}
                    style={[
                      styles.categoryPill,
                      isSelected && styles.categoryPillSelected
                    ]}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.categoryEmoji}>{cat.emoji || '📁'}</Text>
                    <Text
                      style={[
                        styles.categoryPillText,
                        isSelected && styles.categoryPillTextSelected
                      ]}
                    >
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Coin Cost and Balance Info */}
          {!loadingWallet && (totalCost > 0 || userBalance > 0) && (
            <View style={styles.coinWalletCard}>
              <LinearGradient
                colors={['rgba(143, 196, 65, 0.12)', 'rgba(0, 0, 0, 0.4)']}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.coinWalletHeader}>
                <View style={styles.coinBadgeIconWrap}>
                  <Ionicons name="wallet" size={18} color="#8fc441" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.coinWalletTitle}>Publishing Cost</Text>
                  <Text style={styles.coinWalletSub}>FlipStar Creator Economy</Text>
                </View>
                <View style={styles.coinCostPill}>
                  <Text style={styles.coinCostPillText}>{totalCost} Coins</Text>
                </View>
              </View>

              <View style={styles.coinDivider} />

              <View style={styles.coinRow}>
                <Text style={styles.coinRowLabel}>Creator Balance:</Text>
                <Text style={styles.coinRowValue}>{userBalance.toLocaleString()} Coins</Text>
              </View>

              {longVideoSurcharge > 0 && (
                <View style={styles.surchargeWarning}>
                  <Ionicons name="information-circle-outline" size={14} color="#f59e0b" style={{ marginRight: 4 }} />
                  <Text style={styles.surchargeText}>
                    Includes {longVideoSurcharge} coin surcharge for video &gt; 60 seconds
                  </Text>
                </View>
              )}

              <View style={styles.coinRow}>
                <Text style={styles.coinRowLabel}>Balance after post:</Text>
                <Text
                  style={[
                    styles.coinRowValue,
                    { color: (userBalance - totalCost) < 0 ? '#ff4d4f' : '#8fc441' }
                  ]}
                >
                  {Math.max(0, userBalance - totalCost).toLocaleString()} Coins
                </Text>
              </View>
            </View>
          )}

          {/* Giant Bottom Publish Button */}
          <TouchableOpacity
            style={styles.giantPublishBtn}
            onPress={handlePost}
            activeOpacity={0.88}
            accessibilityLabel="Publish to FlipStar"
          >
            <Ionicons name="rocket-outline" size={22} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.giantPublishText}>Publish to FlipStar</Text>
            <Ionicons name="arrow-forward" size={20} color="#000" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </ScrollView>

        <PaymentReceiptModal
          visible={showPostConfirm}
          onClose={() => setShowPostConfirm(false)}
          onProceed={() => {
            setShowPostConfirm(false);
            executePost();
          }}
          title="Confirm Post"
          amountLabel={`${totalCost}`}
          currency="coins"
          rows={[
            { label: 'Post Cost', value: `${postCost} coins` },
            ...(longVideoSurcharge > 0
              ? [{ label: 'Long Video Surcharge', value: `${longVideoSurcharge} coins` }]
              : []),
            { label: 'Your Balance', value: `${userBalance.toLocaleString()} coins` },
            { label: 'After Posting', value: `${(userBalance - totalCost).toLocaleString()} coins` },
          ]}
          proceedLabel="Confirm & Post"
        />
      </KeyboardAvoidingView>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 4. STAGE: UPLOADING (Animated High-Tech Portal) ─────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <View style={[styles.container, styles.uploadCenter]}>
      <StatusBar barStyle="light-content" backgroundColor="#08090C" />

      {/* Ambient Glows */}
      <View style={styles.uploadGlow} pointerEvents="none">
        <LinearGradient
          colors={['rgba(143, 196, 65, 0.25)', 'transparent']}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.uploadCard}>
        <LinearGradient
          colors={['#1c2025', '#121418']}
          style={styles.uploadCardGradient}
        >
          {/* Animated Orbital Center Icon */}
          <View style={styles.uploadIconOrb}>
            <Animated.View
              style={[
                styles.uploadOrbGlow,
                { transform: [{ scale: pulseAnim }] }
              ]}
            />
            <ActivityIndicator size="large" color="#8fc441" />
          </View>

          <Text style={styles.uploadMainTitle}>Publishing Content</Text>
          <Text style={styles.uploadDynamicStatus}>
            {progress < 30
              ? 'Optimizing high-definition media...'
              : progress < 70
                ? 'Applying audio sync & color grading...'
                : progress < 99
                  ? 'Publishing to FlipStar community...'
                  : 'All done! Going live!'}
          </Text>

          {/* Dual-Track Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarTrack}>
              <LinearGradient
                colors={['#a2e845', '#8fc441']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressBarFill, { width: `${progress}%` }]}
              />
            </View>
            <View style={styles.progressTextRow}>
              <Text style={styles.progressPercent}>{progress}%</Text>
              <Text style={styles.progressStatusLabel}>Uploading...</Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* Decorative Insufficient Coins Modal */}
      {showInsufficientCoinsModal && (
        <Modal transparent animationType="fade">
          <View style={styles.insufficientOverlay}>
            <View style={styles.insufficientCard}>
              <LinearGradient
                colors={['#1f242b', '#13151a']}
                style={styles.insufficientGradient}
              >
                <View style={styles.insufficientIconCircle}>
                  <Ionicons name="wallet-outline" size={32} color="#ff4d4f" />
                </View>

                <Text style={styles.insufficientTitle}>Insufficient Coins</Text>
                <Text style={styles.insufficientMessage}>
                  You need {totalCost} coins to publish this post
                  {longVideoSurcharge > 0 ? ` (includes ${longVideoSurcharge} coin video surcharge)` : ''}, but your balance is {userBalance.toLocaleString()} coins.
                </Text>

                <View style={styles.coinsSummaryBox}>
                  <View style={styles.coinsRow}>
                    <Text style={styles.coinsLabel}>Required:</Text>
                    <Text style={styles.coinsValueReq}>{totalCost} coins</Text>
                  </View>
                  <View style={styles.coinsRow}>
                    <Text style={styles.coinsLabel}>Your Balance:</Text>
                    <Text style={styles.coinsValueBal}>{userBalance.toLocaleString()} coins</Text>
                  </View>
                  <View style={styles.coinsRow}>
                    <Text style={styles.coinsLabel}>Shortfall:</Text>
                    <Text style={styles.coinsValueShort}>{Math.max(0, totalCost - userBalance)} coins</Text>
                  </View>
                </View>

                <View style={styles.modalActionButtons}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setShowInsufficientCoinsModal(false)}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalGetCoinsBtn}
                    onPress={() => {
                      setShowInsufficientCoinsModal(false);
                      navigation.navigate('WebsiteCoin');
                    }}
                  >
                    <LinearGradient
                      colors={['#a2e845', '#8fc441']}
                      style={styles.modalGetCoinsGradient}
                    >
                      <Ionicons name="sparkles" size={16} color="#000" style={{ marginRight: 4 }} />
                      <Text style={styles.modalGetCoinsText}>Get Coins</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── STYLES ───────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  // Ambient Aurora
  ambientAuroraTop: {
    position: 'absolute',
    top: -60,
    left: -40,
    right: -40,
    height: 340,
    zIndex: 0,
  },
  ambientGlowBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    zIndex: 0,
  },

  // Studio Header
  studioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 10,
  },
  frostedIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    alignItems: 'center',
  },
  studioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(143, 196, 65, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.3)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8fc441',
    marginRight: 5,
  },
  studioPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#8fc441',
    letterSpacing: 0.8,
  },
  headerBrandTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },

  // Coin Balance Pill
  coinBalancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 4,
    paddingLeft: 5,
    paddingRight: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.35)',
  },
  coinIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#8fc441',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  coinBalanceText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    marginRight: 4,
  },
  coinAddBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#8fc441',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Pick Body
  pickScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // Hero Section
  heroContainer: {
    marginBottom: 16,
  },
  heroSparkleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(143, 196, 65, 0.12)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.25)',
  },
  tagBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8fc441',
    letterSpacing: 0.6,
  },
  campaignActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8fc441',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  campaignActivePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#000',
  },
  heroHeading: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 33,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  heroHeadingHighlight: {
    color: '#8fc441',
  },
  heroSubheading: {
    fontSize: 13,
    color: '#9aa0a6',
    lineHeight: 18,
  },

  // Mode Selector
  modeSelectorWrap: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modeChipActive: {
    backgroundColor: '#8fc441',
    borderColor: '#8fc441',
  },
  modeChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d1d5db',
  },
  modeChipTextActive: {
    color: '#000',
  },
  modeMiniBadge: {
    backgroundColor: '#000',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 4,
  },
  modeMiniBadgeText: {
    fontSize: 7,
    fontWeight: '900',
    color: '#8fc441',
  },

  // Showcase Record Video Card
  recordHeroCard: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  recordHeroGradient: {
    padding: 20,
    position: 'relative',
    minHeight: 145,
    justifyContent: 'space-between',
  },
  // Viewfinder Brackets
  hudBracket: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: 'rgba(0, 0, 0, 0.25)',
  },
  hudTopLeft: {
    top: 10,
    left: 10,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  hudTopRight: {
    top: 10,
    right: 10,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  hudBottomLeft: {
    bottom: 10,
    left: 10,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  hudBottomRight: {
    bottom: 10,
    right: 10,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  heroPopularBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  heroPopularBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.5,
  },
  recordLensRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  lensOuterRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  lensPulsingGlow: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  lensCore: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  redRecordDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ff3b30',
  },
  recordTextContainer: {
    flex: 1,
  },
  recordHeroTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#000',
    letterSpacing: -0.3,
  },
  recordHeroSubtitle: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.75)',
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 16,
  },
  specStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 6,
  },
  specPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  specPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1b300a',
  },
  specArrowCircle: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Action Grid
  actionGridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  gridCard: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  gridCardGradient: {
    padding: 16,
    minHeight: 145,
    justifyContent: 'space-between',
  },
  gridCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gridIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTag: {
    backgroundColor: 'rgba(143, 196, 65, 0.14)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  gridTagText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#8fc441',
    letterSpacing: 0.5,
  },
  gridCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    marginTop: 10,
  },
  gridCardSub: {
    fontSize: 11,
    color: '#8e95a0',
    lineHeight: 15,
    marginTop: 2,
  },
  gridCardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 3,
  },
  gridActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8fc441',
  },



  // Toolkit Section
  toolkitSection: {
    marginBottom: 20,
  },
  toolkitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  toolkitTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.8,
  },
  toolkitSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8fc441',
    letterSpacing: 0.5,
  },
  toolkitGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  toolItem: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  toolIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  toolName: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  toolDesc: {
    fontSize: 8,
    color: '#8e95a0',
    textAlign: 'center',
    marginTop: 2,
  },

  // ── EDIT STAGE STYLES ───────────────────────────────────────────────────────
  hudOverlay: {
    ...StyleSheet.absoluteFillObject,
    margin: 24,
  },
  hudCrosshair: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  editHeaderBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 20,
  },
  editGlassCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.4)',
  },
  filterMiniSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  activeFilterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  topPostButton: {
    backgroundColor: '#8fc441',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
    minHeight: 40,
    minWidth: 88,
    elevation: 8,
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
  },
  topPostButtonText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.2,
  },
  floatingBottomPostBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 35,
  },
  floatingBigPostBtn: {
    backgroundColor: '#8fc441',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 30,
    elevation: 10,
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    borderWidth: 1.5,
    borderColor: '#a2e845',
  },
  floatingBigPostText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.2,
  },
  nextGradientBtn: {
    backgroundColor: '#8fc441',
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  nextGradientFill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nextGradientText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000',
  },
  editSideToolbar: {
    position: 'absolute',
    right: 16,
    gap: 14,
    zIndex: 20,
  },
  sideToolBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideToolLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#fff',
    marginTop: 1,
  },
  filterDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(8, 9, 12, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    paddingTop: 12,
    zIndex: 20,
  },
  filterDockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  filterDockTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#8fc441',
    letterSpacing: 0.8,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  filterCard: {
    alignItems: 'center',
    padding: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  filterCardSelected: {
    borderColor: '#8fc441',
    backgroundColor: 'rgba(143, 196, 65, 0.1)',
  },
  filterSwatchGradient: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSelectedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#8fc441',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCardName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#a0aec0',
    marginTop: 6,
  },
  filterCardNameSelected: {
    color: '#fff',
    fontWeight: '800',
  },

  // ── DETAILS STAGE STYLES ────────────────────────────────────────────────────
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  detailsHeaderCenter: {
    alignItems: 'center',
  },
  detailsHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  detailsHeaderSub: {
    fontSize: 11,
    color: '#8fc441',
    fontWeight: '600',
  },
  postNavBtn: {
    backgroundColor: '#8fc441',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 18,
    minHeight: 38,
    elevation: 6,
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  postNavFill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postNavText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#000',
  },
  detailsScroll: {
    padding: 16,
    gap: 16,
  },
  mediaPreviewCard: {
    flexDirection: 'row',
    backgroundColor: '#121418',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 10,
    gap: 14,
  },
  mediaThumbContainer: {
    width: 100,
    height: 130,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  mediaTypeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  mediaTypeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
  },
  mediaFilterTag: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(143, 196, 65, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  mediaFilterTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#000',
  },
  mediaMetaRight: {
    flex: 1,
    justifyContent: 'center',
  },
  mediaMetaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  mediaMetaHint: {
    fontSize: 11,
    color: '#8e95a0',
    lineHeight: 16,
    marginBottom: 8,
  },
  changeFilterLink: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  changeFilterLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8fc441',
  },

  // Detail Cards
  cardSection: {
    backgroundColor: '#121418',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(143, 196, 65, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.6,
  },
  charCounter: {
    marginLeft: 'auto',
    fontSize: 11,
    color: '#8e95a0',
  },
  captionInputField: {
    fontSize: 14,
    color: '#fff',
    minHeight: 70,
    textAlignVertical: 'top',
  },
  quickEmojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingTop: 8,
    marginTop: 6,
  },
  quickEmojiPrompt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8fc441',
    marginRight: 8,
  },
  emojiPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    marginRight: 6,
  },
  emojiText: {
    fontSize: 14,
  },

  // Hashtags
  hashtagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  hashSymbol: {
    fontSize: 18,
    fontWeight: '900',
    color: '#8fc441',
    marginRight: 6,
  },
  hashtagInputField: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
  },
  quickTagsContainer: {
    marginTop: 10,
  },
  quickTagsLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8e95a0',
    marginBottom: 6,
  },
  tagChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(143, 196, 65, 0.1)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.25)',
  },
  quickTagChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8fc441',
  },

  // Category Selector
  categoryPillsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  categoryPillSelected: {
    backgroundColor: '#8fc441',
    borderColor: '#8fc441',
  },
  categoryEmoji: {
    fontSize: 13,
    marginRight: 5,
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  categoryPillTextSelected: {
    color: '#000',
    fontWeight: '800',
  },

  // Coin Wallet Card
  coinWalletCard: {
    backgroundColor: '#14181b',
    borderRadius: 18,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.3)',
  },
  coinWalletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  coinBadgeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(143, 196, 65, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinWalletTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  coinWalletSub: {
    fontSize: 10,
    color: '#8e95a0',
  },
  coinCostPill: {
    backgroundColor: 'rgba(143, 196, 65, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8fc441',
  },
  coinCostPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#8fc441',
  },
  coinDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 12,
  },
  coinRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  coinRowLabel: {
    fontSize: 12,
    color: '#8e95a0',
    fontWeight: '500',
  },
  coinRowValue: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
  },
  surchargeWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    padding: 8,
    borderRadius: 8,
    marginVertical: 6,
  },
  surchargeText: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
    flex: 1,
  },

  // Giant Bottom Publish Button
  giantPublishBtn: {
    backgroundColor: '#8fc441',
    borderRadius: 22,
    marginTop: 8,
    marginBottom: 36,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  giantPublishGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  giantPublishText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000',
    letterSpacing: -0.2,
  },

  // ── UPLOADING STAGE STYLES ──────────────────────────────────────────────────
  uploadCenter: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  uploadGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  uploadCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.35)',
    elevation: 10,
  },
  uploadCardGradient: {
    padding: 30,
    alignItems: 'center',
  },
  uploadIconOrb: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(143, 196, 65, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  uploadOrbGlow: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(143, 196, 65, 0.1)',
  },
  uploadMainTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 6,
  },
  uploadDynamicStatus: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  progressContainer: {
    width: '100%',
  },
  progressBarTrack: {
    width: '100%',
    height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8fc441',
  },
  progressStatusLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },

  // Insufficient Coins Modal
  insufficientOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  insufficientCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  insufficientGradient: {
    padding: 24,
    alignItems: 'center',
  },
  insufficientIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 77, 79, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  insufficientTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
  },
  insufficientMessage: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  coinsSummaryBox: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  coinsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  coinsLabel: {
    fontSize: 13,
    color: '#94a3b8',
  },
  coinsValueReq: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ff4d4f',
  },
  coinsValueBal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  coinsValueShort: {
    fontSize: 14,
    fontWeight: '900',
    color: '#8fc441',
  },
  modalActionButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  modalGetCoinsBtn: {
    flex: 1.2,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalGetCoinsGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  modalGetCoinsText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ── IN-APP CAMERA STYLES (Image 1 Pixel Match) ──────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  camContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#000000',
    zIndex: 10,
  },
  camTopCircleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(35, 35, 35, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camModePillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    gap: 4,
  },
  camModePillOption: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camModePillActive: {
    backgroundColor: '#8fc441',
  },
  camModePillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  camModePillTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  camRecordingBanner: {
    position: 'absolute',
    top: 75,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    zIndex: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.4)',
  },
  camRecordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff3b30',
    marginRight: 6,
  },
  camRecordingTimerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  camViewfinderArea: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  camViewport: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
  },
  camRightSidebar: {
    position: 'absolute',
    right: 12,
    top: '30%',
    gap: 16,
    alignItems: 'center',
    zIndex: 15,
  },
  camSideItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  camSideCircleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(40, 40, 40, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  camSideCircleBtnActive: {
    borderColor: '#8fc441',
    backgroundColor: 'rgba(143, 196, 65, 0.25)',
  },
  camSideLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  camLiveTextBadge: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8fc441',
  },
  camLiveTextContent: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  camFilterDockOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: 8,
  },
  camFilterDockScroll: {
    paddingHorizontal: 12,
    gap: 10,
  },
  camFilterChip: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  camFilterChipSelected: {
    backgroundColor: 'rgba(143, 196, 65, 0.2)',
  },
  camFilterChipCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  camFilterChipText: {
    color: '#ccc',
    fontSize: 10,
    fontWeight: '600',
  },
  camFilterChipTextSel: {
    color: '#8fc441',
    fontWeight: '800',
  },
  camBottomControlsArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 30,
    paddingVertical: 18,
    backgroundColor: '#000000',
  },
  camBottomIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(35, 35, 35, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camShutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#ffffff',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  camShutterRecCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ff3b30',
  },
  camShutterRecSquare: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#ff3b30',
  },
  camShutterPhotoInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
  },
  camPermissionPlaceholder: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camPermIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(143, 196, 65, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  camPermTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
  },
  camPermSub: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
    maxWidth: 280,
  },
  camPermBtn: {
    backgroundColor: '#8fc441',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  camPermBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
  camModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  camModalCard: {
    backgroundColor: '#16181d',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  camModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  camModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  camTextInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 14,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  camModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  camModalClearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  camModalClearText: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 14,
  },
  camModalDoneBtn: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#8fc441',
  },
  camModalDoneText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
  camSoundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  camSoundRowChosen: {
    backgroundColor: 'rgba(143, 196, 65, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  camSoundTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  camSoundArtist: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
});

