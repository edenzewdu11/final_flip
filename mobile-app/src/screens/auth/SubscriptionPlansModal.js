import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, KeyboardAvoidingView, ScrollView,
  Platform, StatusBar, Image, Linking, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import PaymentReceiptModal from '../../components/subscription/PaymentReceiptModal';
import TelebirrSubscriptionModal from '../../components/subscription/TelebirrSubscriptionModal';
import api from '../../api';
import { getPlatformText } from '../../utils/platformText';

const GOLD = '#8fc441';
const BG = '#0D0D0D';
const CARD = '#1A1A1A';
const BORDER = '#262626';

const getFallbackTiers = () => [
  {
    id: 1,
    name: 'Daily',
    duration_type: 'daily',
    price_etb: 3,
    price_coins: null,
    description: 'Access for 24 hours',
    features: ['Full access for 24 hours', 'Ad-free experience', 'HD quality videos'],
    short_code: '9286'
  },
  {
    id: 2,
    name: 'Weekly',
    duration_type: 'weekly',
    price_etb: 20,
    price_coins: null,
    description: 'Access for 7 days',
    features: ['Full access for 7 days', 'Ad-free experience', 'HD quality videos'],
    short_code: '9286'
  },
  {
    id: 3,
    name: 'Monthly',
    duration_type: 'monthly',
    price_etb: 70,
    price_coins: null,
    description: 'Access for 30 days',
    features: ['Full access for 30 days', 'Ad-free experience', 'HD quality videos'],
    short_code: '9286'
  },
];

