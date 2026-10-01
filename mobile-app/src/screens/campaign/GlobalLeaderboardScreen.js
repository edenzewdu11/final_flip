import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../api';
import config from '../../config';

const BACKEND = config.API_BASE_URL.replace('/api', '');

function mediaUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return BACKEND + url;
}

const GOLD       = '#8fc441';
const LIGHT_GOLD = '#F9E08B';
const BG         = '#0D0D0D';
const CARD       = '#1A1A1A';
const BORDER     = '#262626';
const MEDAL_COLORS = { 1: '#FFD700', 2: '#A8A8A8', 3: '#CD7F32' };

const PERIODS = [
  { id: 'daily',   label: 'Daily',   icon: 'calendar' },
  { id: 'weekly',  label: 'Weekly',  icon: 'trophy' },
  { id: 'monthly', label: 'Monthly', icon: 'people' },
  { id: 'grand',   label: 'Grand Final', icon: 'ribbon' },
];

function getDateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function RankBadge({ rank }) {
  if (rank === 1) return <Ionicons name="trophy" size={16} color={MEDAL_COLORS[1]} />;
  if (rank === 2) return <Ionicons name="medal" size={16} color={MEDAL_COLORS[2]} />;
  if (rank === 3) return <Ionicons name="medal" size={16} color={MEDAL_COLORS[3]} />;
  return <Text style={styles.rankNum}>#{rank}</Text>;
}

