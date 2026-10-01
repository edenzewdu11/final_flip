import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView, Image,
  Modal, TextInput,
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
const CARD_LIGHT = '#242424';
const BORDER     = '#262626';
const MEDAL_COLORS = { 1: '#FFD700', 2: '#A8A8A8', 3: '#CD7F32' };

const PERIODS = [
  { id: 'daily',   label: 'Daily',       icon: 'calendar' },
  { id: 'weekly',  label: 'Weekly',      icon: 'trophy' },
  { id: 'monthly', label: 'Monthly',     icon: 'people' },
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

/* ─── Podium component for Top 3 ─────────────────────────────── */
function PodiumSection({ leaders, onUserPress }) {
  if (!leaders || leaders.length < 3) return null;
  const first = leaders[0];
  const second = leaders[1];
  const third = leaders[2];

  const renderPodiumItem = (entry, rank, size, iconName, medalColor) => {
    const profileImg = mediaUrl(entry.profile_image);
    const isFirst = rank === 1;

    return (
      <View style={[styles.podiumItem, isFirst && styles.podiumFirstItem]}>
        <View style={styles.podiumCrownWrap}>
          <Ionicons name={iconName} size={isFirst ? 22 : 17} color={medalColor} />
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onUserPress && onUserPress(entry.user_id)}
          style={[styles.podiumAvatarWrap, { width: size, height: size, borderRadius: size / 2, borderColor: medalColor }]}
        >
          {profileImg ? (
            <Image source={{ uri: profileImg }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />
          ) : (
            <Text style={[styles.podiumAvatarText, { fontSize: isFirst ? 24 : 18 }]}>
              {entry.username?.[0]?.toUpperCase() || '?'}
            </Text>
          )}
          <View style={[styles.podiumRankBadge, { backgroundColor: medalColor }]}>
            <Text style={styles.podiumRankNum}>{rank}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.podiumUsername} numberOfLines={1}>
          {entry.username || 'Anonymous'}
        </Text>
        <Text style={[styles.podiumScore, { color: medalColor }]}>
          {typeof entry.total_score === 'number' ? entry.total_score.toFixed(1) : entry.total_score ?? 0}
        </Text>
        <Text style={styles.podiumPts}>pts</Text>
      </View>
    );
  };

  return (
    <View style={styles.podiumContainer}>
      <Text style={styles.podiumHeading}>TOP PERFORMERS</Text>
      <View style={styles.podiumRow}>
        {renderPodiumItem(second, 2, 54, 'medal', MEDAL_COLORS[2])}
        {renderPodiumItem(first, 1, 70, 'trophy', MEDAL_COLORS[1])}
        {renderPodiumItem(third, 3, 54, 'medal', MEDAL_COLORS[3])}
      </View>
    </View>
  );
}

function EntryRow({ entry, onUserPress }) {
  const rank = entry.rank;
  const medalColor = MEDAL_COLORS[rank];
  const profileImage = mediaUrl(entry.profile_image);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onUserPress && onUserPress(entry.user_id)}
      style={[styles.row, rank === 1 && styles.rowFirst]}
    >
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
          {entry.post_count > 0 && (
            <View style={styles.engItem}>
              <Ionicons name="videocam" size={11} color="#3B82F6" />
              <Text style={styles.engText}>{entry.post_count} posts</Text>
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
    </TouchableOpacity>
  );
}

function CampaignSection({ section, onSelectCampaign, onUserPress }) {
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {onSelectCampaign && (
            <TouchableOpacity
              onPress={() => onSelectCampaign(section.campaign_id)}
              style={styles.focusBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.focusBtnText}>Focus</Text>
            </TouchableOpacity>
          )}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={GOLD} />
        </View>
      </TouchableOpacity>
      {expanded && (
        section.leaders.length === 0 ? (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={styles.emptySub}>No entries yet</Text>
          </View>
        ) : (
          section.leaders.map(entry => <EntryRow key={entry.user_id} entry={entry} onUserPress={onUserPress} />)
        )
      )}
    </View>
  );
}

