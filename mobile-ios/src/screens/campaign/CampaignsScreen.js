import React, { useState, useEffect, useCallback } from "react";
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, 
  ActivityIndicator, RefreshControl, ScrollView, Dimensions 
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';
import config from '../../config';

const { width } = Dimensions.get('window');
const GOLD = "#8fc441";
const LIGHT_GOLD = "#b5dd8f";
const BG = "#0D0D0D";
const CARD = "#161619";
const BORDER = "#262626";

const TABS = [
  { id: 'all',       label: 'All',       icon: 'trophy-outline' },
  { id: 'active',    label: 'Active',    icon: 'flame-outline' },
  { id: 'voting',    label: 'Voting',    icon: 'award-outline' },
  { id: 'upcoming',  label: 'Soon',      icon: 'time-outline' },
  { id: 'completed', label: 'Completed', icon: 'checkmark-circle-outline' },
];

const STATUS_META = {
  active:    { color: '#10B981', label: 'Active', icon: 'flame' },
  voting:    { color: '#3B82F6', label: 'Voting', icon: 'award' },
  upcoming:  { color: '#F59E0B', label: 'Soon',   icon: 'time' },
  completed: { color: '#94A3B8', label: 'Ended',  icon: 'checkmark-circle' },
};

function timeLeft(endDate) {
  if (!endDate) return "";
  const diff = new Date(endDate) - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
}

function getActualStatus(campaign) {
  if (campaign.end_date) {
    const diff = new Date(campaign.end_date) - Date.now();
    if (diff <= 0) return 'completed';
  }
  if (campaign.voting_end) {
    const diff = new Date(campaign.voting_end) - Date.now();
    if (diff <= 0) return 'completed';
  }
  return campaign.status || 'active';
}

const BASE = config.API_BASE_URL.replace('/api', '');
function mediaUrl(url) {
  if (!url) return null;
  const value = String(url).trim();
  if (value.startsWith('http')) return value;
  if (value.startsWith('/media/')) return `${BASE}${value}`;
  if (value.startsWith('media/')) return `${BASE}/${value}`;
  return `${BASE}/media/${value.replace(/^\/+/, '')}`;
}

const isVideoUrl = (url) => /\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(url || '');

function CampaignVideo({ uri, style }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
  });

  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

function CampaignBanner({ image, style }) {
  const [hasError, setHasError] = useState(false);
  const imageUri = mediaUrl(image);

  if (!imageUri || hasError) {
    return (
      <View style={[style, styles.bannerPlaceholder]}>
        <LinearGradient
          colors={['#1E2430', '#111827']}
          style={StyleSheet.absoluteFillObject}
        />
        <Ionicons name="trophy" size={48} color={GOLD} opacity={0.7} />
        <Text style={styles.bannerPlaceholderText}>FlipStar Campaign</Text>
      </View>
    );
  }

  if (isVideoUrl(imageUri)) {
    return <CampaignVideo uri={imageUri} style={style} />;
  }

  return (
    <View style={style}>
      <Image
        source={{ uri: imageUri }}
        style={styles.bannerImage}
        resizeMode="cover"
        onError={() => setHasError(true)}
      />
      {/* Bottom gradient scrim so image smoothly blends into card content */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.1)', 'rgba(22,22,25,0.7)', '#161619']}
        locations={[0, 0.45, 0.8, 1]}
        style={styles.gradientOverlay}
      />
    </View>
  );
}

