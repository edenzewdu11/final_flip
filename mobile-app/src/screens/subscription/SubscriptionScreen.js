import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, BackHandler, Modal, TextInput, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import { Linking } from 'react-native';
import SuccessModal from '../../components/common/SuccessModal';
import TelebirrSubscriptionModal from '../../components/subscription/TelebirrSubscriptionModal';

const GOLD = '#C8B56A';
const BG = '#0B0B0C';
const CARD = '#161616';
const BORDER = '#242424';

const PLAN_ICONS = { daily: 'flash', weekly: 'star', monthly: 'trophy', ondemand: 'diamond' };
const PLAN_COLORS = { daily: '#F59E0B', weekly: '#8B5CF6', monthly: '#C8B56A', ondemand: '#3B82F6' };

const FALLBACK_TIERS = [
  { id: 1, name: 'Daily', duration_type: 'daily',    price_etb: 3,  description: '24 hours of full access', features: ['Ad-free videos', 'HD quality', 'All content'] },
  { id: 2, name: 'Weekly', duration_type: 'weekly',   price_etb: 20, description: '7 days of full access',  features: ['Ad-free videos', 'HD quality', 'All content', 'Priority support'] },
  { id: 3, name: 'Monthly', duration_type: 'monthly',  price_etb: 70, description: '30 days of full access', features: ['Ad-free videos', 'HD quality', 'All content', 'Priority support', 'Campaign boosts'] },
  { id: 4, name: 'On Demand', duration_type: 'ondemand', price_etb: 10, price_coins: 100, description: 'Pay per use with coins', features: ['Flexible access', 'No recurring charges', 'Use coins anytime'] },
];

const BENEFITS = [
  { icon: 'videocam-outline',    text: 'HD Videos' },
  { icon: 'ad-outline',          text: 'Ad-Free Experience' },
  { icon: 'star-outline',        text: 'Exclusive Content' },
  { icon: 'trophy-outline',      text: 'Campaign Priority' },
];