function EntryRow({ entry }) {
  const rank = entry.rank;
  const medalColor = MEDAL_COLORS[rank];
  const profileImage = mediaUrl(entry.profile_image);
  return (
    <View style={[styles.row, rank === 1 && styles.rowFirst]}>
      <View style={styles.rankBox}><RankBadge rank={rank} /></View>
      <View style={[styles.avatar, medalColor && { borderColor: medalColor }]}>
        {profileImage ? (
          <Image source={{ uri: profileImage }} style={styles.avatarImg} resizeMode="cover" />
        ) : (
          <Text style={styles.avatarText}>{entry.username?.[0]?.toUpperCase() || '?'}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.username} numberOfLines={1}>{entry.username || 'Anonymous'}</Text>
        <View style={styles.engRow}>
          <View style={styles.engItem}>
            <Ionicons name="heart" size={11} color="#EF4444" />
            <Text style={styles.engText}>{entry.likes_count ?? 0}</Text>
          </View>
          <View style={styles.engItem}>
            <Ionicons name="chatbubble" size={11} color="#888" />
            <Text style={styles.engText}>{entry.comments_count ?? 0}</Text>
          </View>
          <View style={styles.engItem}>
            <Ionicons name="gift" size={11} color={GOLD} />
            <Text style={styles.engText}>{entry.gifts_count ?? 0}</Text>
          </View>
          {entry.campaigns_count > 0 && (
            <View style={styles.engItem}>
              <Ionicons name="trophy" size={11} color={GOLD} />
              <Text style={styles.engText}>{entry.campaigns_count}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.scoreBox}>
        <Text style={[styles.scoreNum, rank <= 3 && { color: medalColor }]}>
          {typeof entry.total_score === 'number' ? entry.total_score.toFixed(1) : entry.total_score ?? 0}
        </Text>
        <Text style={styles.scorePts}>pts</Text>
      </View>
    </View>
  );
}

function CampaignSection({ section }) {
  const [expanded, setExpanded] = useState(true);
  const statusColor = section.campaign_status === 'active' ? '#10B981' : '#94A3B8';
  return (
    <View style={styles.campaignSection}>
      <TouchableOpacity style={styles.campaignHeader} onPress={() => setExpanded(v => !v)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.campaignTitle} numberOfLines={1}>{section.campaign_title}</Text>
          <View style={styles.leaderCountBadge}>
            <Text style={styles.leaderCountText}>{section.leaders.length} leaders</Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={GOLD} />
      </TouchableOpacity>
      {expanded && (
        section.leaders.length === 0 ? (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={styles.emptySub}>No entries yet</Text>
          </View>
        ) : (
          section.leaders.map(entry => <EntryRow key={entry.user_id} entry={entry} />)
        )
      )}
    </View>
  );
}

export default function GlobalLeaderboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(getDateKey(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      let url = `/leaderboard/global/?period=${period}`;
      if (period === 'daily') url += `&date=${selectedDate}`;
      const res = await api.request(url, { skipCache: true });
      setData(res);
    } catch (err) {
      console.error('[GlobalLeaderboard] error:', err);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, selectedDate]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = () => { setRefreshing(true); load(true); };

  const shiftDate = (deltaDays) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + deltaDays);
    const next = getDateKey(d);
    if (deltaDays > 0 && next > getDateKey(new Date())) return;
    setSelectedDate(next);
  };

  const leaders = data?.leaders || [];
  const campaigns = data?.campaigns || [];
  const isToday = selectedDate >= getDateKey(new Date());

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={GOLD} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 8 }}>
          <Text style={styles.headerTitle}>Leaderboard</Text>
          <Text style={styles.headerSub}>All campaign rankings</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Period tabs */}
      <View style={styles.tabsWrap}>
        {PERIODS.map(p => {
          const active = period === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setPeriod(p.id)}
            >
              <Ionicons name={p.icon} size={12} color={active ? '#000' : '#888'} />
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Date navigator for daily */}
      {period === 'daily' && (
        <View style={styles.dateNav}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => shiftDate(-1)}>
            <Ionicons name="chevron-back" size={16} color={GOLD} />
          </TouchableOpacity>
          <Text style={styles.dateLabel}>
            {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
          <TouchableOpacity
            style={[styles.dateBtn, isToday && styles.dateBtnDisabled]}
            onPress={() => shiftDate(1)}
            disabled={isToday}
          >
            <Ionicons name="chevron-forward" size={16} color={isToday ? '#555' : GOLD} />
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : period === 'daily' ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
        >
          {campaigns.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="trophy-outline" size={52} color="#444" />
              <Text style={styles.emptyTitle}>No Activity</Text>
              <Text style={styles.emptySub}>No campaign activity on {selectedDate}</Text>
            </View>
          ) : (
            campaigns.map(section => <CampaignSection key={section.campaign_id} section={section} />)
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={leaders}
          keyExtractor={(item, idx) => String(item.user_id || idx)}
          renderItem={({ item }) => <EntryRow entry={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.summaryBanner}>
              <Text style={styles.summaryText}>
                {period === 'weekly' ? "This week's top performers across all campaigns" :
                 period === 'monthly' ? "This month's top performers across all campaigns" :
                 'Grand Final — Top performers from the last 6 months'}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="trophy-outline" size={52} color="#444" />
              <Text style={styles.emptyTitle}>No Rankings Yet</Text>
              <Text style={styles.emptySub}>No data for this period yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', fontSize: 14, marginTop: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: LIGHT_GOLD },
  headerSub: { fontSize: 12, color: '#888', marginTop: 1 },

  tabsWrap: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8, borderRadius: 10, backgroundColor: CARD,
  },
  tabActive: { backgroundColor: GOLD },
  tabText: { fontSize: 10, fontWeight: '700', color: '#888' },
  tabTextActive: { color: '#000' },

  dateNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 10, paddingHorizontal: 8, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER,
  },
  dateBtn: { padding: 6, borderRadius: 8, backgroundColor: 'rgba(143,196,65,0.15)' },
  dateBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.05)' },
  dateLabel: { fontSize: 14, fontWeight: '700', color: LIGHT_GOLD },

  summaryBanner: {
    padding: 12, borderRadius: 12, marginBottom: 16,
    backgroundColor: 'rgba(143,196,65,0.08)',
    borderWidth: 1, borderColor: 'rgba(143,196,65,0.25)',
  },
  summaryText: { fontSize: 12, color: '#AAA', fontWeight: '600' },

  campaignSection: {
    marginBottom: 12, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER,
  },
  campaignHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, backgroundColor: CARD,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  campaignTitle: { fontSize: 13, fontWeight: '800', color: LIGHT_GOLD, flexShrink: 1 },
  leaderCountBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
    backgroundColor: 'rgba(143,196,65,0.2)', borderWidth: 1, borderColor: 'rgba(143,196,65,0.4)',
  },
  leaderCountText: { fontSize: 9, fontWeight: '700', color: GOLD },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG,
  },
  rowFirst: { backgroundColor: 'rgba(143,196,65,0.05)' },
  rankBox: { width: 24, alignItems: 'center' },
  rankNum: { fontSize: 12, fontWeight: '700', color: '#888' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2A2A2A', borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 32, height: 32, borderRadius: 16 },
  avatarText: { fontSize: 13, fontWeight: '800', color: LIGHT_GOLD },
  username: { fontSize: 13, fontWeight: '700', color: LIGHT_GOLD, marginBottom: 2 },
  engRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  engItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  engText: { fontSize: 10, color: '#AAA', fontWeight: '600' },
  scoreBox: { alignItems: 'center', minWidth: 40 },
  scoreNum: { fontSize: 16, fontWeight: '900', color: GOLD },
  scorePts: { fontSize: 9, color: '#888' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: LIGHT_GOLD, marginTop: 14, marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#888', textAlign: 'center' },
});