export default function CampaignsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => { loadCampaigns(); }, [filter]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const status = filter === 'all' ? '' : filter;
      const data = await api.request(`/campaigns/?status=${status}`);
      const campaignsData = Array.isArray(data) ? data : (data.results || []);
      setCampaigns(campaignsData);
    } catch (error) {
      console.error('Failed to load campaigns:', error);
      setCampaigns([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const renderCampaignCard = useCallback(({ item, index }) => {
    const actualStatus = getActualStatus(item);
    const statusInfo = STATUS_META[actualStatus] || STATUS_META.active;
    const isActive = actualStatus === 'active';
    const isVoting = actualStatus === 'voting';
    const isUpcoming = actualStatus === 'upcoming';
    const hasEntered = item.has_entered;

    const btnLabel = isActive ? (hasEntered ? 'View Campaign' : 'View & Join') :
                    isUpcoming ? 'Coming Soon' :
                    isVoting ? 'Vote Now' : 'View Results';

    const prizeText = item.prize_title || item.prize_description || 
      (item.prize_value && parseFloat(item.prize_value) > 0 ? `${parseFloat(item.prize_value).toLocaleString()} ETB` : 
      item.prize_amount ? `${item.prize_amount} ETB` : 'Prize Pool');

    const entriesCount = item.total_entries ?? item.entries_count ?? 0;
    const timeRemaining = timeLeft(item.entry_deadline || item.voting_end || item.end_date);
    const campaignImage = item.image || item.banner || item.cover_image || item.thumbnail;
    const campaignTypeLabel = item.campaign_type ? `${item.campaign_type.toUpperCase()} CHALLENGE` : 'CHALLENGE';

    return (
      <View style={styles.campaignWrapper}>
        <TouchableOpacity 
          style={styles.campaignCard}
          onPress={() => navigation.navigate('CampaignDetail', { campaignId: item.id })} 
          activeOpacity={0.9}
        >
          {/* Banner Image Container - Fully visible with cover fit */}
          <View style={styles.imageContainer}>
            <CampaignBanner image={campaignImage} style={styles.banner} />
            
            {/* Status pill (Top-Left) */}
            <View style={[styles.statusPill, { backgroundColor: statusInfo.color }]}>
              <Ionicons name={statusInfo.icon} size={11} color="#fff" />
              <Text style={styles.statusPillText}>{statusInfo.label}</Text>
            </View>
            
            {/* Floating Grand Prize Tag (Top-Right) */}
            <View style={styles.prizePill}>
              <Ionicons name="trophy" size={12} color={GOLD} />
              <Text style={styles.prizePillText} numberOfLines={1}>{prizeText}</Text>
            </View>

            {/* Campaign Category Tag (Bottom-Left) */}
            <View style={styles.typePill}>
              <Ionicons name="sparkles" size={10} color={GOLD} />
              <Text style={styles.typePillText}>{campaignTypeLabel}</Text>
            </View>
          </View>
          
          {/* Card Body Content */}
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            {item.description ? (
              <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
            ) : null}
            
            {/* Decorative 3-Column Stats Card */}
            <View style={styles.statsCard}>
              <View style={styles.statCol}>
                <Ionicons name="trophy-outline" size={15} color={GOLD} />
                <Text style={styles.statLabel}>Prize Pool</Text>
                <Text style={styles.statValue} numberOfLines={1}>{prizeText}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCol}>
                <Ionicons name="people-outline" size={15} color="#38BDF8" />
                <Text style={styles.statLabel}>Entries</Text>
                <Text style={styles.statValue}>{entriesCount}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCol}>
                <Ionicons name="time-outline" size={15} color="#FBBF24" />
                <Text style={styles.statLabel}>Timeline</Text>
                <Text style={styles.statValue} numberOfLines={1}>{timeRemaining || 'Active'}</Text>
              </View>
            </View>
            
            {/* Action Button */}
            <TouchableOpacity
              style={[
                styles.actionButton,
                isVoting && styles.votingButton,
                !isActive && !isVoting && styles.actionButtonDisabled,
              ]}
              onPress={() => navigation.navigate('CampaignDetail', { campaignId: item.id })}
              activeOpacity={0.85}
            >
              <Text style={[
                styles.actionButtonText,
                isVoting && styles.votingButtonText,
                !isActive && !isVoting && styles.actionButtonTextDisabled,
              ]}>
                {btnLabel}
              </Text>
              <Ionicons 
                name={isVoting ? "star" : "arrow-forward"} 
                size={15} 
                color={isVoting ? "#fff" : !isActive && !isVoting ? "#777" : "#000"} 
                style={{ marginLeft: 6 }} 
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [navigation, campaigns.length]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      {/* Sticky Header */}
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Ionicons name="trophy" size={20} color={colors.primary} />
          <Text style={[styles.headerTitleText, { color: colors.text }]}>Campaigns</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Filter Tabs Bar - Prominent, beautiful, All/Active/Voting easily seen */}
      <View style={[styles.filterWrapper, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}
        >
          {TABS.map(tab => {
            const isActive = filter === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.filterChip,
                  isActive && styles.filterChipActive
                ]}
                onPress={() => setFilter(tab.id)}
                activeOpacity={0.75}
              >
                <Ionicons 
                  name={tab.icon} 
                  size={14} 
                  color={isActive ? '#000' : colors.primary} 
                />
                <Text style={[
                  styles.filterText,
                  { color: colors.primary },
                  isActive && styles.filterTextActive
                ]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Minimized Hero Section - Clean, compact rewards banner */}
      <View style={[styles.heroSectionCompact, { borderColor: colors.primary + '30', backgroundColor: colors.primary + '12' }]}>
        <View style={styles.heroLeft}>
          <View style={[styles.heroIconSmall, { backgroundColor: colors.primary }]}>
            <Ionicons name="trophy" size={15} color="#000" />
          </View>
          <View>
            <Text style={[styles.heroTitleCompact, { color: colors.primaryDark || colors.primary }]}>Win Real Prizes</Text>
            <Text style={[styles.heroSubtitleCompact, { color: colors.textSecondary }]}>Join challenges, vote & win rewards</Text>
          </View>
        </View>
        <View style={[styles.heroBadge, { borderColor: colors.primary + '40' }]}>
          <Ionicons name="sparkles" size={11} color={GOLD} />
          <Text style={styles.heroBadgeText}>Rewards</Text>
        </View>
      </View>

      {/* Campaigns List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading campaigns...</Text>
        </View>
      ) : (
        <FlatList
          data={campaigns}
          renderItem={renderCampaignCard}
          keyExtractor={item => String(item.id)}
          removeClippedSubviews={true}
          maxToRenderPerBatch={5}
          windowSize={5}
          initialNumToRender={4}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={() => {
                setRefreshing(true);
                loadCampaigns();
              }} 
              tintColor={GOLD} 
            />
          }
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="trophy-outline" size={48} color="#666" />
              <Text style={styles.emptyText}>No campaigns found</Text>
              <Text style={styles.emptySubtext}>Check back later for new opportunities!</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: BG,
  },
  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: '800',
    color: GOLD,
  },
  // Filter Styles
  filterWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD,
  },
  filterContainer: {
    paddingVertical: 8,
  },
  filterContent: {
    gap: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1C1C20',
    borderWidth: 1.2,
    borderColor: '#2A2A30',
  },
  filterChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '700',
    color: GOLD,
  },
  filterTextActive: {
    color: '#000',
    fontWeight: '800',
  },
  // Minimized Hero Section
  heroSectionCompact: {
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  heroIconSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  heroTitleCompact: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  heroSubtitleCompact: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
  },
  heroBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: GOLD,
  },
  // Campaign Card Styles
  campaignWrapper: {
    marginBottom: 16,
    alignItems: 'center',
  },
  campaignCard: {
    backgroundColor: '#161619',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(143, 196, 65, 0.25)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
    width: width - 20,
    alignSelf: 'center',
  },
  imageContainer: {
    width: '100%',
    height: 215,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#0E0E10',
  },
  banner: {
    width: '100%',
    height: '100%',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A1E',
  },
  bannerPlaceholderText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    opacity: 0.8,
  },
  gradientOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 100,
  },
  statusPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  statusPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  prizePill: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1.2,
    borderColor: GOLD,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  prizePillText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  typePill: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  typePillText: {
    color: '#E5E7EB',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardContent: {
    padding: 16,
    paddingTop: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
    lineHeight: 23,
    letterSpacing: 0.2,
  },
  cardDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 10,
    lineHeight: 18,
  },
  // Decorative Stats Grid
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E1E23',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2A2A32',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#2E2E36',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  actionButton: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  actionButtonDisabled: {
    backgroundColor: '#26262B',
    shadowOpacity: 0,
    elevation: 0,
  },
  votingButton: {
    backgroundColor: '#3B82F6',
    shadowColor: '#3B82F6',
  },
  actionButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  actionButtonTextDisabled: {
    color: '#777',
  },
  votingButtonText: {
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },
  listContainer: {
    paddingHorizontal: 0,
    paddingBottom: 80,
    paddingTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#666',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
    textAlign: 'center',
  },
});