export default function SubscriptionPlansModal({ visible, onClose, onSuccess, user }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [tiers, setTiers] = useState(getFallbackTiers());
  const [loading, setLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState(null);
  const [smsSent, setSmsSent] = useState(false);
  const [pendingTier, setPendingTier] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTier, setPaymentTier] = useState(null);
  const [showtelebirrReceipt, setShowtelebirrReceipt] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('sms');
  const [telebirrProcessing, setTelebirrProcessing] = useState(false);
  const [methodInFlight, setMethodInFlight] = useState('sms'); // 'sms' | 'telebirr'
  const [subIsNewUser, setSubIsNewUser] = useState(false);
  const mandateIdRef = useRef(null);
  const telebirrPhoneRef = useRef('');
  const authDataRef = useRef(null);
  
  const pollRef = useRef(null);
  const POLL_INTERVAL = 5000;
  const MAX_POLLS = 36; // 3 minutes

  useEffect(() => {
    if (visible) {
      loadSubscriptionData();
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const startPolling = (tier) => {
    let count = 0;
    pollRef.current = setInterval(async () => {
      count++;
      setPollCount(count);
      try {
        if (mandateIdRef.current) {
          const s = await api.request(
            `/direct-debit/check-status/?mandate_id=${mandateIdRef.current}`,
            { skipCache: true }
          );
          if (s.subscription_active || s.completed || s.status === 'active') {
            clearInterval(pollRef.current);
            setTelebirrProcessing(false);
            setSubIsNewUser(!!s.is_new_user);
            setConfirmed(true);
            return;
          }
          if (s.status === 'failed') {
            clearInterval(pollRef.current);
            setTelebirrProcessing(false);
            setSmsSent(false);
            setPendingTier(null);
            Alert.alert('Payment failed', 'Your Telebirr payment could not be completed. Please try again.');
            return;
          }
        } else {
          const sub = await api.request('/subscriptions/');
          if (sub && sub.status === 'active') {
            clearInterval(pollRef.current);
            setConfirmed(true);
          }
        }
      } catch {}
      if (count >= MAX_POLLS) {
        clearInterval(pollRef.current);
        setTelebirrProcessing(false);
      }
    }, POLL_INTERVAL);
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setSmsSent(false);
    setPendingTier(null);
    setPollCount(0);
    setConfirmed(false);
    setTelebirrProcessing(false);
    setSubIsNewUser(false);
    mandateIdRef.current = null;
    telebirrPhoneRef.current = '';
    authDataRef.current = null;
  };

  const loadSubscriptionData = async () => {
    try {
      console.log('Using fallback subscription tiers');
    } catch (error) {
      console.error('Error loading subscription data:', error);
    }
  };

  const handleSubscribe = async (tier) => {
    setSelectedTier(tier);
    setPaymentTier(tier);
    setSelectedPaymentMethod('telebirr');
    setShowtelebirrReceipt(true);
  };

  const handlePaymentMethodSelect = (method) => {
    setSelectedPaymentMethod(method);
    if (method === 'telebirr') {
      setShowPaymentModal(false);
      setShowtelebirrReceipt(true);
    } else {
      // SMS payment
      proceedWithSms();
    }
  };

  const handletelebirrProceed = async (paymentData) => {
    const tier = paymentTier || selectedTier;
    const phoneNumber = typeof paymentData === 'object' ? paymentData.phone : paymentData;
    const verificationSessionId = typeof paymentData === 'object' ? paymentData.verificationSessionId : null;
    if (!tier || !phoneNumber) return;

    if (typeof paymentData === 'object' && paymentData.authData) {
      authDataRef.current = paymentData.authData;
    }

    setTelebirrProcessing(true);
    try {
      let resp;
      try {
        // Primary: Initiate Telebirr USSD Push with verification_session_id
        resp = await api.initiateTelebirrUssdPush(tier.id, phoneNumber, verificationSessionId);
      } catch (ussdErr) {
        console.warn('USSD push initiate failed, trying fallback direct debit:', ussdErr);
        try {
          resp = await api.request('/direct-debit/one-off-subscription/', {
            method: 'POST',
            body: JSON.stringify({ tier_id: tier.id, payer_msisdn: phoneNumber }),
          });
        } catch (oneOffErr) {
          const freq = tier.duration_type === 'daily' ? '02' : tier.duration_type === 'weekly' ? '03' : '05';
          resp = await api.request('/direct-debit/create/', {
            method: 'POST',
            body: JSON.stringify({ tier_id: tier.id, payer_msisdn: phoneNumber, frequency: freq }),
          });
        }
      }

      const transactionId = resp?.originator_conversation_id || resp?.conversation_id || resp?.mandate_id || resp?.id;
      if (resp && (resp.success || transactionId)) {
        mandateIdRef.current = transactionId;
        telebirrPhoneRef.current = phoneNumber;
        setMethodInFlight('telebirr');
        setShowtelebirrReceipt(false);
        setPendingTier(tier);
        setSmsSent(true); // reuse the pending/confirmed overlay
        startPolling(tier);
      } else {
        setTelebirrProcessing(false);
        Alert.alert('Payment failed', resp?.error || 'Could not start Telebirr payment. Please try again.');
      }
    } catch (err) {
      setTelebirrProcessing(false);
      Alert.alert('Payment failed', err?.message || 'Could not start Telebirr payment. Please try again.');
    }
  };

  const proceedWithSms = (overrideTier) => {
    setShowPaymentModal(false);
    const tier = overrideTier || paymentTier || selectedTier;
    if (!tier) return;

    const tierCode = tier.duration_type === 'daily' ? '1' :
                     tier.duration_type === 'weekly' ? '2' :
                     tier.duration_type === 'monthly' ? '3' : '1';
    const shortCode = tier.short_code || '9286';
    const smsUrl = Platform.OS === 'ios'
      ? `sms:${shortCode}&body=${encodeURIComponent(tierCode)}`
      : `sms:${shortCode}?body=${encodeURIComponent(tierCode)}`;
    
    // Open SMS app
    Linking.openURL(smsUrl).catch(err => {
      console.error('Failed to open SMS app:', err);
      Alert.alert(
        'SMS Subscription',
        `Send "${tierCode}" to ${shortCode} from your Ethio telecom mobile number to subscribe.`
      );
    });

    setPendingTier(tier);
    setMethodInFlight('sms');
    setSmsSent(true);
    startPolling(tier);
  };

  const getTierIcon = (durationType) => {
    switch (durationType) {
      case 'daily': return 'calendar-outline';
      case 'weekly': return 'flash-outline';
      case 'monthly': return 'ribbon-outline';
      default: return 'ribbon-outline';
    }
  };

  const getTierColor = (durationType) => {
    switch (durationType) {
      case 'daily': return '#C8B56A';
      case 'weekly': return '#C8B56A';
      case 'monthly': return '#C8B56A';
      default: return '#C8B56A';
    }
  };

  if (!visible) return null;

  // Detect if user already has an active subscription
  const activeSubTier = user?.subscription_tier || user?.active_subscription?.tier || null;
  const activeSubStatus = user?.subscription_status || user?.active_subscription?.status || null;
  const isAlreadySubscribed =
    activeSubStatus === 'active' &&
    activeSubTier;

  const visibleTiers = tiers;

  // ── Pending / Confirmed overlay ──
  if (smsSent && pendingTier) {
    const timedOut = pollCount >= MAX_POLLS;
    return (
      <Modal visible animationType="none" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <StatusBar barStyle="light-content" />
          <View style={s.pendingModalOverlay}>
            <View style={s.pendingModalContent}>
              {confirmed ? (
                <>
                  <View style={s.successIcon}>
                    <Text style={{ fontSize: 56 }}>✅</Text>
                  </View>
                  <Text style={s.successTitle}>Subscription Active!</Text>
                  <Text style={s.successSubtitle}>
                    Your <Text style={{ color: '#fff', fontWeight: '700' }}>{pendingTier.name}</Text> plan is now active.
                  </Text>
                  <Text style={s.successDesc}>
                    {user
                      ? 'You can now enjoy all FlipStar features.'
                      : methodInFlight === 'telebirr'
                        ? (subIsNewUser
                          ? "We've sent an OTP via SMS. Complete registration below to log in."
                          : 'Please log in with your phone number and PIN to continue.')
                        : 'Check your SMS for a registration link to complete your account setup.'}
                  </Text>
                  <TouchableOpacity
                    style={s.goldBtn}
                    onPress={() => {
                      const phone = telebirrPhoneRef.current;
                      const auth = authDataRef.current;
                      stopPolling();
                      if (!user && methodInFlight === 'telebirr') {
                        onSuccess && onSuccess({
                          phone,
                          isNewUser: subIsNewUser,
                          token: auth?.token,
                          user: auth?.user,
                        });
                      } else {
                        onSuccess && onSuccess();
                      }
                    }}
                  >
                    <Text style={s.goldBtnText}>
                      {user
                        ? 'Go to FlipStar →'
                        : methodInFlight === 'telebirr'
                          ? (subIsNewUser ? 'Complete Registration →' : 'Log In →')
                          : 'Check SMS →'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : timedOut ? (
                <>
                  <View style={s.pendingIcon}>
                    <Text style={{ fontSize: 56 }}>⏱️</Text>
                  </View>
                  <Text style={s.pendingTitle}>Taking longer than expected</Text>
                  <Text style={s.pendingSubtitle}>
                    {methodInFlight === 'telebirr'
                      ? 'Check your Telebirr app or SMS inbox for a payment prompt from Ethio telecom.'
                      : 'Check your SMS inbox for a confirmation message from Ethiotelecom. Your subscription may still be processing.'}
                  </Text>
                  <TouchableOpacity
                    style={[s.goldBtn, { marginBottom: 12 }]}
                    onPress={() => { stopPolling(); loadSubscriptionData(); }}
                  >
                    <Text style={s.goldBtnText}>Check Again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={stopPolling}
                  >
                    <Text style={s.secondaryBtnText}>Back to Plans</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={s.pendingIcon}>
                    <Text style={{ fontSize: 48 }}>{methodInFlight === 'telebirr' ? '💳' : '📱'}</Text>
                  </View>
                  <Text style={s.pendingTitle}>
                    {methodInFlight === 'telebirr' ? 'Telebirr Prompt Sent!' : 'SMS Sent!'}
                  </Text>
                  <Text style={s.pendingSubtitle}>
                    {methodInFlight === 'telebirr'
                      ? 'Please check your phone and enter your Telebirr PIN to approve the payment.'
                      : <>Waiting for Ethiotelecom to confirm your <Text style={{ color: '#fff', fontWeight: '700' }}>{pendingTier.name}</Text> subscription…</>}
                  </Text>
                  {user && (
                    <Text style={s.pollingText}>
                      Checking every 5 seconds ({Math.max(0, MAX_POLLS - pollCount)} checks remaining)
                    </Text>
                  )}
                  {!user && (
                    <Text style={s.pendingDesc}>
                      {methodInFlight === 'telebirr'
                        ? 'Once approved, your subscription will activate and you will be logged in immediately.'
                        : "Once confirmed, you'll receive an SMS with a link to complete your registration."}
                    </Text>
                  )}
                  
                  {/* Spinner */}
                  <View style={s.spinnerContainer}>
                    <View style={s.spinner} />
                  </View>
                  
                  <View style={s.planInfo}>
                    <Text style={s.planInfoTitle}>Plan selected</Text>
                    <Text style={s.planInfoText}>{pendingTier.name} — {pendingTier.price_etb} ETB</Text>
                    <Text style={s.planInfoSub}>
                      {methodInFlight === 'telebirr'
                        ? `Payment phone: ${telebirrPhoneRef.current || 'telebirr'}`
                        : `SMS sent to: ${pendingTier.short_code || '9286'}`}
                    </Text>
                  </View>
                  
                  {methodInFlight !== 'telebirr' && (
                    <TouchableOpacity
                      style={[s.secondaryBtn, { marginBottom: 8 }]}
                      onPress={() => handleSubscribe(pendingTier)}
                    >
                      <Text style={s.secondaryBtnText}>Resend SMS</Text>
                    </TouchableOpacity>
                  )}
                  
                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={stopPolling}
                  >
                    <Text style={s.secondaryBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  return (
    <>
      {/* Payment Method Selection Modal */}
      <Modal visible={showPaymentModal} animationType="none" transparent onRequestClose={() => setShowPaymentModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <StatusBar barStyle="light-content" />
          <View style={s.paymentOverlay}>
            <View style={s.paymentModal}>
              <TouchableOpacity style={s.pmBackButton} onPress={() => setShowPaymentModal(false)}>
                <Ionicons name="chevron-back" size={24} color={GOLD} />
              </TouchableOpacity>
              <View style={s.pmIconWrap}>
                <View style={s.pmIconCircle}>
                  <Ionicons name="wallet" size={28} color={GOLD} />
                </View>
              </View>
              <Text style={s.paymentTitle}>Choose Payment Method</Text>
              <Text style={s.paymentDesc}>Select how you want to pay for your subscription</Text>
              
              <View style={s.pmPriceRow}>
                <View style={s.pmChip}>
                  <Ionicons name="pricetag" size={14} color={GOLD} />
                  <Text style={s.pmChipText}>{paymentTier?.price_etb} ETB</Text>
                </View>
                <View style={s.pmChip}>
                  <Ionicons name="time" size={14} color={GOLD} />
                  <Text style={s.pmChipText}>{paymentTier?.duration_type}</Text>
                </View>
              </View>
              
              <View style={s.pmDivider} />
              
              {/* SMS Payment Option */}
              <TouchableOpacity
                style={[s.pmMethodBtn, selectedPaymentMethod === 'sms' && { borderColor: GOLD, borderWidth: 2 }]}
                onPress={() => handlePaymentMethodSelect('sms')}
              >
                <View style={[s.pmMethodIcon, { backgroundColor: '#C8B56A20' }]}>
                  <Ionicons name="chatbubble-outline" size={22} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.pmMethodTitle}>SMS Payment</Text>
                  <Text style={s.pmMethodSub}>Pay via Ethiotelecom SMS</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={selectedPaymentMethod === 'sms' ? GOLD : '#666'} />
              </TouchableOpacity>
              
              {/* telebirr Payment Option */}
              <TouchableOpacity
                style={[s.pmMethodBtn, selectedPaymentMethod === 'telebirr' && { borderColor: GOLD, borderWidth: 2 }]}
                onPress={() => handlePaymentMethodSelect('telebirr')}
              >
                <View style={[s.pmMethodIcon, { backgroundColor: '#C8B56A20' }]}>
                  <Ionicons name="card" size={22} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.pmMethodTitle}>telebirr</Text>
                  <Text style={s.pmMethodSub}>Pay via telebirr mobile money</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={selectedPaymentMethod === 'telebirr' ? GOLD : '#666'} />
              </TouchableOpacity>
              
              <TouchableOpacity
                style={s.paymentCancelBtn}
                onPress={() => setShowPaymentModal(false)}
              >
                <Text style={s.paymentCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Telebirr & SMS 4-Step Registration & Subscription Flow (Matching Images 1, 2, 3, 4) */}
      {selectedTier && (
        <TelebirrSubscriptionModal
          visible={showtelebirrReceipt}
          onClose={() => setShowtelebirrReceipt(false)}
          tier={selectedTier}
          onProceedPayment={handletelebirrProceed}
          onPaySms={(t) => {
            setShowtelebirrReceipt(false);
            const activeTier = t || selectedTier;
            setPaymentTier(activeTier);
            proceedWithSms(activeTier);
          }}
          processing={telebirrProcessing}
          initialPhone={user?.profile?.phone_number || user?.phone_number || user?.phone || ''}
        />
      )}

      {/* Main Subscription Plans Modal */}
      <Modal visible animationType="none" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <StatusBar barStyle="light-content" />
          
          <View style={s.modalOverlay}>
            <View style={s.modalContent}>
              
              
              <View style={s.contentContainer}>
              {/* Header with Back Button */}
              <View style={s.topHeader}>
                <TouchableOpacity style={s.topBackButton} onPress={onClose}>
                  <Ionicons name="chevron-back" size={20} color={colors?.primary || '#8fc441'} />
                </TouchableOpacity>
                <Text style={s.headerTitle}>FlipStar Premium</Text>
                <View style={s.placeholder} />
              </View>

              <Text style={s.subtitle}>
                Select a subscription to unlock premium features
              </Text>

              {/* Interactive Subscription Tiers */}
              <View style={s.tiersContainer}>
                {visibleTiers.map((tier) => {
                  const icon = getTierIcon(tier.duration_type);
                  const color = getTierColor(tier.duration_type);
                  const planTitle = tier.name.includes('Premium') ? tier.name : `${tier.name} Premium`;
                  
                  return (
                    <TouchableOpacity
                      key={tier.id}
                      style={[s.tierCard, { borderColor: '#26262c' }]}
                      onPress={() => handleSubscribe(tier)}
                      activeOpacity={0.8}
                    >
                      <View style={[s.iconContainer, { backgroundColor: '#8fc44122', borderColor: '#8fc441' }]}>
                        <Ionicons name={icon} size={22} color="#8fc441" />
                      </View>

                      <View style={s.tierInfo}>
                        <View style={s.tierHeader}>
                          <Text style={s.tierName}>{planTitle}</Text>
                          <View style={[s.durationBadge, { backgroundColor: '#8fc44125' }]}>
                            <Text style={[s.durationText, { color: '#8fc441' }]}>{tier.duration_type}</Text>
                          </View>
                        </View>
                        <Text style={s.tierPrice}>{tier.price_etb} <Text style={{ fontSize: 13, fontWeight: '700' }}>ETB</Text></Text>
                        <Text style={s.tierDescription}>{tier.description}</Text>
                        
                        {/* Features List */}
                        <View style={s.featuresList}>
                          {tier.features?.slice(0, 2).map((feature, index) => (
                            <View key={index} style={s.featureItem}>
                              <Ionicons name="checkmark-circle" size={14} color="#8fc441" />
                              <Text style={s.featureText}>{feature}</Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      <View style={s.tierArrow}>
                        <Ionicons name="chevron-forward" size={20} color="#8fc441" />
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {/* SMS fallback option */}
                <TouchableOpacity
                  style={s.smsOptionBtn}
                  onPress={() => {
                    const defaultTier = visibleTiers[0];
                    setPaymentTier(defaultTier);
                    proceedWithSms();
                  }}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#888" />
                  <Text style={s.smsOptionText}>or Subscribe via SMS (Send 1, 2, or 3 to 9286)</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  modalOverlay: { 
    flex: 1, 
    backgroundColor: '#000000', 
  },
  modalContent: { 
    flex: 1,
    backgroundColor: '#000000', 
    padding: 24, 
    paddingTop: 48,
    paddingBottom: 40, 
    width: '100%',
  },
  logosRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24, 
    borderRadius: 12, 
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  ethioLogo: { width: 100, height: 50 },
  flipstarLogo: { width: 100, height: 50 },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingTop: 2,
  },
  topBackButton: {
    padding: 8,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: GOLD,
    textAlign: 'center',
    flex: 1,
  },
  placeholder: {
    width: 36,
  },
  contentContainer: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: GOLD,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 8,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: GOLD,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  activeBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: GOLD,
    marginBottom: 4,
  },
  activeBannerSub: {
    fontSize: 12,
    color: '#aaa',
    lineHeight: 18,
  },
  tiersContainer: {
    marginBottom: 8,
  },
  tierCard: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: BORDER,
    marginBottom: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
  },
  tierInfo: {
    flex: 1,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  tierName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  durationBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  durationText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tierPrice: {
    fontSize: 18,
    fontWeight: '900',
    color: GOLD,
    marginBottom: 2,
  },
  tierCoinPrice: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 4,
  },
  tierDescription: {
    fontSize: 11,
    color: '#aaa',
    marginBottom: 6,
  },
  featuresList: {
    marginTop: 4,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  featureText: {
    fontSize: 10,
    color: '#ccc',
    marginLeft: 4,
  },
  tierArrow: {
    marginLeft: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 12,
  },
  backButtonText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  smsOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
  },
  smsOptionText: {
    fontSize: 12.5,
    color: '#888',
    fontWeight: '600',
  },
  // Pending/Success states
  successIcon: {
    alignItems: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: GOLD,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 8,
  },
  successDesc: {
    fontSize: 13,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 28,
  },
  pendingIcon: {
    alignItems: 'center',
    marginBottom: 16,
  },
  pendingTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: GOLD,
    textAlign: 'center',
    marginBottom: 8,
  },
  pendingSubtitle: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 4,
  },
  pendingDesc: {
    fontSize: 13,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 20,
  },
  pollingText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  spinnerContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 24,
  },
  spinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#262626',
    borderTopColor: GOLD,
    // Animation would require additional implementation
  },
  planInfo: {
    padding: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    marginBottom: 20,
  },
  planInfoTitle: {
    color: GOLD,
    fontWeight: '700',
    marginBottom: 4,
    fontSize: 13,
  },
  planInfoText: {
    color: '#fff',
    fontSize: 14,
  },
  planInfoSub: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 2,
  },
  goldBtn: { 
    backgroundColor: GOLD, 
    borderRadius: 10, 
    height: 50, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  goldBtnText: { 
    color: '#000', 
    fontSize: 15, 
    fontWeight: '800' 
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '700',
  },
  pendingModalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,1)', 
    justifyContent: 'center',
    alignItems: 'center'
  },
  pendingModalContent: { 
    backgroundColor: '#000000', 
    borderRadius: 18, 
    padding: 28, 
    paddingBottom: 40, 
    maxHeight: '90%',
    minHeight: '80%',
    width: '95%',
    maxWidth: 400
  },
  // Payment Modal — full page style
  paymentOverlay: {
    flex: 1,
    backgroundColor: '#000000',
  },
  paymentModal: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 36,
    justifyContent: 'center',
  },
  pmHandle: { 
    width: 40, 
    height: 4, 
    backgroundColor: '#333', 
    alignSelf: 'center', 
    marginBottom: 20 
  },
  pmBackButton: {
    position: 'absolute',
    top: 48,
    left: 16,
    padding: 8,
    zIndex: 10,
  },
  pmIconWrap: { 
    alignItems: 'center', 
    marginBottom: 16 
  },
  pmIconCircle: { 
    width: 56, 
    height: 56, 
    borderRadius: 28, 
    backgroundColor: '#1E1E1E', 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 2, 
    borderColor: GOLD 
  },
  paymentTitle: {
    fontSize: 22, 
    fontWeight: '900', 
    color: '#fff',
    textAlign: 'center', 
    marginBottom: 6,
  },
  paymentDesc: {
    fontSize: 13, color: '#888', textAlign: 'center',
    marginBottom: 16, lineHeight: 19,
  },
  pmPriceRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20,
  },
  pmChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(200,181,106,0.12)',
    borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
  },
  pmChipText: { fontSize: 13, fontWeight: '700', color: GOLD },
  pmDivider: { height: 1, backgroundColor: '#222', marginBottom: 16 },
  pmMethodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#1E1E1E', borderRadius: 14,
    padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  pmMethodIcon: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
  },
  pmMethodTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  pmMethodSub: { fontSize: 12, color: '#666' },
  paymentCancelBtn: {
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  paymentCancelText: { fontSize: 14, fontWeight: '600', color: '#555' },
  
  // Informational plan card styles
  infoPlanCard: { marginHorizontal: 16, marginBottom: 16, borderRadius: 12, borderWidth: 1, padding: 20 },
  infoPlanHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  planIconContainer: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  infoPlanInfo: { flex: 1 },
  infoPlanName: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  infoPlanPrice: { fontSize: 18, fontWeight: '700' },
  infoPlanDesc: { fontSize: 14, color: '#666', marginBottom: 12 },
  infoFeatures: { gap: 4 },
  infoFeatureText: { fontSize: 13, lineHeight: 18, color: '#666' },
  infoSmsContainer: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', marginTop: 12 },
  infoSmsContent: { marginLeft: 12, flex: 1 },
  infoSmsTitle: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  infoSmsText: { fontSize: 12, lineHeight: 16 },
  footerBox: { margin: 16, padding: 16, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  footerContent: { flex: 1, gap: 4 },
  footerTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  footerText: { fontSize: 13, lineHeight: 18 },
  footerSubtext: { fontSize: 11, lineHeight: 16, opacity: 0.8 },
});
