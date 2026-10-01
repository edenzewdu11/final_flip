import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  Image, ActivityIndicator, Dimensions, ScrollView,
  StatusBar, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import CampaignEventEmitter from '../../contexts/CampaignEventEmitter';
import api from '../../api';
import config from '../../config';

const { width, height } = Dimensions.get('window');
const GOLD = '#8fc441';
const LIGHT_GOLD = '#8fc441';
const BG = '#0B0B0C';  // Darker background to match design
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const COLS = 3;
const GAP = 2; // Slightly larger gap
const ITEM_SIZE = Math.floor((width - (GAP * (COLS + 1))) / COLS); // Calculate exact size for 3 columns
const ITEM_HEIGHT = Math.round(ITEM_SIZE * 120 / 100); // Changed from 178 to 120 for better aspect ratio
const HERO_HEIGHT = Math.round(width * 56 / 100);

// Explore modes shared with the website.
const CATEGORIES = [
  { id: 'all', label: 'All', icon: 'checkmark-circle', emoji: '✓', color: '#8fc441' },
  { id: 'dance', label: 'Dance', icon: 'musical-notes', emoji: '💃', color: '#FF6B6B' },
  { id: 'comedy', label: 'Comedy', icon: 'happy', emoji: '😂', color: '#FFD93D' },
  { id: 'music', label: 'Music', icon: 'musical-note', emoji: '🎵', color: '#6BCF7F' },
];

const TIME_RANGES = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
];

