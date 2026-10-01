import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';

const GOLD = '#8fc441';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#262626';
const TEXT = '#fff';
const SUB = '#666';

const TYPE_COLOR = {
  daily: '#3B82F6',
  weekly: '#8B5CF6',
  monthly: '#F59E0B',
  grand: '#EF4444',
};

const TYPE_LABEL = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  grand: 'Grand Final',
};

export default React.memo(function HorizontalCampaignSuggestions({ onCampaignClick, onDismiss }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      const data = await api.request('/campaigns/?status=active&limit=8');
      const all = Array.isArray(data) ? data : (data.results || []);
      
      // Filter out expired and ended campaigns
      const now = new Date();
      const active = all.filter(c => {
        // Skip if status is completed or ended
        if (c.status === 'completed' || c.status === 'ended') return false;
        // Skip if end_date has passed
        if (c.end_date) {
          const endDate = new Date(c.end_date);
          if (endDate <= now) return false;
        }
        return true;
      });
      
      if (active.length === 0) {
        const upcoming = await api.request('/campaigns/?status=upcoming&limit=4');
        const up = Array.isArray(upcoming) ? upcoming : (upcoming.results || []);
        setCampaigns(up.slice(0, 6));
      } else {
        setCampaigns(active.slice(0, 6));
      }
    } catch (error) {
      console.error('Failed to fetch campaign suggestions:', error);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  const getDaysLeft = (endDate) => {
    if (!endDate) return null;
    const diff = new Date(endDate) - new Date();
    if (diff <= 0) return null;
    const days = Math.floor(diff / 86400000);
    if (days === 0) {
      const hours = Math.floor((diff % 86400000) / 3600000);
      return hours > 0 ? `${hours}h left` : 'Ending soon';
    }
    return `${days} day${days > 1 ? 's' : ''} left`;
  };

  if (loading) return null;
  if (!campaigns || campaigns.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Decorative top gradient */}
      <View style={styles.topGradient} />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconContainer}>
            <Ionicons name="trophy" size={18} color="#fff" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>CAMPAIGNS</Text>
            <View style={styles.headerSubtitleRow}>
              <Text style={styles.headerSubtitle}>Active Competitions</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{campaigns.length}</Text>
              </View>
            </View>
          </View>
        </View>
        {onDismiss && (
          <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn}>
            <Ionicons name="close" size={18} color={SUB} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {campaigns.map((campaign) => {
          const typeColor = TYPE_COLOR[campaign.campaign_type] || GOLD;
          const typeLabel = TYPE_LABEL[campaign.campaign_type] || campaign.campaign_type;
          const isActive = campaign.status === 'active';
          const imgUri = campaign.image || campaign.banner_image;

          return (
            <TouchableOpacity
              key={campaign.id}
              style={styles.card}
              onPress={() => onCampaignClick?.(campaign.id)}
              activeOpacity={0.85}
            >
              {/* Image area with gradient overlay */}
              <View style={[styles.imageContainer, { backgroundColor: typeColor + '33' }]}>
                <View style={[styles.imageGradient, { backgroundColor: typeColor + '44' }]} />
                {imgUri ? (
                  <Image source={{ uri: imgUri }} style={styles.image} />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Ionicons name="trophy" size={32} color={typeColor} />
                  </View>
                )}
                {/* Status badge */}
                <View style={[styles.statusBadge, { backgroundColor: isActive ? '#10B981' : '#F59E0B' }]}>
                  <Ionicons name="flame" size={9} color="#fff" />
                  <Text style={styles.statusBadgeText}>{isActive ? 'LIVE' : 'SOON'}</Text>
                </View>
                {/* Type badge */}
                <View style={[styles.typeBadge, { backgroundColor: typeColor + 'dd' }]}>
                  <Text style={styles.typeBadgeText}>{typeLabel}</Text>
                </View>
                {/* Decorative corner */}
                <View style={[styles.decorativeCorner, { backgroundColor: typeColor + '66' }]} />
              </View>

              {/* Info */}
              <View style={styles.info}>
                <Text style={styles.title} numberOfLines={1}>{campaign.title}</Text>
                {campaign.participants_count != null && (
                  <View style={styles.participantsRow}>
                    <Ionicons name="people-outline" size={11} color={SUB} />
                    <Text style={styles.participantsText}>{campaign.participants_count} participants</Text>
                  </View>
                )}
                {getDaysLeft(campaign.end_date) && (
                  <View style={styles.daysLeftRow}>
                    <Ionicons name="time-outline" size={10} color={GOLD} />
                    <Text style={styles.daysLeftText}>{getDaysLeft(campaign.end_date)}</Text>
                  </View>
                )}
                <View style={styles.viewBtn}>
                  <Text style={styles.viewBtnText}>JOIN NOW</Text>
                  <Ionicons name="chevron-forward" size={12} color="#000" />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
    backgroundColor: CARD,
    borderTopWidth: 2,
    borderTopColor: GOLD + '40',
    borderBottomWidth: 2,
    borderBottomColor: GOLD + '40',
    paddingVertical: 18,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: GOLD + '60',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: GOLD,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  headerTextContainer: {
    marginLeft: 2,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: 0.3,
  },
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: SUB,
  },
  badge: {
    backgroundColor: GOLD + '25',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: GOLD + '40',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: GOLD,
  },
  dismissBtn: {
    padding: 6,
    borderRadius: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  card: {
    width: 170,
    minWidth: 170,
    backgroundColor: BG,
    borderWidth: 2,
    borderColor: GOLD + '66',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  imageContainer: {
    height: 100,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  decorativeCorner: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
  },
  info: {
    padding: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  participantsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  participantsText: {
    fontSize: 11,
    fontWeight: '500',
    color: SUB,
    marginLeft: 3,
  },
  daysLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  daysLeftText: {
    fontSize: 10,
    fontWeight: '700',
    color: GOLD,
    marginLeft: 2,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 7,
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  viewBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
