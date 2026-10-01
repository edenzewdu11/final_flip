import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';
import { AppAlert } from '../../components/common/AppAlert';

// FlipStar Brand Colors (strictly Brand Lime & Dark theme, NO red, NO orange, NO brown)
const BRAND_LIME = '#8fc441';
const BRAND_LIME_LIGHT = '#a2e845';
const BRAND_LIME_DARK = '#6ea729';
const COIN_GOLD = '#FFD700';

function n(val, key) {
  if (val == null) return 0;
  if (typeof val === 'object') return val[key] ?? val.current ?? val.balance ?? 0;
  return Number(val) || 0;
}

// 7-Day Streak Coins (matching old functionality: only coins!)
const STREAK_DAYS = [
  { day: 1, coins: 5 },
  { day: 2, coins: 10 },
  { day: 3, coins: 15 },
  { day: 4, coins: 20 },
  { day: 5, coins: 30 },
  { day: 6, coins: 40 },
  { day: 7, coins: 50 },
];

// Milestone checkpoints for the 30-day track (only coins!)
const MILESTONES = [
  { day: 8, coins: 25 },
  { day: 15, coins: 50 },
  { day: 22, coins: 75 },
  { day: 30, coins: 150 },
];

export default function GamificationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width } = Dimensions.get('window');

  const [status, setStatus] = useState(null);
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [countdown, setCountdown] = useState('');

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Countdown timer to next midnight reward
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const diff = midnight - now;
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdown(
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      );
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadAll();

    // Pulse animation for active button / today card
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 850, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 850, useNativeDriver: true }),
      ])
    ).start();

    // Entrance animations
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]).start();
  }, []);

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const [s, q] = await Promise.all([
        api.request('/gamification/status/').catch(() => null),
        api.request('/quests/').catch(() => []),
      ]);

      if (s && (!s.gifts || (s.gifts.sent_today === 0 && s.gifts.received_today === 0))) {
        try {
          const giftHistory = await api.request('/gamification/gifts/history/');
          if (giftHistory) {
            const today = new Date().toDateString();
            const sentToday = (giftHistory.sent || []).filter(
              (g) => new Date(g.created_at).toDateString() === today
            ).length;
            const receivedToday = (giftHistory.received || []).filter(
              (g) => new Date(g.created_at).toDateString() === today
            ).length;
            const sentTotal = (giftHistory.sent || []).length;
            s.gifts = {
              ...s.gifts,
              sent_today: sentToday,
              received_today: receivedToday,
              sent_total: sentTotal,
            };
          }
        } catch (_) {}
      }

      setStatus(s);
      setQuests(Array.isArray(q) ? q : q?.results || []);
    } catch (e) {
      console.log('Error loading gamification data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Claim functionality exactly like old implementation
  const claimBonus = async () => {
    if (claimingBonus) return;
    setClaimingBonus(true);
    try {
      const res = await api.request('/gamification/login-bonus/', { method: 'POST' });
      AppAlert.alert('🎁 Bonus Claimed!', 'You earned ' + (res.coins_earned || res.coins || 0) + ' coins!');
      loadAll(true);
    } catch (e) {
      const errorMessage = e?.message || '';
      if (errorMessage.includes('already claimed today')) {
        AppAlert.alert('⏰ Bonus Already Claimed', 'You already claimed your login bonus today. Come back tomorrow for your next bonus!');
      } else {
        AppAlert.alert('Error', e?.message || 'Could not claim bonus.');
      }
    } finally {
      setClaimingBonus(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: '#0B0D09' }]}>
        <ActivityIndicator size="large" color={BRAND_LIME} />
        <Text style={{ color: '#fff', marginTop: 12, fontWeight: '700' }}>Loading Rewards...</Text>
      </View>
    );
  }

  const coins = n(status?.coins?.balance ?? status?.wallet?.balance?.total ?? status?.total_coins, 'balance');
  const points = n(status?.points, 'balance');
  const streak = n(status?.login_streak, 'current');
  const longest = n(status?.login_streak, 'longest');
  const bonusAvailable = status?.login_streak?.bonus_available ?? false;
  const nextBonus = status?.login_streak?.next_bonus?.coins ?? (streak >= 6 ? 50 : (streak + 1) * 5);

  // Position in the 7-day cycle (1 to 7)
  const currentCycleDay = streak === 0 ? 1 : ((streak - 1) % 7) + 1;
  // Position in the 30-day milestone progress
  const currentMonthDay = Math.min(streak, 30);
  const milestoneProgress = Math.min(currentMonthDay / 30, 1);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header Navigation Bar */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rewards</Text>
        <TouchableOpacity onPress={() => loadAll(true)} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="refresh" size={20} color={BRAND_LIME} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadAll(true)} tintColor={BRAND_LIME} />
        }
      >
        {/* HERO STATS CARD (From old functionality, sleek Brand Lime & Dark styling) */}
        <Animated.View
          style={[
            styles.heroCard,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(143, 196, 65, 0.16)', 'rgba(143, 196, 65, 0.02)']}
            style={styles.heroGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.heroMain}>
            <Animated.View style={[styles.coinCircle, { transform: [{ scale: pulseAnim }] }]}>
              <FontAwesome5 name="coins" size={26} color="#000" />
            </Animated.View>
            <View style={{ marginLeft: 16 }}>
              <Text style={styles.coinAmount}>{coins.toLocaleString()}</Text>
              <Text style={styles.coinLabel}>Coins Balance</Text>
            </View>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <View style={styles.statIconContainer}>
                <Ionicons name="flame" size={16} color={BRAND_LIME} />
              </View>
              <Text style={styles.heroStatVal}>{streak}</Text>
              <Text style={styles.heroStatLabel}>Streak</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <View style={styles.statIconContainer}>
                <Ionicons name="star" size={16} color={BRAND_LIME} />
              </View>
              <Text style={styles.heroStatVal}>{points.toLocaleString()}</Text>
              <Text style={styles.heroStatLabel}>Points</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <View style={styles.statIconContainer}>
                <Ionicons name="trophy" size={16} color={BRAND_LIME} />
              </View>
              <Text style={styles.heroStatVal}>{longest}</Text>
              <Text style={styles.heroStatLabel}>Best</Text>
            </View>
          </View>
        </Animated.View>

        {/* 3D RIBBON BANNER: "Reward Calendar" IN BRAND LIME (NO RED!) */}
        <View style={styles.ribbonContainer}>
          <View style={styles.ribbonFoldLeft} />
          <LinearGradient
            colors={[BRAND_LIME_LIGHT, BRAND_LIME, BRAND_LIME_DARK]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ribbonBody}
          >
            <View style={styles.ribbonStitchTop} />
            <Text style={styles.ribbonText}>Reward Calendar</Text>
            <View style={styles.ribbonStitchBottom} />
          </LinearGradient>
          <View style={styles.ribbonFoldRight} />
        </View>

        {/* MAIN REWARD CALENDAR BOARD (Sleek Dark & Brand Lime - NO BROWN!) */}
        <View style={styles.boardContainer}>
          <LinearGradient
            colors={['#161912', '#12140F', '#0D0F0A']}
            style={styles.boardInner}
          >
            {/* 1. TOP MILESTONE PROGRESS TRACK (Days 8, 15, 22, 30 in Coins!) */}
            <View style={styles.milestoneShelf}>
              {/* Progress Line Track */}
              <View style={styles.milestoneTrack}>
                <View style={[styles.milestoneFill, { width: `${milestoneProgress * 100}%` }]} />
              </View>

              {/* Left Checkmark Stamp */}
              <View style={[styles.sealBadge, streak > 0 && styles.sealBadgeActive]}>
                <Ionicons name="checkmark" size={15} color="#000" style={{ fontWeight: '900' }} />
              </View>

              {/* Milestone Checkpoints (8, 15, 22, 30) */}
              <View style={styles.milestoneNodesRow}>
                {MILESTONES.map((m) => {
                  const reached = currentMonthDay >= m.day;
                  return (
                    <View key={m.day} style={styles.milestoneNode}>
                      <View style={[styles.milestoneIconWrap, reached && styles.milestoneIconWrapReached]}>
                        <FontAwesome5
                          name="coins"
                          size={18}
                          color={reached ? BRAND_LIME : '#666'}
                        />
                      </View>
                      <View style={[styles.milestoneDayBadge, reached && styles.milestoneDayBadgeReached]}>
                        <Text style={[styles.milestoneDayText, reached && styles.milestoneDayTextReached]}>
                          {m.day}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* 2. 7-DAY REWARD CARDS (Coins only!) */}
            <View style={styles.calendarGrid}>
              {/* Row 1: Days 1, 2, 3 */}
              <View style={styles.cardRow}>
                {STREAK_DAYS.slice(0, 3).map((item) => renderCoinDayCard(item))}
              </View>

              {/* Row 2: Days 4, 5, 6 */}
              <View style={styles.cardRow}>
                {STREAK_DAYS.slice(3, 6).map((item) => renderCoinDayCard(item))}
              </View>

              {/* Row 3: Day 7 (Special Full-Width Mega Card) */}
              {renderDay7MegaCard(STREAK_DAYS[6])}
            </View>
          </LinearGradient>
        </View>

        {/* 3. BIG BOTTOM ACTION BUTTON ("Tap to collect") */}
        <View style={styles.bottomActionContainer}>
          {bonusAvailable ? (
            <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
              <TouchableOpacity
                style={styles.collectButton}
                activeOpacity={0.85}
                onPress={claimBonus}
                disabled={claimingBonus}
              >
                <LinearGradient
                  colors={[BRAND_LIME_LIGHT, BRAND_LIME, BRAND_LIME_DARK]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.collectGradient}
                >
                  {claimingBonus ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <>
                      <FontAwesome5 name="coins" size={20} color="#000" style={{ marginRight: 10 }} />
                      <Text style={styles.collectButtonText}>
                        Tap to collect (+{nextBonus} Coins)
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <View style={styles.claimedButton}>
              <LinearGradient
                colors={['#1F241A', '#151A10', '#0E130A']}
                style={styles.claimedGradient}
              >
                <Ionicons name="checkmark-circle" size={22} color={BRAND_LIME} style={{ marginRight: 10 }} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.claimedButtonText}>Bonus Claimed Today</Text>
                  <Text style={styles.countdownText}>Next reward in: {countdown}</Text>
                </View>
              </LinearGradient>
            </View>
          )}
        </View>

        {/* 4. DAILY QUESTS SECTION (From old functionality) */}
        {quests.length > 0 && (
          <View style={styles.questsSection}>
            <View style={styles.questsHeader}>
              <View style={styles.questsHeaderIcon}>
                <Ionicons name="list" size={16} color={BRAND_LIME} />
              </View>
              <Text style={styles.questsTitle}>Quests</Text>
              <View style={styles.questsCountBadge}>
                <Text style={styles.questsCountText}>{quests.length}</Text>
              </View>
            </View>

            {quests.map((q) => (
              <View key={q.id} style={styles.questCard}>
                <View style={styles.questCheckIcon}>
                  <Ionicons name="checkmark-done" size={16} color="#000" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.questCardTitle}>{q.title || q.name}</Text>
                  {q.description ? (
                    <Text style={styles.questCardDesc}>{q.description}</Text>
                  ) : null}
                </View>
                <View style={styles.questRewardBadge}>
                  <FontAwesome5 name="coins" size={11} color={COIN_GOLD} />
                  <Text style={styles.questRewardText}>+{q.reward_coins || q.coins || 0}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  // Helper to render Day 1 - 6 cards (Only Coins!)
  function renderCoinDayCard(item) {
    const isClaimed = streak >= item.day;
    const isToday = bonusAvailable && currentCycleDay === item.day;

    return (
      <View
        key={item.day}
        style={[
          styles.dayCard,
          isToday && styles.dayCardToday,
          isClaimed && styles.dayCardClaimed,
        ]}
      >
        {/* Header Tab */}
        <View
          style={[
            styles.cardHeaderTab,
            isToday
              ? styles.cardHeaderTabToday
              : isClaimed
              ? styles.cardHeaderTabClaimed
              : styles.cardHeaderTabFuture,
          ]}
        >
          <Text
            style={[
              styles.cardHeaderText,
              isToday && styles.cardHeaderTextToday,
              isClaimed && styles.cardHeaderTextClaimed,
            ]}
          >
            Day {item.day}
          </Text>
        </View>

        {/* Card Body */}
        <View style={styles.cardBody}>
          <View style={styles.rewardGraphicBox}>
            <FontAwesome5
              name="coins"
              size={item.day >= 4 ? 32 : 28}
              color={COIN_GOLD}
            />
          </View>

          <Text style={[styles.rewardAmountText, isClaimed && styles.rewardAmountTextClaimed]}>
            +{item.coins} Coins
          </Text>

          {/* Claimed Stamp */}
          {isClaimed && (
            <View style={styles.claimedOverlay}>
              <View style={styles.claimedStamp}>
                <Ionicons name="checkmark-sharp" size={22} color="#000" />
              </View>
            </View>
          )}

          {/* Active Highlight for Today */}
          {isToday && (
            <View style={styles.todayHighlightBadge}>
              <Text style={styles.todayHighlightText}>READY</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // Helper to render Day 7 Mega Card (Only Coins!)
  function renderDay7MegaCard(item) {
    const isClaimed = streak >= 7;
    const isToday = bonusAvailable && currentCycleDay === 7;

    return (
      <View
        style={[
          styles.day7Card,
          isToday && styles.dayCardToday,
          isClaimed && styles.dayCardClaimed,
        ]}
      >
        {/* Header Tab */}
        <View
          style={[
            styles.cardHeaderTab,
            styles.cardHeaderTabWide,
            isToday
              ? styles.cardHeaderTabToday
              : isClaimed
              ? styles.cardHeaderTabClaimed
              : styles.cardHeaderTabFuture,
          ]}
        >
          <Ionicons name="star" size={13} color={isToday ? '#000' : BRAND_LIME} style={{ marginRight: 6 }} />
          <Text
            style={[
              styles.cardHeaderText,
              isToday && styles.cardHeaderTextToday,
              isClaimed && styles.cardHeaderTextClaimed,
            ]}
          >
            Day 7 - Mega Bonus
          </Text>
          <Ionicons name="star" size={13} color={isToday ? '#000' : BRAND_LIME} style={{ marginLeft: 6 }} />
        </View>

        {/* Day 7 Content */}
        <View style={styles.day7Body}>
          <View style={styles.day7GraphicRow}>
            <View style={styles.day7CoinGroup}>
              <FontAwesome5 name="coins" size={36} color={COIN_GOLD} />
            </View>
            <View style={styles.day7TextGroup}>
              <Text style={styles.day7RewardTitle}>+{item.coins} Coins</Text>
              <Text style={styles.day7RewardSub}>7-Day Streak Complete!</Text>
            </View>
          </View>

          {/* Claimed Overlay */}
          {isClaimed && (
            <View style={styles.claimedOverlay}>
              <View style={styles.claimedStamp}>
                <Ionicons name="checkmark-sharp" size={26} color="#000" />
              </View>
            </View>
          )}

          {/* Active Highlight for Day 7 */}
          {isToday && (
            <View style={styles.todayHighlightBadge}>
              <Text style={styles.todayHighlightText}>MEGA REWARD READY</Text>
            </View>
          )}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0C08',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Navigation Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#161912',
    borderWidth: 1,
    borderColor: '#262D1D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },

  // Hero Card (From old functionality, Brand Lime & Dark styling)
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262D1D',
    backgroundColor: '#12150E',
    padding: 18,
    marginBottom: 20,
    position: 'relative',
    overflow: 'hidden',
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroMain: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  coinCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BRAND_LIME,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: BRAND_LIME,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  coinAmount: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
  },
  coinLabel: {
    fontSize: 12,
    color: '#8A9580',
    marginTop: 2,
    fontWeight: '600',
  },
  heroStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroStat: {
    alignItems: 'center',
    flex: 1,
  },
  statIconContainer: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(143, 196, 65, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  heroStatVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 2,
  },
  heroStatLabel: {
    fontSize: 10,
    color: '#8A9580',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroStatDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#262D1D',
  },

  // 3D Ribbon Banner in Brand Lime
  ribbonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -16,
    zIndex: 20,
  },
  ribbonBody: {
    paddingHorizontal: 32,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BRAND_LIME_LIGHT,
    shadowColor: BRAND_LIME,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  ribbonText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#000',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  ribbonStitchTop: {
    position: 'absolute',
    top: 2,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  ribbonStitchBottom: {
    position: 'absolute',
    bottom: 2,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  ribbonFoldLeft: {
    position: 'absolute',
    left: 12,
    bottom: -6,
    width: 14,
    height: 14,
    backgroundColor: BRAND_LIME_DARK,
    transform: [{ rotate: '45deg' }],
    zIndex: -1,
  },
  ribbonFoldRight: {
    position: 'absolute',
    right: 12,
    bottom: -6,
    width: 14,
    height: 14,
    backgroundColor: BRAND_LIME_DARK,
    transform: [{ rotate: '45deg' }],
    zIndex: -1,
  },

  // Main Board Frame (Dark gaming board with Brand Lime border)
  boardContainer: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#2F3A22',
    backgroundColor: '#0F120A',
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
    marginTop: 6,
  },
  boardInner: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingTop: 16,
    paddingBottom: 14,
    overflow: 'hidden',
  },

  // 1. Milestone Shelf (Days 8, 15, 22, 30)
  milestoneShelf: {
    backgroundColor: '#181E12',
    borderWidth: 1,
    borderColor: '#2E3A20',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 14,
    position: 'relative',
  },
  milestoneTrack: {
    position: 'absolute',
    top: 36,
    left: 44,
    right: 28,
    height: 5,
    backgroundColor: '#26301A',
    borderRadius: 3,
    zIndex: 1,
  },
  milestoneFill: {
    height: '100%',
    backgroundColor: BRAND_LIME,
    borderRadius: 3,
  },
  sealBadge: {
    position: 'absolute',
    top: 16,
    left: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#26301A',
    borderWidth: 1.5,
    borderColor: '#3D4D2A',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  sealBadgeActive: {
    backgroundColor: BRAND_LIME,
    borderColor: BRAND_LIME_LIGHT,
  },
  milestoneNodesRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 2,
    gap: 14,
  },
  milestoneNode: {
    alignItems: 'center',
    width: 44,
  },
  milestoneIconWrap: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  milestoneIconWrapReached: {
    transform: [{ scale: 1.1 }],
  },
  milestoneDayBadge: {
    width: 24,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#222B17',
    borderWidth: 1,
    borderColor: '#384725',
    justifyContent: 'center',
    alignItems: 'center',
  },
  milestoneDayBadgeReached: {
    backgroundColor: BRAND_LIME,
    borderColor: BRAND_LIME_LIGHT,
  },
  milestoneDayText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#8A9580',
  },
  milestoneDayTextReached: {
    color: '#000',
  },

  // 2. Calendar Grid
  calendarGrid: {
    gap: 8,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dayCard: {
    flex: 1,
    backgroundColor: '#171B12',
    borderWidth: 1.5,
    borderColor: '#2A341E',
    borderRadius: 14,
    overflow: 'hidden',
  },
  dayCardToday: {
    borderColor: BRAND_LIME,
    borderWidth: 2,
    backgroundColor: '#1E2517',
    shadowColor: BRAND_LIME,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  dayCardClaimed: {
    opacity: 0.65,
    backgroundColor: '#12150E',
  },

  // Card Header Tabs
  cardHeaderTab: {
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2A341E',
  },
  cardHeaderTabWide: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderTabToday: {
    backgroundColor: BRAND_LIME,
    borderBottomColor: BRAND_LIME_DARK,
  },
  cardHeaderTabClaimed: {
    backgroundColor: '#1D2416',
    borderBottomColor: '#26301C',
  },
  cardHeaderTabFuture: {
    backgroundColor: '#202619',
    borderBottomColor: '#2A341E',
  },
  cardHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8A9580',
    letterSpacing: 0.3,
  },
  cardHeaderTextToday: {
    color: '#000',
    fontWeight: '900',
  },
  cardHeaderTextClaimed: {
    color: BRAND_LIME,
  },

  // Card Body
  cardBody: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  rewardGraphicBox: {
    width: 44,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  rewardAmountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFF',
    textAlign: 'center',
  },
  rewardAmountTextClaimed: {
    color: '#666',
  },

  // Day 7 Mega Card (Full Width)
  day7Card: {
    backgroundColor: '#171B12',
    borderWidth: 1.5,
    borderColor: '#2A341E',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 2,
  },
  day7Body: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  day7GraphicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  day7CoinGroup: {
    width: 48,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  day7TextGroup: {
    alignItems: 'flex-start',
  },
  day7RewardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.2,
  },
  day7RewardSub: {
    fontSize: 11,
    fontWeight: '600',
    color: BRAND_LIME,
    marginTop: 2,
  },

  // Claimed Stamp Overlay
  claimedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 13, 8, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  claimedStamp: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: BRAND_LIME,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  todayHighlightBadge: {
    position: 'absolute',
    bottom: 2,
    backgroundColor: BRAND_LIME,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  todayHighlightText: {
    fontSize: 7,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.5,
  },

  // 3. Bottom Action Button
  bottomActionContainer: {
    marginTop: 18,
    alignItems: 'center',
  },
  collectButton: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: BRAND_LIME,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
  },
  collectGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: 22,
  },
  collectButtonText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  claimedButton: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#262D1D',
  },
  claimedGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  claimedButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#E0E0E0',
  },
  countdownText: {
    fontSize: 11,
    fontWeight: '700',
    color: BRAND_LIME,
    marginTop: 2,
  },

  // 4. Daily Quests Section
  questsSection: {
    marginTop: 22,
    backgroundColor: '#12150E',
    borderWidth: 1,
    borderColor: '#262D1D',
    borderRadius: 18,
    padding: 16,
  },
  questsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  questsHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(143, 196, 65, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  questsTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFF',
    flex: 1,
  },
  questsCountBadge: {
    backgroundColor: 'rgba(143, 196, 65, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  questsCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: BRAND_LIME,
  },
  questCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181C13',
    borderWidth: 1,
    borderColor: '#28321D',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  questCheckIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: BRAND_LIME,
    justifyContent: 'center',
    alignItems: 'center',
  },
  questCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
  },
  questCardDesc: {
    fontSize: 11,
    color: '#8A9580',
    marginTop: 2,
  },
  questRewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(143, 196, 65, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  questRewardText: {
    fontSize: 11,
    fontWeight: '800',
    color: BRAND_LIME,
  },
});