// Helper functions
const mediaUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${config.API_BASE_URL.replace('/api', '')}${url}`;
};

const fmt = (n) => {
  if (!n && n !== 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

// Avatar component
const Avatar = React.memo(function Avatar({ uri, size = 40, name = '' }) {
  const [err, setErr] = useState(false);
  const safeName = name || '?';
  
  if (uri && !err) {
    return (
      <Image
        source={{ uri }}
        style={{ 
          width: size, 
          height: size, 
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: GOLD
        }}
        onError={() => setErr(true)}
      />
    );
  }
  
  return (
    <View style={{ 
      width: size, 
      height: size, 
      borderRadius: size / 2, 
      backgroundColor: GOLD, 
      justifyContent: 'center', 
      alignItems: 'center',
      borderWidth: 2,
      borderColor: '#fff'
    }}>
      <Text style={{ color: '#000', fontWeight: '700', fontSize: size * 0.4 }}>
        {safeName[0].toUpperCase()}
      </Text>
    </View>
  );
});

// Video thumbnail component matching website
const VideoThumb = React.memo(function VideoThumb({ reel, rank, index = 0, hero = false, onOpen }) {
  const videoUrl = reel.file_url || reel.media;
  const imageUrl = reel.image || reel.media;
  const isVid = !!(videoUrl || '').match(/\.(mp4|webm|ogg|mov)/i) || (videoUrl && videoUrl.includes('/video/'));
  const isBoosted = Boolean(reel.is_boosted);
  
  // Try different URL patterns for thumbnail
  let thumb = null;
  
  // Priority: 1) thumbnail, 2) image, 3) media, 4) file_url
  if (reel.thumbnail) {
    thumb = mediaUrl(reel.thumbnail);
  } else if (imageUrl) {
    thumb = mediaUrl(imageUrl);
  } else if (videoUrl) {
    thumb = mediaUrl(videoUrl);
  } else if (reel.file_url) {
    thumb = mediaUrl(reel.file_url);
  }

  // If still no thumbnail, try to construct from common patterns
  if (!thumb && reel.id) {
    thumb = `${config.API_BASE_URL.replace('/api', '')}/media/thumbnails/${reel.id}.jpg`;
  }

  return (
    <TouchableOpacity
      style={[
        styles.gridItem,
        hero && styles.heroItem,
        isBoosted && styles.boostedGridItem,
      ]}
      onPress={() => onOpen?.(reel)}
    >
      {thumb ? (
        <Image
          source={{ uri: thumb }}
          style={styles.gridImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.gridImage, styles.fallbackContainer]}>
          <Ionicons
            name={isVid ? 'play' : 'image'}
            size={hero ? 48 : 28}
            color="#666"
          />
          <Text style={styles.fallbackText}>
            {isVid ? 'Video' : 'Image'}
          </Text>
        </View>
      )}

      {/* Video indicator */}
      {isVid && (
        <View style={styles.videoIcon}>
          <Ionicons name="play" size={hero ? 12 : 9} color="#fff" />
        </View>
      )}

      {isBoosted && (
        <View style={[
          styles.boostBadge,
          rank !== undefined && rank < 3 && (hero ? styles.boostBadgeHeroWithRank : styles.boostBadgeWithRank),
        ]}>
          <Ionicons name="flash" size={hero ? 12 : 10} color="#0D0D0D" />
          <Text style={[styles.boostBadgeText, hero && styles.boostBadgeTextHero]}>BOOST</Text>
        </View>
      )}

      {/* Rank medal (top 3) */}
      {rank !== undefined && rank < 3 && (
        <View style={[
          styles.rankBadge,
          { backgroundColor: rank === 0 ? '#FFD700' : rank === 1 ? '#C0C0C0' : '#CD7F32' }
        ]}>
          <Text style={[styles.rankText, { color: '#000' }]}>{rank + 1}</Text>
        </View>
      )}

      {/* Bottom stats */}
      <View style={styles.gridOverlay}>
        {hero && reel.user?.username && (
          <Text style={styles.heroUsername}>@{reel.user.username}</Text>
        )}
        <View style={styles.statsRow}>
          <Ionicons name="heart" size={hero ? 13 : 10} color={LIGHT_GOLD} />
          <Text style={[styles.gridStat, { color: LIGHT_GOLD }]}>
            {fmt(reel.votes || 0)}
          </Text>
        </View>
        {(reel.comment_count > 0 || reel.comments > 0) && (
          <View style={styles.statsRow}>
            <Ionicons name="eye" size={hero ? 12 : 10} color="rgba(255,255,255,0.8)" />
            <Text style={styles.gridStat}>
              {fmt(reel.comment_count || reel.comments || 0)}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

// Skeleton loader component
function GridSkeleton() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={styles.skeletonItem} />
      ))}
    </View>
  );
}

export default function ExploreScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { colors } = useTheme();
  const user = auth?.user ?? null;

  // Explore state
  const [activeCategory, setActiveCategory] = useState('trending');
  const [timeRange, setTimeRange] = useState('24h');
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hashtags, setHashtags] = useState([]);
  const [hashLoading, setHashLoading] = useState(true);
  const [hashtagView, setHashtagView] = useState(null);
  const [categories, setCategories] = useState(CATEGORIES);

  // Search state
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState({ users: [], posts: [], hashtags: [] });
  const [searchLoading, setSearchLoading] = useState(false);

  // Pagination
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const INITIAL_LIMIT = 12;
  const PAGE_LIMIT = 12;

  const inSearchMode = debouncedQ.trim().length > 0;

  const fetchTrending = useCallback(async ({ showSpinner = true, limit = INITIAL_LIMIT } = {}) => {
    if (showSpinner) setLoading(true);
    setHasMore(true);

    const category = activeCategory === 'all' ? 'all' : activeCategory;

    try {
      const d = await api.request(`/explorer/trending/?category=${category}&time_range=${timeRange}&limit=${limit}`, { skipCache: true });
      const list = Array.isArray(d) ? d : (d?.results || []);
      setVideos(list);
      setHasMore(list.length >= limit);
    } catch {
      setVideos([]);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [activeCategory, timeRange]);

  // Fetch trending when Explore becomes active and when filters change.
  useFocusEffect(
    useCallback(() => {
      fetchTrending({ showSpinner: true, limit: INITIAL_LIMIT });
      return undefined;
    }, [fetchTrending])
  );

  useEffect(() => {
    const unsubscribe = CampaignEventEmitter.addListener('boost_updated', () => {
      fetchTrending({ showSpinner: false, limit: INITIAL_LIMIT });
    });

    return unsubscribe;
  }, [fetchTrending]);

  // Load more videos
  const loadMore = useCallback(() => {
    if (inSearchMode || loadingMore || !hasMore || loading) return;
    
    setLoadingMore(true);
    const category = activeCategory === 'all' ? 'all' : activeCategory;
    const offset = videos.length;
    
    api.request(`/explorer/trending/?category=${category}&time_range=${timeRange}&limit=${PAGE_LIMIT}&offset=${offset}`)
      .then(d => {
        const page = Array.isArray(d) ? d : (d?.results || []);
        if (page.length === 0) {
          setHasMore(false);
        } else {
          // Dedup by id
          setVideos(prev => {
            const seen = new Set(prev.map(v => v.id));
            return [...prev, ...page.filter(v => !seen.has(v.id))];
          });
          if (page.length < PAGE_LIMIT) setHasMore(false);
        }
      })
      .catch(() => { /* keep what we have */ })
      .finally(() => setLoadingMore(false));
  }, [activeCategory, timeRange, videos.length, hasMore, loading, loadingMore, inSearchMode]);
  // Fetch categories from API
  useEffect(() => {
    let cancelled = false;
    
    api.request('/categories/')
      .then(d => {
        if (!cancelled) {
          const apiCategories = Array.isArray(d) ? d : [];
          // Convert API categories to the format we need
          const formattedCategories = apiCategories.map(cat => ({
            id: cat.slug,
            label: cat.name,
            icon: cat.icon || 'pricetag',
            emoji: cat.emoji || '📌'
          }));
          // Add 'all' and 'trending' at the beginning
          setCategories([
            { id: 'all', label: 'All', icon: 'checkmark-circle', emoji: '✓', color: '#8fc441' },
            { id: 'dance', label: 'Dance', icon: 'musical-notes', emoji: '💃', color: '#FF6B6B' },
            { id: 'comedy', label: 'Comedy', icon: 'happy', emoji: '😂', color: '#FFD93D' },
            { id: 'music', label: 'Music', icon: 'musical-note', emoji: '🎵', color: '#6BCF7F' },
            ...formattedCategories
          ]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Keep default categories if API fails
          setCategories(CATEGORIES);
        }
      });
    
    return () => { cancelled = true; };
  }, []);

  // Fetch trending hashtags
  useEffect(() => {
    let cancelled = false;
    setHashLoading(true);

    api.request(`/explorer/trending-hashtags/?time_range=${timeRange}&limit=15`, { skipCache: true })
      .then(d => { 
        if (!cancelled) {
          console.log(`[HASHTAGS] Fetched hashtags for ${timeRange}:`, d);
          setHashtags(Array.isArray(d) ? d : []); 
        }
      })
      .catch(() => { if (!cancelled) setHashtags([]); })
      .finally(() => { if (!cancelled) setHashLoading(false); });

    return () => { cancelled = true; };
  }, [timeRange]);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Live search
  useEffect(() => {
    if (!debouncedQ.trim()) { 
      setSearchResults({ users: [], posts: [], hashtags: [] }); 
      return; 
    }
    
    let cancelled = false;
    setSearchLoading(true);
    
    api.request(`/search/?q=${encodeURIComponent(debouncedQ.trim())}`)
      .then(d => { if (!cancelled) setSearchResults(d || { users: [], posts: [], hashtags: [] }); })
      .catch(() => { if (!cancelled) setSearchResults({ users: [], posts: [], hashtags: [] }); })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    
    return () => { cancelled = true; };
  }, [debouncedQ]);

  const clearSearch = () => {
    setQuery('');
    setDebouncedQ('');
    setSearchFocused(false);
  };

  const handleHashtagClick = async (tag) => {
    const cleanTag = tag.replace(/^#/, '');
    setLoading(true);
    try {
      const data = await api.request(`/explorer/hashtag/?tag=${encodeURIComponent(cleanTag)}&limit=30`);
      const results = data?.results || [];
      setHashtagView({ tag: cleanTag, videos: results, count: data?.count || results.length });
      setVideos(results);
    } catch (e) {
      console.error('Failed to fetch hashtag:', e);
      setHashtagView({ tag: cleanTag, videos: [], count: 0 });
      setVideos([]);
    } finally {
      setLoading(false);
    }
  };

  const clearHashtagView = () => {
    setHashtagView(null);
    fetchTrending({ showSpinner: true, limit: 30 });
  };

  useEffect(() => {
    if (route?.params?.hashtag) {
      handleHashtagClick(route.params.hashtag);
    }
  }, [route?.params?.hashtag]);

  const openReel = useCallback((reel) => {
    console.log('ExploreScreen - openReel called with:', {
      id: reel.id,
      media: reel.media,
      file_url: reel.file_url,
      image: reel.image,
      thumbnail: reel.thumbnail
    });

    // Always navigate to ReelsDetail with the post ID - it handles both videos and images
    console.log('ExploreScreen - Navigating to ReelsDetail with initialVideoId:', reel.id);
    navigation.navigate('ReelsDetail', { initialVideoId: reel.id });
  }, [navigation]);

  const openProfile = (userId) => {
    navigation.navigate('ProfileStack', { userId });
  };

  const renderGridItem = useCallback(({ item, index }) => (
    <VideoThumb
      reel={item}
      rank={index}
      index={index}
      hero={false}
      onOpen={openReel}
    />
  ), [openReel]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.text === '#FFFFFF' ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent={true} />
      
      {/* Sticky Header - Overlays with status bar */}
      {/* Sticky Header */}
      <View style={[styles.header, { backgroundColor: BG, paddingTop: insets.top }]}>

        {/* Search bar row */}
        <View style={styles.headerRow1}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={16} color="#888" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search videos, users..."
              placeholderTextColor="#888"
              value={query}
              onChangeText={setQuery}
            />
            {query ? (
              <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
                <Ionicons name="close" size={14} color="#888" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {!inSearchMode && !searchFocused && (
          <>
            {/* CATEGORIES label + chips */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderText}>CATEGORIES</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryScroll}
              style={styles.categoryRow}
            >
              {categories.map(cat => {
                const isActive = activeCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => { setActiveCategory(cat.id); setHashtagView(null); }}
                    style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                  >
                    <View style={[styles.categoryIconBox, isActive && styles.categoryIconBoxActive]}>
                      <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                    </View>
                    {isActive ? (
                      <Text style={styles.categoryLabel}>{cat.label}</Text>
                    ) : (
                      <Text style={styles.categoryLabelInactive}>{cat.label}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* TIME label + buttons */}
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="time-outline" size={13} color="#888" />
              <Text style={styles.sectionHeaderText}>TIME</Text>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.timeRow}
              contentContainerStyle={styles.timeRowContent}
            >
              {TIME_RANGES.map(r => (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => { setTimeRange(r.id); setHashtagView(null); }}
                  style={[styles.timeBtn, timeRange === r.id && styles.timeBtnActive]}
                >
                  <Text style={[styles.timeBtnText, timeRange === r.id && styles.timeBtnTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Trending Hashtags */}
            {!hashLoading && hashtags.length > 0 && (
              <View style={styles.hashtagSection}>
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="trending-up" size={13} color={GOLD} />
                  <Text style={[styles.sectionHeaderText, { color: GOLD }]}>TRENDING HASHTAGS</Text>
                  <View style={styles.hashtagCountBadge}>
                    <Text style={styles.hashtagCountBadgeText}>{hashtags.length}</Text>
                  </View>
                  {hashtagView && (
                    <TouchableOpacity onPress={clearHashtagView} style={styles.hashtagClearInlineBtn}>
                      <Text style={styles.hashtagClearInlineText}>Reset</Text>
                      <Ionicons name="close-circle" size={13} color="#888" />
                    </TouchableOpacity>
                  )}
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.hashtagHorizontalScroll}
                  style={styles.hashtagScrollContainer}
                  nestedScrollEnabled={true}
                  keyboardShouldPersistTaps="handled"
                >
                  {hashtags.map(h => {
                    const cleanTag = (h.tag || '').replace(/^#/, '');
                    const isSelected = hashtagView?.tag === cleanTag;
                    return (
                      <TouchableOpacity
                        key={h.tag}
                        onPress={() => isSelected ? clearHashtagView() : handleHashtagClick(cleanTag)}
                        style={[styles.trendingHashtagChip, isSelected && styles.trendingHashtagChipActive]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.trendingHashtagHash, isSelected && styles.trendingHashtagTextActive]}>#</Text>
                        <Text style={[styles.trendingHashtagText, isSelected && styles.trendingHashtagTextActive]} numberOfLines={1}>
                          {cleanTag}
                        </Text>
                        <View style={[styles.hashtagPostsBadge, isSelected && styles.hashtagPostsBadgeActive]}>
                          <Text style={[styles.trendingHashtagCount, isSelected && styles.trendingHashtagCountActive]}>
                            {fmt(h.posts)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </View>

      {/* Scrollable Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {inSearchMode ? (
          // Search Results
          <View style={styles.searchResults}>
            {searchLoading ? (
              <View style={styles.searchLoading}>
                {[0,1,2,3].map(i => (
                  <View key={i} style={styles.searchSkeleton} />
                ))}
              </View>
            ) : (
              <>
                {/* Users */}
                {searchResults.users?.length > 0 && (
                  <View style={styles.searchSection}>
                    <Text style={styles.sectionTitle}>PEOPLE</Text>
                    {searchResults.users.map(u => (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => openProfile(u.id)}
                        style={styles.userRow}
                      >
                        <Avatar uri={u.profile_photo} size={42} name={u.username} />
                        <View style={styles.userInfo}>
                          <Text style={styles.userName}>@{u.username}</Text>
                          {u.followers_count > 0 && (
                            <Text style={styles.userFollowers}>
                              {fmt(u.followers_count)} followers
                            </Text>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#666" />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Hashtags */}
                {searchResults.hashtags?.length > 0 && (
                  <View style={styles.searchSection}>
                    <Text style={styles.sectionTitle}>HASHTAGS</Text>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.hashtagScrollContent}
                    >
                      {searchResults.hashtags.map(tag => (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => handleHashtagClick(tag)}
                          style={styles.hashtagChip}
                        >
                          <Text style={styles.hashtagText}>#{tag}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Posts */}
                {searchResults.posts?.length > 0 && (
                  <View style={styles.searchSection}>
                    <Text style={styles.sectionTitle}>POSTS</Text>
                    <View style={styles.grid}>
                      {searchResults.posts.map((r, i) => (
                        <VideoThumb
                          key={r.id ?? i}
                          reel={r}
                          rank={i}
                          index={i}
                          hero={false}
                          onOpen={openReel}
                        />
                      ))}
                    </View>
                  </View>
                )}

                {/* No results */}
                {!searchResults.users?.length && !searchResults.hashtags?.length && !searchResults.posts?.length && (
                  <View style={styles.noResults}>
                    <Ionicons name="search" size={40} color="#666" style={{ opacity: 0.3, marginBottom: 12 }} />
                    <Text style={styles.noResultsTitle}>No results for "{debouncedQ}"</Text>
                    <Text style={styles.noResultsText}>Try different keywords or browse trending below</Text>
                  </View>
                )}
              </>
            )}
          </View>
        ) : (
          // Explore Mode
          <View style={styles.exploreContent}>

            {/* Hashtag view header */}
            {hashtagView && (
              <View style={styles.hashtagViewHeader}>
                <TouchableOpacity onPress={clearHashtagView} style={styles.hashtagBackButton}>
                  <Ionicons name="close" size={20} color="#fff" />
                </TouchableOpacity>
                <View style={styles.hashtagViewInfo}>
                  <Text style={styles.hashtagViewTitle}>#{hashtagView.tag}</Text>
                  <Text style={styles.hashtagViewCount}>{fmt(hashtagView.count)} posts</Text>
                </View>
                <Ionicons name="hash" size={28} color={LIGHT_GOLD} style={{ opacity: 0.5 }} />
              </View>
            )}

            {/* Trending video grid */}
            {!loading && !hashtagView && videos.length > 0 && (
              <Text style={styles.showingText}>
                Showing <Text style={styles.showingBold}>
                  {activeCategory === 'all' ? 'all categories' : activeCategory}
                </Text> from the last <Text style={styles.showingBold}>
                  {timeRange === '24h' ? '24 hours' : timeRange === '7d' ? '7 days' : '30 days'}
                </Text>
              </Text>
            )}
            {loading ? (
              <GridSkeleton />
            ) : videos.length === 0 ? (
              <View style={styles.emptyState}>
                {hashtagView ? (
                  <>
                    <Ionicons name="hash" size={44} color="#666" style={{ opacity: 0.3, marginBottom: 12 }} />
                    <Text style={styles.emptyTitle}>No posts with #{hashtagView.tag}</Text>
                    <Text style={styles.emptyText}>Be the first to post with this hashtag!</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="trending-up" size={44} color="#666" style={{ opacity: 0.3, marginBottom: 12 }} />
                    <Text style={styles.emptyTitle}>Nothing trending yet</Text>
                    <Text style={styles.emptyText}>Check back soon or try a different category</Text>
                  </>
                )}
              </View>
            ) : (
              <>
                <View style={styles.grid}>
                  {videos.map((reel, idx) => (
                    <VideoThumb
                      key={reel.id ?? idx}
                      reel={reel}
                      rank={idx}
                      index={idx}
                      hero={false}
                      onOpen={openReel}
                    />
                  ))}
                </View>
                
                {/* Silent load more - no indicators */}
                {hasMore && !hashtagView && loadingMore && (
                  <View style={{ height: 1 }} />
                )}
              </>
            )}
            
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  
  // Header Styles
  header: {
    backgroundColor: BG,
    zIndex: 20,
    paddingBottom: 6,
  },
  headerRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 6 : 6,
    paddingBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: LIGHT_GOLD,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 14,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 6,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: CARD,
  },
  timeChipActive: {
    backgroundColor: GOLD,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
  },
  timeTextActive: {
    color: '#000',
  },
  
  // Category Navigation
  categoryRow: {
    paddingHorizontal: 12,
    paddingBottom: 14,
    paddingTop: 4,
  },
  categoryScroll: {
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 0,
    backgroundColor: CARD,
  },
  categoryChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  categoryTextActive: {
    color: '#000',
  },
  
  // Content
  content: {
    flex: 1,
  },
  
  // Search Results
  searchResults: {
    paddingTop: 8,
    paddingHorizontal: 0,
    paddingBottom: 32,
  },
  searchLoading: {
    flexDirection: 'column',
    gap: 10,
    paddingTop: 8,
  },
  searchSkeleton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: BORDER,
  },
  searchSection: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: LIGHT_GOLD,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: LIGHT_GOLD,
  },
  userFollowers: {
    fontSize: 12,
    color: LIGHT_GOLD,
  },
  hashtagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  hashtagScrollContent: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
  },
  hashtagChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#8fc44118',
    borderWidth: 1,
    borderColor: '#8fc44140',
  },
  hashtagText: {
    fontSize: 14,
    fontWeight: '700',
    color: LIGHT_GOLD,
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  noResultsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: LIGHT_GOLD,
    marginBottom: 6,
  },
  noResultsText: {
    fontSize: 13,
    color: '#666',
  },
  
  // Explore Content
  exploreContent: {
    flex: 1,
    paddingTop: 8,
    paddingHorizontal: 0,
    paddingBottom: 32,
  },
  
  // Spacers to center trending content
  topSpacer: {
    flex: 1,
  },
  bottomSpacer: {
    flex: 1,
  },
  
  // Section header row (CATEGORIES / TIME labels)
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    letterSpacing: 1,
  },
  categoryRow: { marginBottom: 4 },
  categoryScroll: { paddingHorizontal: 14, gap: 8 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#1e1e1e',
  },
  categoryChipActive: { backgroundColor: GOLD },
  categoryIconBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2e2e2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconBoxActive: { backgroundColor: 'rgba(0,0,0,0.2)' },
  categoryEmoji: { fontSize: 12 },
  categoryLabel: { fontSize: 13, fontWeight: '700', color: '#000' },
  categoryLabelInactive: { fontSize: 13, fontWeight: '600', color: '#ccc' },
  timeRow: {
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    marginHorizontal: 14,
    marginBottom: 6,
    overflow: 'hidden',
  },
  timeRowContent: {
    flexDirection: 'row',
    paddingHorizontal: 0,
  },
  timeBtn: { 
    paddingVertical: 10, 
    paddingHorizontal: 16,
    alignItems: 'center',
    minWidth: 80,
  },
  timeBtnActive: { backgroundColor: GOLD, borderRadius: 8 },
  timeBtnText: { fontSize: 13, fontWeight: '700', color: '#888' },
  timeBtnTextActive: { color: '#000' },
  showingText: { fontSize: 13, color: '#aaa', paddingHorizontal: 14, paddingVertical: 8 },
  showingBold: { fontWeight: '800', color: '#fff' },
  timeRangeContainer: {},
  timeChip: {},
  timeText: {},
  
  // Hashtag Section
  hashtagSection: {
    marginBottom: 4,
  },
  hashtagScrollContainer: {
    marginTop: 2,
    marginBottom: 4,
  },
  hashtagHorizontalScroll: {
    paddingHorizontal: 14,
    gap: 8,
  },
  hashtagCountBadge: {
    backgroundColor: 'rgba(143, 196, 65, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(143, 196, 65, 0.4)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 4,
  },
  hashtagCountBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: GOLD,
  },
  hashtagClearInlineBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  hashtagClearInlineText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  trendingHashtagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    gap: 4,
  },
  trendingHashtagChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  trendingHashtagHash: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
  },
  trendingHashtagText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  trendingHashtagTextActive: {
    color: '#000',
  },
  hashtagPostsBadge: {
    backgroundColor: '#2e2e2e',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 2,
  },
  hashtagPostsBadgeActive: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  trendingHashtagCount: {
    fontSize: 10,
    fontWeight: '700',
    color: '#aaa',
  },
  trendingHashtagCountActive: {
    color: '#000',
  },
  hashtagLoading: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  hashtagSkeleton: {
    width: 80,
    height: 46,
    borderRadius: 20,
    backgroundColor: BORDER,
  },
  
  // Hashtag View
  hashtagViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: LIGHT_GOLD + '15',
    borderRadius: 12,
    marginBottom: 16,
  },
  hashtagBackButton: {
    padding: 4,
  },
  hashtagViewInfo: {
    flex: 1,
  },
  hashtagViewTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: LIGHT_GOLD,
  },
  hashtagViewCount: {
    fontSize: 12,
    color: '#666',
  },
  
  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.78,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  boostedGridItem: {
    borderWidth: 2,
    borderColor: GOLD,
    elevation: 5,
  },
  heroItem: {
    width: width,
    height: width * 0.56,
    marginBottom: GAP,
    borderRadius: 0,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  fallbackContainer: {
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    color: '#666',
    fontSize: 10,
    marginTop: 4,
  },
  videoIcon: {
    position: 'absolute',
    top: 7,
    left: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rankBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    elevation: 6,
    zIndex: 10,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#000',
  },
  boostBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: GOLD,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
  boostBadgeWithRank: {
    right: 34,
  },
  boostBadgeHeroWithRank: {
    right: 44,
  },
  boostBadgeText: {
    color: '#0D0D0D',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  boostBadgeTextHero: {
    fontSize: 11,
  },
  gridOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingTop: 8,
    paddingHorizontal: 6,
    paddingBottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroUsername: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: LIGHT_GOLD,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  gridStat: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },

  // Skeleton
  skeletonItem: {
    width: ITEM_SIZE,
    height: ITEM_HEIGHT,
    borderRadius: 4,
    backgroundColor: BORDER,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: LIGHT_GOLD,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: '#666',
  },

  // Spacers
  topSpacer: { height: 0 },
  bottomSpacer: { height: 32 },
});