export default function GlobalLeaderboardScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const initialCampaignId = route?.params?.campaignId ? String(route.params.campaignId) : 'all';

  const [period, setPeriod] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(getDateKey(new Date()));
  const [selectedCampaignId, setSelectedCampaignId] = useState(initialCampaignId);
  const [campaignsList, setCampaignsList] = useState([]);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load list of all campaigns for the selector
  const loadAvailableCampaigns = useCallback(async () => {
    try {
      const res = await api.request('/campaigns/');
      const list = Array.isArray(res) ? res : (res?.results || []);
      if (list.length > 0) {
        setCampaignsList(list);
      }
    } catch (err) {
      console.log('[GlobalLeaderboard] Failed to fetch campaign list:', err);
    }
  }, []);

  useEffect(() => {
    loadAvailableCampaigns();
  }, [loadAvailableCampaigns]);

  // Main data loader
  const load = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      let url = `/leaderboard/global/?period=${period}`;
      if (period === 'daily') {
        url += `&date=${selectedDate}`;
      }
      if (selectedCampaignId !== 'all') {
        url += `&campaign_id=${selectedCampaignId}`;
      }

      const res = await api.request(url, { skipCache: true });
      setData(res);

      // If backend returned available_campaigns and we don't have campaigns yet, populate
      if (res?.available_campaigns && campaignsList.length === 0) {
        setCampaignsList(res.available_campaigns);
      }
    } catch (err) {
      console.error('[GlobalLeaderboard] error:', err);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, selectedDate, selectedCampaignId, campaignsList.length]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const shiftDate = (deltaDays) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + deltaDays);
    const next = getDateKey(d);
    if (deltaDays > 0 && next > getDateKey(new Date())) return;
    setSelectedDate(next);
  };

  const handleUserPress = (userId) => {
    if (userId) {
      navigation.navigate('ProfileStack', { userId });
    }
  };

  // Find currently selected campaign details
  const selectedCampaign = useMemo(() => {
    if (selectedCampaignId === 'all') return null;
    return campaignsList.find(c => String(c.id) === String(selectedCampaignId)) || null;
  }, [selectedCampaignId, campaignsList]);

  // Filtered campaigns for the modal search
  const filteredCampaignsForModal = useMemo(() => {
    if (!searchQuery.trim()) return campaignsList;
    const q = searchQuery.toLowerCase();
    return campaignsList.filter(c => (c.title || '').toLowerCase().includes(q));
  }, [campaignsList, searchQuery]);

  const isSpecificCampaign = selectedCampaignId !== 'all';
  const leaders = data?.leaders || [];
  const campaigns = data?.campaigns || [];
  const isToday = selectedDate >= getDateKey(new Date());

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={GOLD} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 8 }}>
          <Text style={styles.headerTitle}>Leaderboard</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {isSpecificCampaign
              ? (selectedCampaign?.title || data?.campaign_title || 'Campaign Leaderboard')
              : 'All campaign rankings'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowPickerModal(true)}
          style={styles.headerFilterBtn}
          accessibilityLabel="Select Campaign"
        >
          <Ionicons name="funnel-outline" size={18} color={isSpecificCampaign ? '#0D0D0D' : GOLD} />
          {isSpecificCampaign && <View style={styles.filterActiveDot} />}
        </TouchableOpacity>
      </View>

      {/* ─── CAMPAIGN SELECTOR BAR ─────────────────────────────────────── */}
      <View style={styles.campaignSelectorWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.campaignSelectorContent}
        >
          {/* All Campaigns Chip */}
          <TouchableOpacity
            style={[styles.campaignChip, selectedCampaignId === 'all' && styles.campaignChipActive]}
            onPress={() => setSelectedCampaignId('all')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="trophy"
              size={13}
              color={selectedCampaignId === 'all' ? '#000' : GOLD}
            />
            <Text style={[styles.campaignChipText, selectedCampaignId === 'all' && styles.campaignChipTextActive]}>
              All Campaigns
            </Text>
          </TouchableOpacity>

          {/* Individual Campaign Chips */}
          {campaignsList.map(camp => {
            const isSelected = String(camp.id) === String(selectedCampaignId);
            const statusDot = camp.status === 'active' ? '#10B981' : camp.status === 'voting' ? '#3B82F6' : '#94A3B8';
            return (
              <TouchableOpacity
                key={camp.id}
                style={[styles.campaignChip, isSelected && styles.campaignChipActive]}
                onPress={() => setSelectedCampaignId(String(camp.id))}
                activeOpacity={0.8}
              >
                <View style={[styles.chipStatusDot, { backgroundColor: isSelected ? '#000' : statusDot }]} />
                <Text
                  style={[styles.campaignChipText, isSelected && styles.campaignChipTextActive]}
                  numberOfLines={1}
                >
                  {camp.title}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* Modal Opener Button */}
          <TouchableOpacity
            style={styles.moreCampaignsBtn}
            onPress={() => setShowPickerModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="grid-outline" size={13} color={GOLD} />
            <Text style={styles.moreCampaignsText}>Browse All</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Active Campaign Detail Banner if filtered */}
      {isSpecificCampaign && (
        <View style={styles.activeCampaignBanner}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="flag" size={13} color={GOLD} />
              <Text style={styles.activeCampaignBannerTitle} numberOfLines={1}>
                {selectedCampaign?.title || data?.campaign_title || 'Selected Campaign'}
              </Text>
            </View>
            <Text style={styles.activeCampaignBannerSub}>
              Showing rankings for this campaign only
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={styles.viewCampaignDetailBtn}
              onPress={() => navigation.navigate('CampaignDetail', { campaignId: selectedCampaignId })}
            >
              <Text style={styles.viewCampaignDetailText}>Details</Text>
              <Ionicons name="chevron-forward" size={12} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSelectedCampaignId('all')}
              style={styles.clearCampaignBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={20} color="#888" />
            </TouchableOpacity>
          </View>
        </View>
      )}

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

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : isSpecificCampaign ? (
        /* Specific campaign view: show podium if >= 3, then ranked list */
        <FlatList
          data={leaders}
          keyExtractor={(item, idx) => String(item.user_id || idx)}
          renderItem={({ item }) => <EntryRow entry={item} onUserPress={handleUserPress} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            leaders.length > 0 ? (
              <PodiumSection leaders={leaders} onUserPress={handleUserPress} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="trophy-outline" size={52} color="#444" />
              <Text style={styles.emptyTitle}>No Rankings Found</Text>
              <Text style={styles.emptySub}>
                {period === 'daily'
                  ? `No activity for this campaign on ${selectedDate}`
                  : `No entries recorded for this campaign in the ${period} period.`}
              </Text>
              <TouchableOpacity
                style={styles.allCampaignsReturnBtn}
                onPress={() => setSelectedCampaignId('all')}
              >
                <Text style={styles.allCampaignsReturnText}>View All Campaigns</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : period === 'daily' ? (
        /* Daily Global view: grouped by campaigns */
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
            campaigns.map(section => (
              <CampaignSection
                key={section.campaign_id}
                section={section}
                onSelectCampaign={(cId) => setSelectedCampaignId(String(cId))}
                onUserPress={handleUserPress}
              />
            ))
          )}
        </ScrollView>
      ) : (
        /* Weekly/Monthly/Grand Global view */
        <FlatList
          data={leaders}
          keyExtractor={(item, idx) => String(item.user_id || idx)}
          renderItem={({ item }) => <EntryRow entry={item} onUserPress={handleUserPress} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <View style={styles.summaryBanner}>
                <Text style={styles.summaryText}>
                  {period === 'weekly' ? "This week's top performers across all campaigns" :
                   period === 'monthly' ? "This month's top performers across all campaigns" :
                   'Grand Final — Top performers from the last 6 months'}
                </Text>
              </View>
              {leaders.length >= 3 && (
                <PodiumSection leaders={leaders} onUserPress={handleUserPress} />
              )}
            </>
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

      {/* ─── CAMPAIGN SELECTION MODAL ───────────────────────────────────── */}
      <Modal
        visible={showPickerModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPickerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Select Campaign</Text>
                <Text style={styles.modalSub}>Choose a campaign to see its leaders</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowPickerModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.modalSearchBox}>
              <Ionicons name="search" size={16} color="#888" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search campaigns..."
                placeholderTextColor="#666"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={16} color="#888" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Campaign Options List */}
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {/* Option: All Campaigns */}
              <TouchableOpacity
                style={[
                  styles.modalItem,
                  selectedCampaignId === 'all' && styles.modalItemSelected
                ]}
                onPress={() => {
                  setSelectedCampaignId('all');
                  setShowPickerModal(false);
                }}
              >
                <View style={styles.modalItemIconWrap}>
                  <Ionicons name="trophy" size={20} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalItemTitle}>All Campaigns (Global)</Text>
                  <Text style={styles.modalItemMeta}>Combined leaderboard across all campaigns</Text>
                </View>
                {selectedCampaignId === 'all' && (
                  <Ionicons name="checkmark-circle" size={22} color={GOLD} />
                )}
              </TouchableOpacity>

              {/* List of campaigns */}
              {filteredCampaignsForModal.map(c => {
                const isSelected = String(c.id) === String(selectedCampaignId);
                const statusColor = c.status === 'active' ? '#10B981' : c.status === 'voting' ? '#3B82F6' : '#94A3B8';
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.modalItem,
                      isSelected && styles.modalItemSelected
                    ]}
                    onPress={() => {
                      setSelectedCampaignId(String(c.id));
                      setShowPickerModal(false);
                    }}
                  >
                    <View style={[styles.modalItemIconWrap, { borderColor: statusColor }]}>
                      <Ionicons name="flag" size={18} color={statusColor} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.modalItemTitle} numberOfLines={1}>{c.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                        <Text style={styles.modalItemMeta}>
                          {c.status ? c.status.toUpperCase() : 'CAMPAIGN'}
                          {c.prize_title ? ` · Prize: ${c.prize_title}` : ''}
                        </Text>
                      </View>
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={22} color={GOLD} />
                    ) : (
                      <Ionicons name="chevron-forward" size={16} color="#555" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: LIGHT_GOLD },
  headerSub: { fontSize: 12, color: '#888', marginTop: 1 },
  headerFilterBtn: {
    padding: 8, borderRadius: 10,
    backgroundColor: CARD_LIGHT, borderWidth: 1, borderColor: BORDER,
  },
  filterActiveDot: {
    position: 'absolute', top: 6, right: 6,
    width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD,
  },

  /* ─── Campaign Selector Bar ───────────────────────────────── */
  campaignSelectorWrap: {
    backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingVertical: 8,
  },
  campaignSelectorContent: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  campaignChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: BG,
    borderWidth: 1, borderColor: BORDER,
  },
  campaignChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  chipStatusDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  campaignChipText: {
    fontSize: 12, fontWeight: '600', color: '#AAA',
    maxWidth: 160,
  },
  campaignChipTextActive: {
    color: '#000', fontWeight: '800',
  },
  moreCampaignsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(143,196,65,0.12)',
    borderWidth: 1, borderColor: 'rgba(143,196,65,0.3)',
  },
  moreCampaignsText: {
    fontSize: 12, fontWeight: '700', color: GOLD,
  },

  /* ─── Active Campaign Banner ──────────────────────────────── */
  activeCampaignBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(143,196,65,0.08)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(143,196,65,0.2)',
  },
  activeCampaignBannerTitle: {
    fontSize: 13, fontWeight: '800', color: LIGHT_GOLD,
  },
  activeCampaignBannerSub: {
    fontSize: 11, color: '#888', marginTop: 1,
  },
  viewCampaignDetailBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: GOLD, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12,
  },
  viewCampaignDetailText: {
    fontSize: 11, fontWeight: '800', color: '#000',
  },
  clearCampaignBtn: {
    padding: 2,
  },

  /* ─── Period Tabs ─────────────────────────────────────────── */
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

  /* ─── Date Nav ────────────────────────────────────────────── */
  dateNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 10, paddingHorizontal: 8, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD,
  },
  dateBtn: { padding: 6, borderRadius: 8, backgroundColor: 'rgba(143,196,65,0.15)' },
  dateBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.05)' },
  dateLabel: { fontSize: 14, fontWeight: '700', color: LIGHT_GOLD },

  /* ─── Podium ──────────────────────────────────────────────── */
  podiumContainer: {
    marginBottom: 20, paddingVertical: 16, paddingHorizontal: 12,
    borderRadius: 16, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center',
  },
  podiumHeading: {
    fontSize: 11, fontWeight: '800', color: GOLD,
    letterSpacing: 1.2, marginBottom: 16,
  },
  podiumRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center',
    width: '100%', gap: 12,
  },
  podiumItem: {
    alignItems: 'center', flex: 1,
  },
  podiumFirstItem: {
    marginBottom: 10,
  },
  podiumCrownWrap: {
    marginBottom: 4,
  },
  podiumAvatarWrap: {
    backgroundColor: '#2A2A2A',
    borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  podiumAvatarText: {
    fontWeight: '800', color: LIGHT_GOLD,
  },
  podiumRankBadge: {
    position: 'absolute', bottom: -6, alignSelf: 'center',
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  podiumRankNum: {
    fontSize: 10, fontWeight: '900', color: '#000',
  },
  podiumUsername: {
    fontSize: 12, fontWeight: '700', color: LIGHT_GOLD,
    marginTop: 10, maxWidth: 85, textAlign: 'center',
  },
  podiumScore: {
    fontSize: 15, fontWeight: '900', marginTop: 2,
  },
  podiumPts: {
    fontSize: 9, color: '#888',
  },

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
  focusBtn: {
    paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: 'rgba(143,196,65,0.2)',
    borderRadius: 6,
  },
  focusBtnText: {
    fontSize: 10, fontWeight: '700', color: GOLD,
  },

  /* ─── Entry Row ───────────────────────────────────────────── */
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: CARD,
    borderRadius: 10, marginBottom: 6,
  },
  rowFirst: { backgroundColor: 'rgba(143,196,65,0.06)' },
  rankBox: { width: 24, alignItems: 'center' },
  rankNum: { fontSize: 12, fontWeight: '700', color: '#888' },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#2A2A2A', borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 34, height: 34, borderRadius: 17 },
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
  emptySub: { fontSize: 14, color: '#888', textAlign: 'center', paddingHorizontal: 20 },
  allCampaignsReturnBtn: {
    marginTop: 16, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, backgroundColor: GOLD,
  },
  allCampaignsReturnText: {
    fontSize: 13, fontWeight: '700', color: '#000',
  },

  /* ─── Modal Styles ────────────────────────────────────────── */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: BORDER,
    maxHeight: '80%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: LIGHT_GOLD },
  modalSub: { fontSize: 12, color: '#888', marginTop: 2 },
  modalCloseBtn: {
    padding: 6, borderRadius: 16, backgroundColor: CARD_LIGHT,
  },
  modalSearchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BG, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 14,
  },
  modalSearchInput: {
    flex: 1, color: '#fff', fontSize: 14, padding: 0,
  },
  modalList: {
    maxHeight: 380,
  },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalItemSelected: {
    backgroundColor: 'rgba(143,196,65,0.12)',
  },
  modalItemIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG, borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  modalItemTitle: {
    fontSize: 14, fontWeight: '700', color: LIGHT_GOLD,
  },
  modalItemMeta: {
    fontSize: 11, color: '#888',
  },
});
