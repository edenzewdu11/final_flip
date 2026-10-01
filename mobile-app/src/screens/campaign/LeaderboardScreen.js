import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, ScrollView,
  Image, ImageBackground,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../api';
import config from '../../config';
import CampaignEventEmitter from '../../contexts/CampaignEventEmitter';

const BACKEND = config.API_BASE_URL.replace('/api', '');

function mediaUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return BACKEND + url;
}

const GOLD       = '#C8B56A';
const LIGHT_GOLD = '#F9E08B';
const BG         = '#0D0D0D';
const CARD       = '#1A1A1A';
const BORDER     = '#262626';

const PERIOD_GROUPS = [
  { id: 'daily',   label: 'Daily' },
  { id: 'weekly',  label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'overall', label: 'All Time' },
];

const EMPTY_HISTORY = {
  daily: [],
  weekly: [],
  monthly: [],
  overall: [],
};

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDailyWeekHistory(history) {
  const snapshotMap = new Map(history.map(item => [getDateKey(item.period_start), item]));
  const anchor = history[0]?.period_start || new Date().toISOString();
  const anchorDate = new Date(anchor);
  const dayOfWeek = anchorDate.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(anchorDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(anchorDate.getDate() + mondayOffset);

  return WEEKDAY_LABELS.map((label, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = getDateKey(date);
    const snapshot = snapshotMap.get(key);

    return snapshot || {
      id: `weekday-${key}`,
      label,
      subtitle: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      missing: true,
      period_start: date.toISOString(),
    };
  });
}

const MEDAL_COLORS = { 1: '#FFD700', 2: '#A8A8A8', 3: '#CD7F32' };

/* ─── Podium card for top-3 ─────────────────────────────────── */
function PodiumCard({ entry, rank }) {
  const isFirst    = rank === 1;
  const medalColor = MEDAL_COLORS[rank];
  const size       = isFirst ? 72 : 56;
  const score      = entry.total_score || entry.score || 0;
  const profileImage = mediaUrl(entry.profile_image);
  
  console.log('[PODIUM CARD] Entry:', entry.username, 'Profile image:', profileImage);

  return (
    <View style={[styles.podiumCard, isFirst && styles.podiumFirst]}>
      {isFirst && <Ionicons name="trophy" size={22} color="#FFD700" style={{ marginBottom: 6 }} />}
      {!isFirst && <Ionicons name="medal" size={18} color={medalColor} style={{ marginBottom: 4 }} />}
      <View style={[
        styles.podiumAvatar,
        { width: size, height: size, borderRadius: size / 2, borderColor: medalColor },
      ]}>
        {profileImage ? (
          <Image
            source={{ uri: profileImage }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            resizeMode="cover"
            onError={(error) => console.log('[PODIUM IMAGE] Error loading image:', error.nativeEvent.error)}
            onLoad={() => console.log('[PODIUM IMAGE] Successfully loaded image for:', entry.username)}
          />
        ) : (
          <Text style={[styles.podiumAvatarText, { fontSize: isFirst ? 28 : 22 }]}>
            {entry.username?.[0]?.toUpperCase() || '?'}
          </Text>
        )}
      </View>
      <Text style={styles.podiumUsername} numberOfLines={1}>{entry.username || '—'}</Text>
      <Text style={[styles.podiumScore, { color: medalColor, fontSize: isFirst ? 22 : 17 }]}>
        {score}
      </Text>
      <Text style={styles.podiumPts}>pts{isFirst ? ' · Champion' : ''}</Text>
    </View>
  );
}

/* ─── Full leaderboard row ───────────────────────────────────── */
function LeaderboardRow({ item, index, isVoting, onVote }) {
  const rank       = item.rank || index + 1;
  const medalColor = MEDAL_COLORS[rank];
  const score      = item.total_score || item.score || 0;
  const profileImage = mediaUrl(item.profile_image);
  
  console.log('[LEADERBOARD ROW] Item:', item.username, 'Profile image:', profileImage);

  return (
    <View style={[styles.row, rank === 1 && styles.rowFirst]}>
      {/* Rank */}
      <View style={styles.rankBox}>
        {rank === 1 ? <Ionicons name="trophy"  size={20} color="#FFD700" /> :
         rank === 2 ? <Ionicons name="medal"   size={20} color="#A8A8A8" /> :
         rank === 3 ? <Ionicons name="medal"   size={20} color="#CD7F32" /> :
         <Text style={styles.rankNum}>#{rank}</Text>}
      </View>

      {/* Avatar */}
      <View style={[styles.rowAvatar, medalColor && { borderColor: medalColor }]}>
        {profileImage ? (
          <Image
            source={{ uri: profileImage }}
            style={{ width: 44, height: 44, borderRadius: 22 }}
            resizeMode="cover"
            onError={(error) => console.log('[ROW IMAGE] Error loading image:', error.nativeEvent.error)}
            onLoad={() => console.log('[ROW IMAGE] Successfully loaded image for:', item.username)}
          />
        ) : (
          <Text style={styles.rowAvatarText}>{item.username?.[0]?.toUpperCase() || '?'}</Text>
        )}
      </View>

      {/* Name + engagement */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowUsername} numberOfLines={1}>{item.username || 'Anonymous'}</Text>
        <View style={styles.engRow}>
          <View style={styles.engItem}>
            <Ionicons name="heart"        size={11} color="#EF4444" />
            <Text style={styles.engText}>{item.likes_count    || 0}</Text>
          </View>
          <View style={styles.engItem}>
            <Ionicons name="chatbubble"   size={11} color="#888" />
            <Text style={styles.engText}>{item.comments_count || 0}</Text>
          </View>
          <View style={styles.engItem}>
            <Ionicons name="share-social" size={11} color="#3B82F6" />
            <Text style={styles.engText}>{item.shares_count   || 0}</Text>
          </View>
          <View style={styles.engItem}>
            <Ionicons name="gift"         size={11} color={GOLD} />
            <Text style={styles.engText}>{item.gifts_count    || 0}</Text>
          </View>
          {item.post_count > 0 && (
            <Text style={styles.postCount}>{item.post_count} posts</Text>
          )}
        </View>
      </View>

      {/* Score */}
      <View style={styles.scoreBox}>
        <Ionicons name="trophy" size={13} color={GOLD} />
        <Text style={[styles.scoreNum, rank <= 3 && { color: medalColor }]}>{score}</Text>
        <Text style={styles.scorePts}>pts</Text>
      </View>

      {/* Vote button */}
      {isVoting && (
        <TouchableOpacity
          style={[styles.voteBtn, item.user_voted && styles.votedBtn]}
          onPress={() => onVote(item.id)}
          disabled={item.user_voted}
        >
          <Ionicons name={item.user_voted ? 'heart' : 'heart-outline'} size={13} color="#8fc441" />
          <Text style={styles.voteBtnText}>{item.user_voted ? 'Voted' : 'Vote'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ─── Main screen ────────────────────────────────────────────── */
export default function LeaderboardScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { campaignId, campaign } = route.params || {};

  const [entries,    setEntries]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [periodType, setPeriodType] = useState('overall');
  const [periodHistory, setPeriodHistory] = useState(EMPTY_HISTORY);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);
  const [selectedDateKey, setSelectedDateKey] = useState(null);
  const [historyReady, setHistoryReady] = useState(false);
  const isVoting = campaign?.status === 'voting';

  // Load campaign meta + history on mount
  useEffect(() => {
    if (campaignId) loadCampaignMeta();
  }, [campaignId]);

  // Load leaderboard when period/snapshot changes
  useEffect(() => {
    if (campaignId && historyReady) loadLeaderboard();
  }, [campaignId, periodType, selectedSnapshotId, selectedDateKey, historyReady]);

  const loadCampaignMeta = async () => {
    try {
      setLoading(true);
      setHistoryReady(false);
      const historyRes = await api.request(
        `/campaigns/${campaignId}/leaderboard/?history=1`
      ).catch(() => ({ periods: EMPTY_HISTORY }));

      const nextHistory = {
        ...EMPTY_HISTORY,
        ...(historyRes.periods || {}),
      };
      setPeriodHistory(nextHistory);

      // Auto-select the first period type that has data
      const nextPeriodType = nextHistory.daily.length
        ? 'daily'
        : nextHistory.weekly.length
          ? 'weekly'
          : nextHistory.monthly.length
            ? 'monthly'
            : 'overall';

      const nextDailyHistory = buildDailyWeekHistory(nextHistory.daily);

      setPeriodType(nextPeriodType);
      setSelectedSnapshotId(nextHistory[nextPeriodType]?.[0]?.id || null);
      setSelectedDateKey(
        nextDailyHistory.find(item => !item.missing)?.period_start
          ? getDateKey(nextDailyHistory.find(item => !item.missing).period_start)
          : getDateKey(new Date().toISOString())
      );
      setHistoryReady(true);
    } catch (err) {
      console.error('Error loading leaderboard meta:', err);
      setPeriodHistory(EMPTY_HISTORY);
      setPeriodType('overall');
      setSelectedSnapshotId(null);
      setSelectedDateKey(getDateKey(new Date().toISOString()));
      setHistoryReady(true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const loadLeaderboard = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      let query;
      if (periodType === 'daily') {
        query = `/campaigns/${campaignId}/leaderboard/?period=daily&date=${selectedDateKey || getDateKey(new Date().toISOString())}`;
      } else {
        query = selectedSnapshotId
          ? `/campaigns/${campaignId}/leaderboard/?leaderboard_id=${selectedSnapshotId}`
          : `/campaigns/${campaignId}/leaderboard/?period=${periodType}`;
      }
      const data = await api.request(query);
      console.log('[LEADERBOARD] API Response:', data);
      setEntries(data.entries || []);
    } catch (err) {
      console.error('Leaderboard error:', err);
      if (!isRefresh) Alert.alert('Error', 'Failed to load leaderboard.');
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [campaignId, periodType, selectedSnapshotId, selectedDateKey]);

  // Listen for campaign interaction events from other screens
  useEffect(() => {
    const unsubscribe = CampaignEventEmitter.addListener('campaign_interaction', (event) => {
      const { type, campaignId: eventCampaignId, postId, quantity } = event;
      
      if (eventCampaignId === campaignId) {
        console.log(`[LEADERBOARD] Received ${type} event for campaign ${campaignId}, updating leaderboard...`);
        
        if (type === 'vote') {
          setEntries(prev => prev.map(entry => {
            if (entry.reel?.id === postId) {
              return { ...entry, vote_count: (entry.vote_count || 0) + 1 };
            }
            return entry;
          }));
        } else if (type === 'gift') {
          const giftScore = (quantity || 1) * 1;
          setEntries(prev => prev.map(entry => {
            if (entry.reel?.id === postId) {
              return { ...entry, vote_count: (entry.vote_count || 0) + giftScore };
            }
            return entry;
          }));
        } else {
          setTimeout(() => { loadLeaderboard(true); }, 500);
        }
        
        setTimeout(() => { loadLeaderboard(true); }, 1000);
      }
    });
    
    return unsubscribe;
  }, [campaignId]);

  const handleRefresh = () => { setRefreshing(true); loadLeaderboard(true); };

  const handleChangePeriodType = (nextPeriodType) => {
    setPeriodType(nextPeriodType);
    if (nextPeriodType === 'daily') {
      const nextVisibleHistory = buildDailyWeekHistory(periodHistory.daily || []);
      const firstRealDay = nextVisibleHistory.find(item => !item.missing) || nextVisibleHistory[0];
      setSelectedDateKey(firstRealDay ? getDateKey(firstRealDay.period_start) : getDateKey(new Date().toISOString()));
      setSelectedSnapshotId(null);
      return;
    }
    setSelectedSnapshotId((periodHistory[nextPeriodType] || [])[0]?.id || null);
  };

  const handleVote = async (entryId) => {
    try {
      setEntries(prev => prev.map(e =>
        e.id === entryId ? { ...e, vote_count: (e.vote_count || 0) + 1, user_voted: true } : e
      ));
      await api.request(`/campaigns/entries/${entryId}/vote/`, { method: 'POST' });
      setTimeout(() => { loadLeaderboard(true); }, 1000);
      Alert.alert('Success', 'Vote recorded!');
    } catch (err) {
      setEntries(prev => prev.map(e =>
        e.id === entryId ? { ...e, vote_count: Math.max(0, (e.vote_count || 1) - 1), user_voted: false } : e
      ));
      console.error('Vote failed:', err);
      Alert.alert('Error', 'Failed to vote.');
    }
  };

  const activeHistory = periodHistory[periodType] || [];
  const visibleHistory = periodType === 'daily' ? buildDailyWeekHistory(activeHistory) : activeHistory;
  const activeSnapshot = periodType === 'daily'
    ? visibleHistory.find(item => getDateKey(item.period_start) === selectedDateKey) || null
    : visibleHistory.find(item => item.id === selectedSnapshotId) || null;

  const top3 = entries.slice(0, 3);
  const rest  = entries.slice(3);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={GOLD} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 8 }}>
          <Text style={styles.headerTitle}>Leaderboard</Text>
          {campaign?.title ? (
            <Text style={styles.headerSub} numberOfLines={1}>{campaign.title}</Text>
          ) : null}
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* ── Period group tabs ── */}
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {PERIOD_GROUPS.map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.tab, periodType === p.id && styles.tabActive]}
              onPress={() => handleChangePeriodType(p.id)}
            >
              <Text style={[styles.tabText, periodType === p.id && styles.tabTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── Snapshot history sub-tabs ── */}
      {visibleHistory.length > 0 && (
        <View style={styles.snapshotWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.snapshotTabs}>
            {visibleHistory.map((item) => {
              const isSelected = periodType === 'daily'
                ? getDateKey(item.period_start) === selectedDateKey
                : selectedSnapshotId === item.id;
              const isDisabled = periodType !== 'daily' && !!item.missing;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.snapshotTab,
                    isSelected && styles.snapshotTabActive,
                    isDisabled && styles.snapshotTabDisabled,
                  ]}
                  disabled={isDisabled}
                  onPress={() => {
                    if (periodType === 'daily') {
                      setSelectedDateKey(getDateKey(item.period_start));
                    } else {
                      if (!item.missing) setSelectedSnapshotId(item.id);
                    }
                  }}
                >
                  <Text style={[
                    styles.snapshotLabel,
                    isSelected && styles.snapshotLabelActive,
                    isDisabled && { opacity: 0.4 },
                  ]}>
                    {item.label}
                  </Text>
                  {item.subtitle ? (
                    <Text style={[
                      styles.snapshotSub,
                      isSelected && styles.snapshotSubActive,
                      isDisabled && { opacity: 0.4 },
                    ]}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ── Active snapshot label ── */}
      {activeSnapshot && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <Text style={{ color: '#888', fontSize: 13, fontWeight: '600' }}>
            Showing {activeSnapshot.label}{activeSnapshot.subtitle ? ` · ${activeSnapshot.subtitle}` : ''}
          </Text>
        </View>
      )}

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item, idx) => String(item.id || idx)}
          renderItem={({ item, index }) => (
            <LeaderboardRow
              item={item}
              index={index + 3}
              isVoting={isVoting}
              onVote={handleVote}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />
          }
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            entries.length > 0 ? (
              <>
                {/* ── Podium ── */}
                {top3.length >= 1 && (
                  <View style={styles.podiumWrap}>
                    <Text style={styles.sectionLabel}>TOP PERFORMERS</Text>
                    <View style={styles.podiumRow}>
                      {top3[1] ? <PodiumCard entry={top3[1]} rank={2} /> : <View style={{ flex: 1 }} />}
                      {top3[0] ? <PodiumCard entry={top3[0]} rank={1} /> : null}
                      {top3[2] ? <PodiumCard entry={top3[2]} rank={3} /> : <View style={{ flex: 1 }} />}
                    </View>
                  </View>
                )}
                {/* ── Full list header ── */}
                {entries.length > 0 && (
                  <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>
                    ALL RANKINGS · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                  </Text>
                )}
                {/* Top 3 also in list */}
                {top3.map((item, index) => (
                  <LeaderboardRow
                    key={String(item.id || index)}
                    item={item}
                    index={index}
                    isVoting={isVoting}
                    onVote={handleVote}
                  />
                ))}
              </>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="trophy-outline" size={52} color="#444" />
              <Text style={styles.emptyTitle}>No Rankings Yet</Text>
              <Text style={styles.emptySub}>Be the first to participate!</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: BG },
  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:{ color: '#888', fontSize: 14, marginTop: 12 },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: LIGHT_GOLD },
  headerSub:   { fontSize: 12, color: '#888', marginTop: 1 },

  /* Period tabs */
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: BORDER },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },

  /* Snapshot sub-tabs */
  snapshotWrap: { borderBottomWidth: 1, borderBottomColor: BORDER },
  snapshotTabs: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  snapshotTab: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, minWidth: 80,
  },
  snapshotTabActive: {
    borderColor: '#8fc441', backgroundColor: 'rgba(143,196,65,0.1)',
  },
  snapshotTabDisabled: { opacity: 0.5 },
  snapshotLabel: { fontSize: 12, fontWeight: '800', color: '#888' },
  snapshotLabelActive: { color: '#8fc441' },
  snapshotSub: { fontSize: 11, color: '#666', marginTop: 3 },
  snapshotSubActive: { color: '#8fc441' },

  tab: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: CARD,
  },
  tabActive:     { backgroundColor: '#8fc441',  borderColor: '#8fc441' },
  tabText:       { fontSize: 13, fontWeight: '600', color: '#888' },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  /* Section label */
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#666',
    letterSpacing: 1, marginBottom: 14,
  },

  /* Podium */
  podiumWrap: {
    backgroundColor: CARD, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    padding: 20, marginBottom: 20,
  },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  podiumCard: { flex: 1, alignItems: 'center', paddingBottom: 4 },
  podiumFirst: { marginBottom: 12 },
  podiumAvatar: {
    borderWidth: 3, backgroundColor: '#222',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  podiumAvatarText: { fontWeight: '800', color: '#fff' },
  podiumUsername:   { fontSize: 12, fontWeight: '700', color: '#ddd', marginBottom: 2, textAlign: 'center' },
  podiumScore:      { fontWeight: '900', textAlign: 'center' },
  podiumPts:        { fontSize: 10, color: '#888', textAlign: 'center' },

  /* Full list row */
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 10, gap: 10,
  },
  rowFirst: { borderColor: '#FFD70050', backgroundColor: '#1C1800' },

  rankBox:  { width: 30, alignItems: 'center' },
  rankNum:  { fontSize: 15, fontWeight: '800', color: '#666' },

  rowAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#2A2A2A', borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  rowAvatarText: { fontSize: 17, fontWeight: '700', color: LIGHT_GOLD },
  rowUsername:   { fontSize: 14, fontWeight: '700', color: LIGHT_GOLD, marginBottom: 3 },

  engRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  engItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  engText: { fontSize: 11, color: '#AAA', fontWeight: '600' },
  postCount:{ fontSize: 11, color: '#666' },

  scoreBox: { alignItems: 'center', minWidth: 42 },
  scoreNum: { fontSize: 17, fontWeight: '800', color: GOLD, marginTop: 1 },
  scorePts: { fontSize: 10, color: '#888' },

  voteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#3B82F6', paddingHorizontal: 12,
    paddingVertical: 7, borderRadius: 10,
  },
  votedBtn:    { backgroundColor: '#10B981' },
  voteBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  /* Empty */
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: LIGHT_GOLD, marginTop: 14, marginBottom: 6 },
  emptySub:   { fontSize: 14, color: '#888', textAlign: 'center' },
});
