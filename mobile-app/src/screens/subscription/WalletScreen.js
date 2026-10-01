import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, TextInput, RefreshControl, FlatList, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import SuccessModal from '../../components/common/SuccessModal';

const GOLD = '#8fc441';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#262626';

function timeAgo(d) {
  if (!d) return '';
  const dt = new Date(d);
  const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} at ${timeStr}`;
}

function formatReceiptDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function getStatusDisplay(w) {
  if (!w) return 'Processing Payout';
  const st = String(w.status || '').toLowerCase();
  if (st === 'processing' || st === 'pending') return 'Processing Payout';
  if (st === 'completed' || st === 'approved') return 'Completed';
  if (st === 'failed' || st === 'rejected') return 'Failed';
  return w.status_display || w.status || 'Processing Payout';
}

export default function WalletScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { hasActiveSubscription } = useAuth();
  const [summary, setSummary] = useState(null);
  const [config, setConfig] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showWithdrawReceiptModal, setShowWithdrawReceiptModal] = useState(false);
  const [withdrawPoints, setWithdrawPoints] = useState('10');
  const [withdrawReceiptData, setWithdrawReceiptData] = useState(null);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showReinvestModal, setShowReinvestModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [withdrawMethod, setWithdrawMethod] = useState('telebirr');
  const [reinvestAmount, setReinvestAmount] = useState('1');
  const [processing, setProcessing] = useState(false);
  const [packages, setPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [phone, setPhone] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Check subscription before allowing withdrawal
  const requireSubscription = () => {
    if (!hasActiveSubscription) {
      Alert.alert(
        'Subscription Required',
        'You need an active subscription to withdraw. Subscribe now to unlock all features!',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Subscribe', onPress: () => navigation.navigate('Subscription') }
        ]
      );
      return false;
    }
    return true;
  };

  const loadAll = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      const [s, c, pkgs, profile] = await Promise.all([
        api.request('/wallet/', { skipCache: true }),
        api.request('/wallet/config/', { skipCache: true }).catch(() => ({})),
        api.request('/coins/packages/', { skipCache: true }).catch(() => []),
        api.request('/profile/me/', { skipCache: true }).catch(() => ({})),
      ]);
      console.log('Wallet data:', s);
      console.log('Profile data:', profile);
      setSummary({ ...s, profile });
      setConfig(c);
      setPackages(Array.isArray(pkgs) ? pkgs : (pkgs.results || []));
    } catch (e) { 
      console.error('Wallet load error:', e);
      Alert.alert('Error', 'Failed to load wallet'); 
    }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      let allTransactions = [];
      let page = 1;
      let hasMore = true;
      let consecutiveEmptyPages = 0;
      
      while (hasMore && consecutiveEmptyPages < 3) {
        try {
          const data = await api.request(`/wallet/transactions/?page=${page}&page_size=100`, { skipCache: true });
          const pageTransactions = data.results || [];
          
          if (pageTransactions.length > 0) {
            allTransactions = [...allTransactions, ...pageTransactions];
            consecutiveEmptyPages = 0;
            console.log(`Page ${page}: Loaded ${pageTransactions.length} transactions`);
          } else {
            consecutiveEmptyPages++;
            console.log(`Page ${page}: No transactions found`);
          }
          
          hasMore = data.has_next && pageTransactions.length > 0;
          page++;
          
          // Safety check: don't load more than 50 pages total
          if (page > 50) {
            console.log('Reached maximum page limit (50), stopping pagination');
            break;
          }
        } catch (pageError) {
          console.error(`Error loading page ${page}:`, pageError);
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= 3) {
            console.log('Too many consecutive errors, stopping pagination');
            break;
          }
          page++;
        }
      }
      
      // Sort transactions by date (newest first)
      allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      console.log(`✅ Total loaded: ${allTransactions.length} transactions from ${page - 1} pages`);
      setTransactions(allTransactions);
    } catch (e) {
      console.error('❌ Critical error loading transactions:', e);
      // Fallback to empty array to prevent UI issues
      setTransactions([]);
    }
  }, []);

  const loadWithdrawals = useCallback(async () => {
    try {
      let allWithdrawals = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        try {
          const data = await api.request(`/wallet/withdrawals/?page=${page}&page_size=100`, { skipCache: true });
          const pageWithdrawals = data.results || [];
          
          if (pageWithdrawals.length > 0) {
            allWithdrawals = [...allWithdrawals, ...pageWithdrawals];
            hasMore = data.has_next;
            page++;
          } else {
            hasMore = false;
          }
        } catch (e) {
          console.error(`Error loading withdrawals page ${page}:`, e);
          hasMore = false;
        }
      }
      
      setWithdrawals(allWithdrawals);
    } catch (e) {
      console.error('Error loading withdrawals:', e);
      setWithdrawals([]);
    }
  }, []);

  const refreshWalletData = useCallback(async (silent = true) => {
    api.invalidateCache('/wallet/');
    api.invalidateCache('/wallet/transactions/');
    api.invalidateCache('/wallet/withdrawals/');
    api.invalidateCache('/profile/me/');
    await loadAll(silent);
    // Load secondary wallet data after the summary is visible. This keeps
    // tab changes responsive and avoids replacing the screen with a loader.
    loadTransactions();
    loadWithdrawals();
  }, [loadAll, loadTransactions, loadWithdrawals]);

  useEffect(() => {
    refreshWalletData(false);
  }, [refreshWalletData]);

  useFocusEffect(
    useCallback(() => {
      refreshWalletData(true);
    }, [refreshWalletData])
  );

  const total = summary?.balance?.total ?? summary?.total ?? 0;
  const earned = summary?.balance?.earned ?? summary?.earned_total ?? 0;
  const purchased = summary?.balance?.purchased ?? summary?.purchased_total ?? 0;
  const telebirrPurchased = summary?.balance?.telebirr_purchased ?? 0;
  const airtimePurchased = summary?.balance?.airtime_purchased ?? 0;
  const points = summary?.points || { current: 0, earned_total: 0, withdrawn_total: 0 };

  const pointsPerBirr = config?.points_per_birr || 10;
  const feePercent = parseFloat(config?.withdrawal?.fee_percent ?? config?.fee_percent ?? 20) || 20;
  const minPoints = config?.withdrawal_min_points || 10;
  const maxPoints = config?.withdrawal_max_points_per_request || 100000;
  const availablePoints = points.current || 0;
  const userPhone = summary?.profile?.phone_number || summary?.profile?.phone || '';

  const ptsNum = parseInt(withdrawPoints, 10);
  const validPts = !isNaN(ptsNum) && ptsNum > 0 ? ptsNum : 0;
  const grossBirr = validPts / pointsPerBirr;
  const feeBirr = grossBirr * (feePercent / 100);
  const netBirr = grossBirr - feeBirr;

  const openWithdrawModal = () => {
    if (!requireSubscription()) return;
    const defaultPts = String(config?.withdrawal_min_points || 10);
    setWithdrawPoints(defaultPts);
    setShowWithdrawModal(true);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'transactions' && transactions.length === 0) loadTransactions();
    if (tab === 'withdrawals' && withdrawals.length === 0) loadWithdrawals();
  };

  const handleWithdraw = async () => {
    if (!requireSubscription()) return;

    const pts = parseInt(withdrawPoints, 10);
    if (!pts || isNaN(pts) || pts < minPoints) {
      Alert.alert('Invalid Amount', `Minimum withdrawal is ${minPoints} points.`);
      return;
    }
    if (pts > availablePoints) {
      Alert.alert('Insufficient Points', `You only have ${availablePoints} points available.`);
      return;
    }
    if (pts > maxPoints) {
      Alert.alert('Limit Exceeded', `Maximum withdrawal per request is ${maxPoints} points.`);
      return;
    }

    setProcessing(true);
    try {
      const res = await api.request('/wallet/withdraw/', {
        method: 'POST',
        body: JSON.stringify({
          point_amount: pts,
          payout_method: 'telebirr',
          payout_account: userPhone || undefined,
          payout_account_name: summary?.profile?.username || '',
        }),
      });

      const withdrawal = res?.withdrawal || {
        id: res?.id || 1,
        point_amount: pts,
        gross_birr: grossBirr.toFixed(2),
        fee_birr: feeBirr.toFixed(2),
        platform_fee_birr: feeBirr.toFixed(2),
        net_birr: netBirr.toFixed(2),
        payout_method: 'telebirr',
        payout_method_display: 'Telebirr',
        payout_account: userPhone,
        status: 'processing',
        status_display: 'Processing Payout',
        created_at: new Date().toISOString(),
      };

      setWithdrawReceiptData(withdrawal);
      setShowWithdrawModal(false);
      setShowWithdrawReceiptModal(true);
      await refreshWalletData(true);
      loadWithdrawals();
    } catch (e) {
      Alert.alert('Withdrawal Failed', e.message || 'Withdrawal request failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleMonetizeCoins = async () => {
    const availableCoins = summary?.balance?.purchased || 0;
    if (availableCoins < 1000) {
      Alert.alert('Insufficient Coins', 'You need at least 1,000 purchased coins to monetize.');
      return;
    }
    
    Alert.alert(
      'Monetize Coins',
      `Convert ${availableCoins} coins to ETB via telebirr?\nEstimated payout: ${(availableCoins * 0.08).toFixed(2)} ETB (after 20% commission)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Monetize',
          onPress: async () => {
            try {
              const response = await api.request('/monetize/', {
                method: 'POST',
                body: JSON.stringify({
                  coins: availableCoins,
                  method: 'telebirr'
                })
              });
              
              Alert.alert(
                'Success', 
                `Monetization request submitted!\n${availableCoins} coins will be converted to ${(availableCoins * 0.08).toFixed(2)} ETB`
              );
              refreshWalletData(true);
            } catch (error) {
              Alert.alert('Error', 'Monetization failed. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleReinvest = async () => {
    const amount = parseInt(reinvestAmount, 10);
    const availablePoints = points.current || 0;

    if (!amount || amount < 1 || amount > availablePoints) {
      Alert.alert('Error', 'Enter a valid amount of points to convert.');
      return;
    }

    setProcessing(true);
    try {
      const response = await api.request('/wallet/reinvest/', {
        method: 'POST',
        body: JSON.stringify({ points: amount }),
      });
      Alert.alert('Success', response.message || 'Points converted to coins');
      setShowReinvestModal(false);
      setReinvestAmount('1');
      await refreshWalletData(true);
    } catch (e) {
      Alert.alert('Error', e.message || 'Conversion failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleTopUp = async () => {
    if (!requireSubscription()) return;

    if (!selectedPackage) {
      Alert.alert('Error', 'Select a package'); return;
    }
    setProcessing(true);
    try {
      let userPhone = user?.phone_number || user?.phone || user?.username || '';
      if (!userPhone || userPhone.replace(/\D/g, '').length < 9) {
        try {
          const profile = await api.getProfile();
          userPhone = profile?.phone_number || profile?.phone || userPhone;
        } catch (_) {}
      }

      const res = await api.telebirrCoinPurchase({
        packageId: selectedPackage.id,
        amountEtb: selectedPackage.price,
        phoneNumber: userPhone,
        coins: selectedPackage.coins,
      });

      if (!res?.success && !res?.mandate_id && !res?.originator_conversation_id) {
        Alert.alert('Payment Failed', res?.error || res?.message || 'Could not initiate payment. Please try again.');
        return;
      }

      setShowTopUpModal(false);

      Alert.alert(
        'Payment Requested',
        'Payment request sent! Please enter your PIN on your phone to complete the purchase.',
        [{
          text: 'OK',
          onPress: () => {
            let pollCount = 0;
            const pollInterval = setInterval(async () => {
              pollCount += 1;
              await refreshWalletData(true);
              if (pollCount >= 12) {
                clearInterval(pollInterval);
              }
            }, 5000);
          }
        }]
      );
    } catch (e) { Alert.alert('Error', e?.data?.error || e?.message || 'Payment failed'); }
    finally { setProcessing(false); }
  };

  const renderTxRow = (tx) => {
    const isGift = tx.type === 'gift_sent' || tx.type === 'gift_received';
    const isPointTx = tx.type === 'gift_received';
    const isPurchase = tx.type === 'purchase' || tx.type === 'coin_purchase';
    const isBonus = tx.type === 'bonus' || tx.type === 'daily_bonus' || tx.type === 'weekly_bonus' || tx.type === 'monthly_bonus';
    const isWithdrawal = tx.type === 'withdrawal';
    
    let primaryLabel = tx.type_display || tx.type;
    if (tx.type === 'gift_sent' && tx.other_user) {
      primaryLabel = `Gift sent to @${tx.other_user.username}`;
    } else if (tx.type === 'gift_received' && tx.other_user) {
      primaryLabel = `Gift from @${tx.other_user.username}`;
    } else if (isPurchase) {
      primaryLabel = 'Coin Purchase';
    } else if (isBonus) {
      primaryLabel = tx.type_display || 'Bonus Received';
    } else if (isWithdrawal) {
      primaryLabel = 'Withdrawal';
    }
    
    // Choose appropriate icon
    let iconName = 'arrow-down'; // default
    if (isGift) iconName = 'gift';
    else if (isPurchase) iconName = 'cart';
    else if (isBonus) iconName = 'star';
    else if (isWithdrawal) iconName = 'arrow-up';
    else iconName = tx.is_credit ? 'arrow-down' : 'arrow-up';
    
    // Build post info for gift transactions
    let postInfo = '';
    if (isGift && tx.post_details) {
      const post = tx.post_details;
      if (post.title) {
        postInfo = ` • Post: ${post.title}`;
      } else if (post.description && post.description.length > 30) {
        postInfo = ` • Post: ${post.description.substring(0, 30)}...`;
      } else if (post.description) {
        postInfo = ` • Post: ${post.description}`;
      }
    }
    
    // Ensure amount is displayed
    const amount = Math.abs(tx.coins || tx.amount || 0);
    const currency = isPointTx ? 'points' : (tx.currency || 'coins');
    
    return (
      <View key={tx.id || `${tx.type}-${tx.created_at}`} style={styles.txItem}>
        <View style={[styles.txIcon, { backgroundColor: tx.is_credit ? '#0D2D1A' : '#2D1010' }]}>
          <Ionicons name={iconName} size={16} color={tx.is_credit ? '#10B981' : '#EF4444'} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.txType}>{primaryLabel}</Text>
          <Text style={styles.txDate}>
            {timeAgo(tx.created_at)}
            {tx.description ? ` • ${tx.description}` : ''}
            {postInfo}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.txAmount, { color: tx.is_credit ? '#10B981' : '#EF4444' }]}>
            {tx.is_credit ? '+' : '-'}{amount}
          </Text>
          <Text style={{ fontSize: 9, color: '#666' }}>{currency}</Text>
        </View>
      </View>
    );
  };

  if (loading) return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Wallet</Text>
        <TouchableOpacity onPress={() => refreshWalletData(true)}>
          {refreshing ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="refresh" size={22} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshWalletData(true)} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        {/* Three Horizontal Dashboard Cards */}
        <View style={styles.dashboardRow}>
          {/* Card 1: Coins */}
          <View style={[styles.dashCard, { borderColor: '#D4AF37' }]}>
            <View style={styles.dashCardHeader}>
              <Ionicons name="wallet" size={14} color="#D4AF37" />
              <Text style={[styles.dashCardTitle, { color: '#fff' }]}>COINS</Text>
            </View>
            <Text style={[styles.dashCardValue, { color: '#fff' }]}>{total}</Text>
            <Text style={[styles.dashCardSubtitle, { color: 'rgba(255,255,255,0.85)' }]}>Spendable for boosts and gifts</Text>
            <View style={[styles.dashCardDivider, { borderTopColor: 'rgba(212,175,55,0.35)' }]}>
              <View style={styles.dashCardRow}>
                <Text style={[styles.dashCardLabel, { color: 'rgba(255,255,255,0.85)' }]}>Earned</Text>
                <Text style={[styles.dashCardStrong, { color: '#fff' }]}>{earned}</Text>
              </View>
              <View style={styles.dashCardRow}>
                <Text style={[styles.dashCardLabel, { color: 'rgba(255,255,255,0.85)' }]}>Purchased</Text>
                <Text style={[styles.dashCardStrong, { color: '#fff' }]}>{purchased}</Text>
              </View>
            </View>
          </View>

          {/* Card 2: Points */}
          <View style={[styles.dashCard, { borderColor: '#8B5CF6' }]}>
            <View style={styles.dashCardHeader}>
              <Ionicons name="gift" size={14} color="#fff" />
              <Text style={[styles.dashCardTitle, { color: '#fff' }]}>POINTS</Text>
            </View>
            <Text style={[styles.dashCardValue, { color: '#fff' }]}>{points.current || 0}</Text>
            <Text style={[styles.dashCardSubtitle, { color: 'rgba(255,255,255,0.85)' }]}>Convert to coins before boost</Text>
            <View style={[styles.dashCardDivider, { borderTopColor: 'rgba(139,92,246,0.45)' }]}>
              <View style={styles.dashCardRow}>
                <Text style={[styles.dashCardLabel, { color: 'rgba(255,255,255,0.85)' }]}>Earned</Text>
                <Text style={[styles.dashCardStrong, { color: '#fff' }]}>{points.earned_total || 0}</Text>
              </View>
              <View style={styles.dashCardRow}>
                <Text style={[styles.dashCardLabel, { color: 'rgba(255,255,255,0.85)' }]}>Gifts</Text>
                <Text style={[styles.dashCardStrong, { color: '#fff' }]}>{points.earned_total || 0}</Text>
              </View>
            </View>
          </View>

        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.cardBg }]} onPress={() => navigation.navigate('WebsiteCoin')}>
            <View style={[styles.actionGrad, { backgroundColor: GOLD }]}>
              <Ionicons name="add-circle" size={24} color="#fff" />
              <Text style={styles.actionText}>Buy Coins</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.cardBg }]} onPress={() => setShowReinvestModal(true)}>
            <View style={[styles.actionGrad, { backgroundColor: GOLD }]}>
              <Ionicons name="repeat" size={24} color="#fff" />
              <Text style={styles.actionText}>Re-invest</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.cardBg }]} onPress={openWithdrawModal}>
            <View style={[styles.actionGrad, { backgroundColor: GOLD }]}>
              <Ionicons name="cash-outline" size={24} color="#fff" />
              <Text style={styles.actionText}>Withdraw</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.cardBg }]} onPress={() => handleTabChange('transactions')}>
            <View style={[styles.actionGrad, { backgroundColor: GOLD }]}>
              <Ionicons name="receipt" size={22} color="#fff" />
              <Text style={styles.actionText}>Transactions</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
          {['overview', 'transactions', 'withdrawals'].map(tab => (
            <TouchableOpacity key={tab} style={styles.tabBtn} onPress={() => handleTabChange(tab)}>
              <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === tab && { color: colors.primary, fontWeight: '700' }]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
              {activeTab === tab && <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />}
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ padding: 16 }}>
          {/* Overview */}
          {activeTab === 'overview' && (
            <>
              {/* Recent Transactions */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={styles.sectionTitle}>Recent Transactions</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginRight: 8 }}>
                    {transactions.length > 0 ? `${transactions.length} total` : ''}
                  </Text>
                  <TouchableOpacity onPress={() => refreshWalletData(true)} style={{ padding: 4 }}>
                    <Ionicons name="refresh" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
              {transactions.length === 0
                ? <Text style={styles.emptyText}>No transactions yet</Text>
                : transactions.slice(0, 5).map(renderTxRow)}
              {transactions.length > 5 && (
                <TouchableOpacity onPress={() => setActiveTab('transactions')}>
                  <Text style={[styles.viewAllText, { color: colors.primary }]}>View all transactions →</Text>
                </TouchableOpacity>
              )}

              {/* Coin Packages */}
              <Text style={styles.sectionTitle}>Coin Packages</Text>
              {packages.length === 0
                ? <Text style={styles.emptyText}>No packages available</Text>
                : packages.map(pkg => (
                  <TouchableOpacity
                    key={pkg.id}
                    style={[styles.packageCard, selectedPackage?.id === pkg.id && styles.packageCardSelected]}
                    onPress={() => { setSelectedPackage(pkg); setShowTopUpModal(true); }}
                  >
                    <View>
                      <Text style={styles.pkgName}>{pkg.name}</Text>
                      <Text style={styles.pkgCoins}>{pkg.coin_amount} coins</Text>
                      {pkg.bonus_coins > 0 && <Text style={styles.pkgBonus}>+{pkg.bonus_coins} bonus ?</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.pkgPrice}>{pkg.price_etb} ETB</Text>
                      {pkg.is_featured && <View style={styles.featuredBadge}><Text style={styles.featuredText}>? Popular</Text></View>}
                    </View>
                  </TouchableOpacity>
                ))}
              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={18} color={GOLD} />
                <Text style={styles.infoText}>Only Telebirr-purchased coins can be used for gifting. Airtime-purchased coins cannot be gifted.</Text>
              </View>
            </>
          )}

          {/* Transactions */}
          {activeTab === 'transactions' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={styles.sectionTitle}>All Transactions</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginRight: 8 }}>
                    {transactions.length > 0 ? `${transactions.length} loaded` : ''}
                  </Text>
                  <TouchableOpacity onPress={() => refreshWalletData(true)} style={{ padding: 4 }}>
                    <Ionicons name="refresh" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
              {transactions.length === 0
                ? <Text style={styles.emptyText}>No transactions yet</Text>
                : (
                  <FlatList
                    data={transactions}
                    keyExtractor={(item) => item.id?.toString() || `${item.type}-${item.created_at}`}
                    renderItem={({ item }) => renderTxRow(item)}
                    scrollEnabled={false}
                    nestedScrollEnabled={false}
                  />
                )}
              {activeTab === 'transactions' && transactions.length > 0 && (
                <View style={[styles.monetizeSection, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                  <View style={styles.monetizeHeader}>
                    <Ionicons name="cash-outline" size={24} color={GOLD} />
                    <View style={styles.monetizeInfo}>
                      <Text style={[styles.monetizeTitle, { color: colors.text }]}>Monetize Your Coins</Text>
                      <Text style={[styles.monetizeSubtitle, { color: colors.textSecondary }]}>
                        Convert your available coins to ETB via telebirr
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity 
                    style={[styles.monetizeBtn, { backgroundColor: GOLD }]}
                    onPress={() => handleMonetizeCoins()}
                  >
                    <Ionicons name="trending-up" size={20} color="#000" />
                    <Text style={styles.monetizeBtnText}>Monetize All Coins</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* Withdrawals */}
          {activeTab === 'withdrawals' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={styles.sectionTitle}>Withdrawal History</Text>
                <TouchableOpacity onPress={() => refreshWalletData(true)} style={{ padding: 4 }}>
                  <Ionicons name="refresh" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
              {withdrawals.length === 0
                ? <Text style={styles.emptyText}>No withdrawal history</Text>
                : withdrawals.map((w) => (
                  <View key={w.id} style={styles.txItem}>
                    <View style={[styles.txIcon, { backgroundColor: '#2D1010' }]}>
                      <Ionicons name="cash-outline" size={16} color="#EF4444" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.txType}>Withdrawal - {w.payout_method}</Text>
                      <Text style={styles.txDate}>
                        {timeAgo(w.created_at)}
                        {w.payout_account ? ` • ${w.payout_account}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.txAmount, { color: '#EF4444' }]}>
                        -{w.point_amount}
                      </Text>
                      <Text style={{ fontSize: 9, color: '#666' }}>points</Text>
                      <View style={[styles.statusBadge, { 
                        backgroundColor: w.status === 'completed' ? '#0D2D1A' : 
                                       w.status === 'pending' ? '#3A2D0D' : 
                                       w.status === 'failed' ? '#2D1010' : '#1A1A1A' 
                      }]}>
                        <Text style={{ 
                          fontSize: 10, 
                          fontWeight: '600',
                          color: w.status === 'completed' ? '#10B981' : 
                                w.status === 'pending' ? '#F59E0B' : 
                                w.status === 'failed' ? '#EF4444' : '#666' 
                        }}>
                          {w.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
            </>
          )}

        </View>
      </ScrollView>

      {/* Withdraw Points to Birr Modal (Screenshot 2) */}
      <Modal
        visible={showWithdrawModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWithdrawModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalCenteredOverlay}
        >
          <View style={styles.withdrawCardContainer}>
            <View style={styles.withdrawHeaderRow}>
              <Text style={styles.withdrawModalTitle}>Withdraw Points to Birr</Text>
              <TouchableOpacity
                onPress={() => setShowWithdrawModal(false)}
                style={styles.withdrawCloseBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.withdrawAmountLabel}>Amount in points</Text>
            <TextInput
              style={styles.withdrawPointsInput}
              value={withdrawPoints}
              onChangeText={setWithdrawPoints}
              keyboardType="number-pad"
              placeholder="10"
              placeholderTextColor="#888"
            />
            <Text style={styles.withdrawLimitText}>
              Min: {minPoints} • Available: {availablePoints.toLocaleString()} points
            </Text>

            <View style={styles.withdrawBreakdownBox}>
              <View style={styles.breakdownItemRow}>
                <Text style={styles.breakdownItemLabel}>Gross amount</Text>
                <Text style={styles.breakdownItemVal}>{grossBirr.toFixed(2)} ETB</Text>
              </View>
              <View style={styles.breakdownItemRow}>
                <Text style={styles.breakdownItemLabel}>Platform fee ({feePercent}%)</Text>
                <Text style={styles.breakdownItemVal}>-{feeBirr.toFixed(2)} ETB</Text>
              </View>
              <View style={styles.breakdownHr} />
              <View style={[styles.breakdownItemRow, { alignItems: 'center', marginTop: 2 }]}>
                <Text style={styles.breakdownTotalLabel}>You receive</Text>
                <Text style={styles.breakdownTotalVal}>{netBirr.toFixed(2)} ETB</Text>
              </View>
            </View>

            <View style={styles.withdrawButtonsRow}>
              <TouchableOpacity
                style={styles.withdrawCancelBtn}
                onPress={() => setShowWithdrawModal(false)}
                disabled={processing}
              >
                <Text style={styles.withdrawCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.withdrawConfirmBtn, processing && { opacity: 0.7 }]}
                onPress={handleWithdraw}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.withdrawConfirmBtnText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Withdrawal Requested Receipt Modal (Screenshot 1) */}
      <Modal
        visible={showWithdrawReceiptModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowWithdrawReceiptModal(false);
          setWithdrawReceiptData(null);
        }}
      >
        <View style={styles.modalCenteredOverlay}>
          <View style={styles.receiptContainer}>
            <View style={styles.receiptCheckCircle}>
              <View style={styles.receiptCheckRing}>
                <Ionicons name="checkmark" size={26} color="#fff" />
              </View>
            </View>

            <Text style={styles.receiptTitle}>Withdrawal requested</Text>
            <Text style={styles.receiptSubtitle}>
              Your points have been deducted and the payout is on its way. The money reaches your telebirr wallet once it is confirmed — you will get an SMS either way.
            </Text>

            <View style={styles.receiptDetailsCard}>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Reference</Text>
                <Text style={styles.receiptDetailValue}>#{withdrawReceiptData?.id || ''}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Status</Text>
                <Text style={styles.receiptDetailValue}>{getStatusDisplay(withdrawReceiptData)}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Points withdrawn</Text>
                <Text style={styles.receiptDetailValue}>{withdrawReceiptData?.point_amount || ''} pts</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Gross</Text>
                <Text style={styles.receiptDetailValue}>{Number(withdrawReceiptData?.gross_birr || 0).toFixed(2)} ETB</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Platform fee</Text>
                <Text style={styles.receiptDetailValue}>-{Number(withdrawReceiptData?.platform_fee_birr || withdrawReceiptData?.fee_birr || 0).toFixed(2)} ETB</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Method</Text>
                <Text style={styles.receiptDetailValue}>Telebirr</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Sent to</Text>
                <Text style={styles.receiptDetailValue}>{withdrawReceiptData?.payout_account || userPhone || '—'}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Requested</Text>
                <Text style={styles.receiptDetailValue}>{formatReceiptDate(withdrawReceiptData?.created_at)}</Text>
              </View>
              <View style={styles.receiptDividerLine} />
              <View style={[styles.receiptDetailRow, { alignItems: 'center', marginTop: 4 }]}>
                <Text style={styles.receiptReceiveLabel}>You receive</Text>
                <Text style={styles.receiptReceiveVal}>{Number(withdrawReceiptData?.net_birr || 0).toFixed(2)} ETB</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.receiptOkButton}
              onPress={() => {
                setShowWithdrawReceiptModal(false);
                setWithdrawReceiptData(null);
                refreshWalletData(true);
                loadWithdrawals();
              }}
            >
              <Text style={styles.receiptOkButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Top Up Modal */}
      <Modal visible={showTopUpModal} transparent animationType="slide" onRequestClose={() => setShowTopUpModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Buy Coins via telebirr</Text>
              <TouchableOpacity onPress={() => setShowTopUpModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {selectedPackage && (
              <View style={styles.selectedPkg}>
                <Ionicons name="diamond-outline" size={28} color={GOLD} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.pkgName}>{selectedPackage.name}</Text>
                  <Text style={styles.pkgCoins}>{selectedPackage.coin_amount} coins</Text>
                </View>
                <Text style={styles.pkgPrice}>{selectedPackage.price_etb} ETB</Text>
              </View>
            )}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Payment will be charged to your registered Telebirr number</Text>
            <TouchableOpacity style={[styles.submitBtn, (!selectedPackage || processing) && { opacity: 0.6 }]} onPress={handleTopUp} disabled={!selectedPackage || processing}>
              {processing ? <ActivityIndicator color="#000" /> : <Text style={styles.submitBtnText}>{selectedPackage ? `Pay ${selectedPackage.price_etb} ETB` : 'Select a package'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Reinvest Modal */}
      <Modal visible={showReinvestModal} transparent animationType="slide" onRequestClose={() => setShowReinvestModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Re-invest Points to Coins</Text>
              <TouchableOpacity onPress={() => setShowReinvestModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.reinvestBanner}>
              <View>
                <Text style={styles.reinvestBannerLabel}>RATE</Text>
                <Text style={styles.reinvestBannerTitle}>1 Point → 1 Coin</Text>
              </View>
              <Text style={styles.reinvestBannerMeta}>{(points.current || 0).toLocaleString()} pts available</Text>
            </View>

            <Text style={styles.fieldLabel}>Points to convert</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter points"
              placeholderTextColor="#666"
              value={reinvestAmount}
              onChangeText={setReinvestAmount}
              keyboardType="number-pad"
            />

            <View style={styles.reinvestPreview}>
              <Text style={styles.reinvestPreviewLabel}>You will receive</Text>
              <Text style={styles.reinvestPreviewValue}>{Math.max(parseInt(reinvestAmount || '0', 10) || 0, 0).toLocaleString()} coins</Text>
            </View>

            <View style={styles.reinvestActions}>
              <TouchableOpacity
                style={[styles.secondaryBtn, processing && { opacity: 0.6 }]}
                onPress={() => setShowReinvestModal(false)}
                disabled={processing}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, styles.reinvestSubmitBtn, processing && { opacity: 0.6 }]}
                onPress={handleReinvest}
                disabled={processing}
              >
                {processing ? <ActivityIndicator color="#000" /> : <Text style={styles.submitBtnText}>Reinvest</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <SuccessModal
        visible={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title="Success"
        message={successMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: 18, fontWeight: '700', color: GOLD },
  balanceCard: { margin: 16, padding: 24, borderRadius: 20, overflow: 'hidden' },
  balanceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  balanceLabel: { fontSize: 13, color: '#000', fontWeight: '600' },
  balanceAmount: { fontSize: 44, fontWeight: '900', color: '#000', marginVertical: 4 },
  balanceSubtext: { fontSize: 13, color: '#000', opacity: 0.8 },
  dashboardRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 16, gap: 8, marginBottom: 12 },
  dashCard: { flex: 1, padding: 12, borderRadius: 14, minHeight: 160, backgroundColor: '#000', borderWidth: 2 },
  dashCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  dashCardTitle: { fontSize: 10, fontWeight: '800', color: '#1A1A1A', letterSpacing: 0.5 },
  dashCardValue: { fontSize: 22, fontWeight: '900', color: '#1A1A1A', lineHeight: 24 },
  dashCardSubtitle: { fontSize: 10, color: 'rgba(0,0,0,0.7)', marginTop: 2, marginBottom: 8 },
  dashCardDivider: { marginTop: 'auto', paddingTop: 8, borderTopWidth: 1 },
  dashCardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  dashCardLabel: { fontSize: 10, color: 'rgba(0,0,0,0.7)' },
  dashCardStrong: { fontSize: 10, fontWeight: '700', color: '#1A1A1A' },
  dashCardBtn: { marginTop: 6, padding: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center' },
  dashCardBtnText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  actionBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  actionGrad: { minHeight: 78, paddingHorizontal: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#2A2A2A', borderRadius: 14 },
  actionText: { color: '#fff', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 16 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', position: 'relative' },
  tabText: { fontSize: 12, color: '#666', fontWeight: '500' },
  tabTextActive: { color: GOLD, fontWeight: '700' },
  tabIndicator: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: GOLD },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: GOLD, marginBottom: 12 },
  emptyText: { color: '#666', textAlign: 'center', padding: 24 },
  packageCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: BORDER },
  packageCardSelected: { borderColor: GOLD, backgroundColor: GOLD + '10' },
  pkgName: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 2 },
  pkgCoins: { fontSize: 18, fontWeight: '800', color: GOLD },
  pkgBonus: { fontSize: 12, color: '#10B981', fontWeight: '600' },
  pkgPrice: { fontSize: 17, fontWeight: '700', color: '#fff' },
  featuredBadge: { backgroundColor: GOLD, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 4 },
  featuredText: { fontSize: 10, color: '#000', fontWeight: '700' },
  infoBox: { flexDirection: 'row', backgroundColor: CARD, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: BORDER, marginTop: 8 },
  infoText: { flex: 1, fontSize: 12, color: '#888', lineHeight: 18 },
  summaryCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  summaryCard: { flex: 1, alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 1, marginHorizontal: 4 },
  summaryLabel: { fontSize: 12, fontWeight: '500', marginTop: 8, marginBottom: 4 },
  summaryAmount: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  summarySubtext: { fontSize: 11, fontWeight: '500' },
  pointsCard: { margin: 16, padding: 20, borderRadius: 16, borderWidth: 1 },
  pointsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pointsTitle: { fontSize: 13, fontWeight: '600' },
  pointsAmount: { fontSize: 36, fontWeight: '800', marginBottom: 4 },
  pointsSubtitle: { fontSize: 12, marginBottom: 12 },
  pointsStats: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: 1 },
  pointsStatItem: { flex: 1 },
  pointsStatLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  pointsStatValue: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  viewAllText: { fontSize: 12, textAlign: 'center', padding: 12, fontWeight: '600' },
  txItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  txIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  txType: { fontSize: 13, fontWeight: '600', color: '#fff' },
  txDate: { fontSize: 11, color: '#666', marginTop: 2 },
  txAmount: { fontSize: 13, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statsContainer: { 
    flexDirection: 'row', 
    paddingHorizontal: 12, 
    marginBottom: 20,
    gap: 8,
  },
  statItem: { 
    flex: 1, 
    backgroundColor: CARD, 
    borderRadius: 16, 
    paddingVertical: 20,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5, 
    borderColor: BORDER,
    minHeight: 110,
  },
  statNumber: { 
    fontSize: 22, 
    fontWeight: '900', 
    color: '#fff', 
    marginTop: 10,
    marginBottom: 6,
  },
  statLabel: { 
    fontSize: 11, 
    color: '#999', 
    fontWeight: '700',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderTopColor: BORDER },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#aaa', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: CARD, borderRadius: 12, padding: 14, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: BORDER },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  methodBtnActive: { borderColor: GOLD, backgroundColor: GOLD + '20' },
  methodText: { color: '#666', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  methodTextActive: { color: GOLD },
  submitBtn: { backgroundColor: GOLD, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  submitBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  selectedPkg: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
    reinvestBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: GOLD, borderRadius: 14, padding: 16, marginBottom: 16 },
    reinvestBannerLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(0,0,0,0.7)', letterSpacing: 0.5 },
    reinvestBannerTitle: { fontSize: 16, fontWeight: '800', color: '#000', marginTop: 2 },
    reinvestBannerMeta: { fontSize: 12, fontWeight: '700', color: '#000' },
    reinvestPreview: { backgroundColor: '#1F2A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2E3D24', padding: 14, marginTop: 16 },
    reinvestPreviewLabel: { fontSize: 12, color: '#999', marginBottom: 6 },
    reinvestPreviewValue: { fontSize: 18, fontWeight: '800', color: '#fff' },
    reinvestActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
    secondaryBtn: { flex: 1, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
    secondaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    reinvestSubmitBtn: { flex: 1, marginTop: 0 },
  monetizeSection: { margin: 16, padding: 20, borderRadius: 16, borderWidth: 1, marginTop: 20 },
  monetizeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  monetizeInfo: { flex: 1, marginLeft: 12 },
  monetizeTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  monetizeSubtitle: { fontSize: 13, lineHeight: 18 },
  monetizeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 12, gap: 8 },
  monetizeBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  // Centered Modals for Withdrawal
  modalCenteredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  withdrawCardContainer: {
    width: '100%',
    maxWidth: 390,
    backgroundColor: '#161616',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#262626',
  },
  withdrawHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  withdrawModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  withdrawCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#222224',
    justifyContent: 'center',
    alignItems: 'center',
  },
  withdrawAmountLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 8,
  },
  withdrawPointsInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#8fc441',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  withdrawLimitText: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 8,
    marginBottom: 16,
    fontWeight: '500',
  },
  withdrawBreakdownBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  breakdownItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  breakdownItemLabel: {
    fontSize: 14,
    color: '#4B5563',
    fontWeight: '500',
  },
  breakdownItemVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  breakdownHr: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 10,
  },
  breakdownTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  breakdownTotalVal: {
    fontSize: 22,
    fontWeight: '900',
    color: '#000000',
  },
  withdrawButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  withdrawCancelBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  withdrawCancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  withdrawConfirmBtn: {
    flex: 1,
    backgroundColor: '#8fc441',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  withdrawConfirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  // Receipt Modal Styles
  receiptContainer: {
    width: '100%',
    maxWidth: 390,
    backgroundColor: '#161616',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
  },
  receiptCheckCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#00C070',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  receiptCheckRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  receiptTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  receiptSubtitle: {
    fontSize: 13,
    color: '#A0A0A0',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  receiptDetailsCard: {
    width: '100%',
    backgroundColor: '#222225',
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
  },
  receiptDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  receiptDetailLabel: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },
  receiptDetailValue: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  receiptDividerLine: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 10,
  },
  receiptReceiveLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  receiptReceiveVal: {
    fontSize: 18,
    fontWeight: '900',
    color: '#00d26a',
  },
  receiptOkButton: {
    backgroundColor: '#8fc441',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 44,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  receiptOkButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