export default function SubscriptionScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { logout, hasActiveSubscription } = useAuth();
  const [tiers, setTiers] = useState(FALLBACK_TIERS);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentTier, setSelectedPaymentTier] = useState(null);
  const [currentSub, setCurrentSub] = useState(null);
  const [selectedTier, setSelectedTier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processingTierId, setProcessingTierId] = useState(null);
  const [telebirrModalVisible, settelebirrModalVisible] = useState(false);
  const [telebirrPhone, settelebirrPhone] = useState('');
  const [selectedTierFortelebirr, setSelectedTierFortelebirr] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const pollRef = useRef(null);

  const handleBackPress = async () => {
    if (!hasActiveSubscription) {
      await logout();
      return true;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }

    return false;
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackPress();
      return true;
    });

    return () => {
      subscription.remove();
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [hasActiveSubscription, navigation]);

  const loadData = async () => {
    try {
      const [tiersData, subData] = await Promise.all([
        api.request('/subscriptions/tiers/active/').catch(() => []),
        api.request('/subscriptions/').catch(() => null),
      ]);
      
      console.log('Subscription API Response:', { tiersData, subData });
      console.log('Current subscription data:', subData);
      console.log('Subscription status:', subData?.status);
      console.log('Subscription tier:', subData?.tier);
      
      if (Array.isArray(tiersData) && tiersData.length > 0) setTiers(tiersData);
      setCurrentSub(subData);
    } catch (error) {
      console.error('Error loading subscription data:', error);
    }
    finally { setLoading(false); }
  };

  const handleSubscribe = async (tier) => {
    // OnDemand uses coins - show payment options
    if (tier.duration_type === 'ondemand') {
      setSelectedPaymentTier(tier);
      setShowPaymentModal(true);
      return;
    }

    // Other tiers use SMS
    const codeMap = { daily: '1', weekly: '2', monthly: '3' };
    const code = codeMap[tier.duration_type] || '1';
    Linking.openURL(`sms:9286?body=${encodeURIComponent(code)}`).catch(() =>
      Alert.alert('Error', 'Could not open SMS app')
    );
  };

  const mandateIdRef = useRef(null);

  const startSubscriptionPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    let attempts = 0;
    const MAX_POLLS = 36; // 3 minutes
    const POLL_INTERVAL = 5000;

    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        // Poll subscription status directly (matches web implementation)
        const sub = await api.request('/subscriptions/', { skipCache: true });
        if (sub && sub.status === 'active') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setProcessingTierId(null);
          setCurrentSub(sub);
          setSuccessMessage('You are successfully subscribed!');
          setShowSuccessModal(true);
          return;
        }
      } catch (error) {
        console.error('Subscription polling error:', error);
      }

      if (attempts >= MAX_POLLS && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setProcessingTierId(null);
        Alert.alert('Payment Timeout', 'Payment is taking longer than expected. Please check your subscription status.');
      }
    }, POLL_INTERVAL);
  };

  const handletelebirrSubscribe = async (tier) => {
    setSelectedTierFortelebirr(tier);
    try {
      const profile = await api.request('/profile/me/');
      settelebirrPhone(profile?.phone_number || '');
    } catch (error) {
      console.error('Failed to fetch phone number:', error);
      settelebirrPhone('');
    }
    settelebirrModalVisible(true);
  };

  const handletelebirrProceed = async (paymentData) => {
    const tier = selectedTierFortelebirr;
    if (!tier) {
      return;
    }

    const phoneNumber = typeof paymentData === 'object' ? paymentData.phone : (paymentData || telebirrPhone);
    const verificationSessionId = typeof paymentData === 'object' ? paymentData.verificationSessionId : null;

    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 9) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid phone number.');
      return;
    }

    setProcessingTierId(tier.id);
    settelebirrModalVisible(false);

    try {
      // Use USSD Push endpoint with verification_session_id
      const response = await api.initiateTelebirrUssdPush(
        tier.id,
        phoneNumber,
        verificationSessionId
      );

      const transactionId = response?.originator_conversation_id || response?.conversation_id || response?.id;
      if (response && (response.success || transactionId)) {
        Alert.alert(
          'Telebirr Request Sent',
          'Please enter your PIN on your phone to complete the subscription.'
        );
        startSubscriptionPolling();
      } else {
        Alert.alert('Subscription Failed', response?.error || 'Failed to initiate USSD payment.');
        setProcessingTierId(null);
      }
    } catch (error) {
      console.error('telebirr subscription error:', error);
      Alert.alert('Subscription Failed', error.message || 'Failed to process telebirr subscription.');
      setProcessingTierId(null);
    }
  };

  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancel Subscription',
      'Are you sure you want to cancel your current subscription?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.unsubscribe();
              Alert.alert('Cancelled', 'Your subscription has been cancelled successfully.');
              setCurrentSub(null);
            } catch (error) {
              console.error('Cancel error:', error);
              Alert.alert('Error', error.message || 'Failed to cancel subscription.');
            }
          },
        },
      ]
    );
  };

  const isActive = currentSub?.status === 'active';
  const subscriptionPaymentMethod = String(
    currentSub?.payment_method || currentSub?.tier?.payment_method || ''
  ).trim().toLowerCase();
  const isTelebirrSubscription = Boolean(currentSub?.mandate_contract_id)
    || subscriptionPaymentMethod.includes('telebirr');
  const subscriptionPaymentLabel = isTelebirrSubscription
    ? 'Telebirr'
    : 'Airtime';
  
  console.log('isActive check:', { 
    currentSub, 
    status: currentSub?.status, 
    isActive, 
    hasCurrentSub: !!currentSub,
    hasTier: !!currentSub?.tier 
  });

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleBackPress}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Subscription</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading subscription plans...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBackPress}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Subscription</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
        
        {/* Current Subscription Status */}
        {isActive && currentSub && (
          <View style={[styles.currentSubCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={styles.activeHero}>
              <View style={styles.activeIcon}>
                <Ionicons name="diamond" size={32} color="#0D1606" />
              </View>
              <Text style={[styles.activeTitle, { color: colors.text }]}>FlipStar Premium</Text>
              <Text style={[styles.activeSubtitle, { color: colors.textSecondary }]}>
                Like, comment, share and send gifts — you are all set.
              </Text>
              <View style={styles.activePill}>
                <View style={styles.activeDot} />
                <Text style={styles.activePillText}>
                  Active · {currentSub.tier?.name || currentSub.plan_name || currentSub.name || 'Premium'}
                </Text>
              </View>
              {!!currentSub.start_date && (
                <Text style={[styles.activeDate, { color: colors.textSecondary }]}>
                  Start: {new Date(currentSub.start_date).toLocaleString()}
                </Text>
              )}
              {!!currentSub.end_date && (
                <Text style={[styles.activeDate, { color: colors.textSecondary }]}>
                  End: {new Date(currentSub.end_date).toLocaleString()}
                </Text>
              )}
            </View>
            <View style={styles.currentSubDetails}>

              {/* Cancellation Option */}
              {isActive && isTelebirrSubscription ? (
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: '#EF4444' }]}
                  onPress={handleCancelSubscription}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                  <Text style={styles.cancelBtnText}>Cancel Current Subscription</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.cancelInfo}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.cancelInfoText, { color: colors.textSecondary }]}>
                    To cancel, send {currentSub.tier?.duration_type === 'daily' || currentSub.duration_type === 'daily' ? 'STOP1' : currentSub.tier?.duration_type === 'weekly' || currentSub.duration_type === 'weekly' ? 'STOP2' : 'STOP3'} to 9286 via SMS
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* No Subscription Info (also shown when the last subscription has expired/cancelled) */}
        {!isActive && !loading && (
          <View style={[styles.currentSubCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={styles.currentSubHeader}>
              <Ionicons name="information-circle" size={24} color={colors.textSecondary} />
              <Text style={[styles.currentSubTitle, { color: colors.text }]}>Upgrade</Text>
            </View>
            <View style={styles.currentSubDetails}>
              <Text style={[styles.currentPlanName, { color: colors.textSecondary }]}>
                No current subscription
              </Text>
            </View>
          </View>
        )}

        {/* Available Plans - only show when user doesn't have active subscription */}
        {!isActive && (() => {
          // Show all plans except ondemand
          const visibleTiers = tiers.filter(tier => tier.duration_type !== 'ondemand');

          const sectionTitle = 'Available Plans';

          return (
            <>
              {sectionTitle && (
                <Text style={[styles.sectionLabel, { color: colors.text }]}>
                  {sectionTitle}
                </Text>
              )}

              {visibleTiers.map((tier, i) => {
                const isSelected = selectedTier?.id === tier.id;
                const isCurrent = currentSub?.tier?.id === tier.id && isActive;
                const color = PLAN_COLORS[tier.duration_type] || GOLD;
                const icon = PLAN_ICONS[tier.duration_type] || 'star';

                if (Platform.OS === 'ios') {
                  // iOS: Informational display only
                  return (
                    <View
                      key={tier.id}
                      style={[
                        styles.infoPlanCard,
                        { backgroundColor: colors.cardBg, borderColor: colors.border },
                        isCurrent && styles.planCardCurrent,
                      ]}
                    >
                      {isCurrent && (
                        <View style={[styles.currentTag, { backgroundColor: color }]}>
                          <Text style={styles.currentTagText}>Current</Text>
                        </View>
                      )}

                      {/* Simple Plan Display */}
                      <View style={styles.infoPlanHeader}>
                        <Text style={[styles.infoPlanName, { color: colors.text }]}>{tier.name}</Text>
                        <Text style={[styles.infoPlanPrice, { color }]}>{tier.price_etb} ETB</Text>
                      </View>

                      {/* Description */}
                      <Text style={[styles.infoPlanDesc, { color: colors.textSecondary }]}>{tier.description}</Text>

                      {/* Features */}
                      <View style={styles.infoFeatures}>
                        {(tier.features || []).map((f, fi) => (
                          <Text key={fi} style={[styles.infoFeatureText, { color: colors.textSecondary }]}>• {f}</Text>
                        ))}
                      </View>
                    </View>
                  );
                } else {
                  // Android: Normal purchase flow with tappable buttons
                  return (
                    <View
                      key={tier.id}
                      style={[
                        styles.planCard,
                        { backgroundColor: colors.cardBg, borderColor: colors.border },
                        isSelected && { borderColor: color, borderWidth: 2 },
                        isCurrent && styles.planCardCurrent,
                      ]}
                    >
                      {isCurrent && (
                        <View style={[styles.currentTag, { backgroundColor: color }]}>
                          <Text style={styles.currentTagText}>Current</Text>
                        </View>
                      )}

                      <View style={styles.planTop}>
                        <View style={[styles.planIconBox, { backgroundColor: color + '22' }]}>
                          <Ionicons name={icon} size={22} color={color} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 14 }}>
                          <Text style={[styles.planName, { color: colors.text }]}>{tier.name}</Text>
                          <Text style={[styles.planDesc, { color: colors.textSecondary }]}>{tier.description}</Text>
                        </View>
                        <View style={styles.planPriceBox}>
                          <Text style={[styles.planPrice, { color }]}>{tier.price_etb}</Text>
                          <Text style={[styles.planCurrency, { color: colors.textSecondary }]}>ETB</Text>
                        </View>
                      </View>

                      <View style={styles.planFeatures}>
                        {(tier.features || []).map((f, fi) => (
                          <View key={fi} style={styles.featureRow}>
                            <Ionicons name="checkmark" size={14} color={colors.primary} />
                            <Text style={[styles.featureText, { color: colors.text }]}>{f}</Text>
                          </View>
                        ))}
                      </View>

                      <TouchableOpacity
                        style={[styles.planBtn, { backgroundColor: color }]}
                        onPress={() => handleSubscribe(tier)}
                        disabled={processingTierId === tier.id}
                      >
                      {processingTierId === tier.id ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <>
                          <Ionicons name="chatbubble-ellipses-outline" size={15} color="#000" />
                          <Text style={[styles.planBtnText, { color: '#000' }]}>Upgrade to {tier.name}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.secondaryPlanBtn, { borderColor: color }, processingTierId === tier.id && styles.secondaryPlanBtnDisabled]}
                      onPress={() => handletelebirrSubscribe(tier)}
                      disabled={processingTierId === tier.id}
                    >
                      <Ionicons name="phone-portrait-outline" size={15} color={color} />
                      <Text style={[styles.secondaryPlanBtnText, { color }]}>Pay with telebirr</Text>
                    </TouchableOpacity>
                    </View>
                  );
                }
              })}
            </>
          );
        })()}
      </ScrollView>

      {selectedTierFortelebirr && (
        <TelebirrSubscriptionModal
          visible={telebirrModalVisible}
          onClose={() => settelebirrModalVisible(false)}
          tier={selectedTierFortelebirr}
          onProceedPayment={handletelebirrProceed}
          onPaySms={(t) => {
            settelebirrModalVisible(false);
            handleSubscribe(t || selectedTierFortelebirr);
          }}
          processing={processingTierId === selectedTierFortelebirr.id}
          initialPhone={telebirrPhone}
        />
      )}

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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  benefitsSection: { margin: 16, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: BORDER },
  sectionLabel: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 16 },
  benefitsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  benefitItem: { width: '45%', alignItems: 'center', gap: 8 },
  benefitText: { fontSize: 12, color: '#fff', textAlign: 'center', fontWeight: '600' },
  activeHero: { alignItems: 'center', paddingBottom: 8 },
  activeIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: '#8fc441', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  activeTitle: { fontSize: 22, fontWeight: '900', marginBottom: 6 },
  activeSubtitle: { fontSize: 13, textAlign: 'center', marginBottom: 14 },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, backgroundColor: '#12241A', borderWidth: 1, borderColor: '#1F6B3F', marginBottom: 12 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3DDC84' },
  activePillText: { color: '#3DDC84', fontSize: 14, fontWeight: '800' },
  activeDate: { fontSize: 13, marginBottom: 4 },
  currentSubCard: { margin: 16, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: BORDER },
  currentSubHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  currentSubTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  currentSubDetails: { gap: 8 },
  currentPlanName: { fontSize: 16, fontWeight: '800', color: '#fff' },
  currentPlanDesc: { fontSize: 14, color: '#666', marginBottom: 8 },
  currentPlanPrice: { fontSize: 20, fontWeight: '900', color: GOLD },
  currentPlanExpiry: { fontSize: 12, color: '#666' },
  planCard: { marginHorizontal: 16, marginBottom: 14, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: BORDER },
  planCardCurrent: { borderColor: '#10B98150', backgroundColor: '#0D2D1A18' },
  currentTag: { position: 'absolute', top: -10, right: 16, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  currentTagText: { color: '#000', fontSize: 10, fontWeight: '800' },
  planTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  planIconBox: { width: 46, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  planName: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 2 },
  planDesc: { fontSize: 12, color: '#666' },
  planPriceBox: { alignItems: 'flex-end' },
  planPrice: { fontSize: 24, fontWeight: '900', lineHeight: 26 },
  planCurrency: { fontSize: 11, color: '#666', fontWeight: '600' },
  planFeatures: { gap: 7, marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 13, color: '#fff', fontWeight: '500' },
  planBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 12 },
  planBtnText: { fontWeight: '800', fontSize: 14 },
  secondaryPlanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, borderRadius: 12, borderWidth: 1, marginTop: 10 },
  secondaryPlanBtnDisabled: { opacity: 0.6 },
  secondaryPlanBtnText: { fontWeight: '700', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { borderRadius: 16, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  modalDescription: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  modalPlanText: { fontSize: 14, fontWeight: '700', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalButton: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  modalButtonSecondary: { borderWidth: 1 },
  modalButtonSecondaryText: { fontWeight: '700', fontSize: 14 },
  modalButtonPrimaryText: { color: '#000', fontWeight: '800', fontSize: 14 },
  debugInfo: { marginTop: 8, padding: 4, backgroundColor: '#333', borderRadius: 4 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  cancelBtnText: { color: '#EF4444', fontSize: 14, fontWeight: '700' },
  cancelInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  cancelInfoText: { fontSize: 12, flex: 1, lineHeight: 16 },
});
