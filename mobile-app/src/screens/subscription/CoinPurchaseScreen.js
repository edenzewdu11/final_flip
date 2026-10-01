import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, TextInput, Alert, Linking,
  ScrollView, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import SuccessModal from '../../components/common/SuccessModal';
import PaymentReceiptModal from '../../components/subscription/PaymentReceiptModal';

export default function CoinPurchaseScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user: authUser, hasActiveSubscription } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [loadingAirtime, setLoadingAirtime] = useState(false);
  const [loadingtelebirr, setLoadingtelebirr] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultSuccess, setResultSuccess] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptMethod, setReceiptMethod] = useState('airtime');

  // Check subscription before allowing coin purchase
  const requireSubscription = () => {
    if (!hasActiveSubscription) {
      Alert.alert(
        'Subscription Required',
        'You need an active subscription to buy coins. Subscribe now to unlock all features!',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Subscribe', onPress: () => navigation.navigate('Subscription') }
        ]
      );
      return false;
    }
    return true;
  };

  const FALLBACK_PACKAGES = [
    { id: 1, coin_amount: 100, total_coins: 100, price_etb: 10, name: 'Starter Pack', allows_airtime: true },
    { id: 2, coin_amount: 250, total_coins: 275, price_etb: 25, name: 'Good Value', allows_airtime: false },
    { id: 3, coin_amount: 500, total_coins: 575, price_etb: 50, name: 'Most Popular', is_featured: true, allows_airtime: false },
    { id: 4, coin_amount: 1000, total_coins: 1200, price_etb: 100, name: 'Best Deal', allows_airtime: false },
    { id: 5, coin_amount: 2500, total_coins: 3125, price_etb: 250, name: 'Premium Package', allows_airtime: false },
  ];

  const [packages, setPackages] = useState(FALLBACK_PACKAGES);
  const offerPackage = selectedPackage || packages[0];
  const allowsAirtime = Number(offerPackage?.price_etb ?? offerPackage?.price) === 10;

  useEffect(() => {
    loadScreenData();
  }, []);

  useEffect(() => {
    const fallbackPhoneNumber = getRegisteredPhoneNumber();
    if (!phoneNumber && fallbackPhoneNumber) {
      setPhoneNumber(fallbackPhoneNumber);
    }
  }, [authUser]);

  const getRegisteredPhoneNumber = (profile = null) => {
    const resolvedPhoneNumber =
      profile?.phone_number ||
      profile?.phone ||
      authUser?.phone_number ||
      authUser?.phone ||
      authUser?.username ||
      '';

    return typeof resolvedPhoneNumber === 'string' ? resolvedPhoneNumber.trim() : '';
  };

  const loadScreenData = async () => {
    await Promise.all([loadUserPhone(), loadCoinPackages()]);
  };

  const loadUserPhone = async () => {
    try {
      const profile = await api.request('/profile/me/');
      const resolvedPhoneNumber = getRegisteredPhoneNumber(profile);
      if (resolvedPhoneNumber) {
        setPhoneNumber(resolvedPhoneNumber);
      }
    } catch (error) {
      console.error('[CoinPurchase] Failed to fetch phone number:', error);
      const fallbackPhoneNumber = getRegisteredPhoneNumber();
      if (fallbackPhoneNumber) {
        setPhoneNumber(fallbackPhoneNumber);
      }
    }
  };

  const loadCoinPackages = async () => {
    try {
      const response = await api.request('/wallet/config/');
      const fetchedPackages = Array.isArray(response?.packages)
        ? response.packages
        : [];

      if (fetchedPackages.length === 0) {
        const fallbackResponse = await api.request('/coins/packages/');
        const fallbackPackages = Array.isArray(fallbackResponse)
          ? fallbackResponse
          : Array.isArray(fallbackResponse?.packages)
            ? fallbackResponse.packages
            : [];

        if (fallbackPackages.length === 0) return;

        setPackages(fallbackPackages);
        setSelectedPackage(fallbackPackages.find((pkg) => pkg.is_featured) || fallbackPackages[0]);
        return;
      }

      setPackages(fetchedPackages);
      setSelectedPackage(fetchedPackages.find((pkg) => pkg.is_featured) || fetchedPackages[0]);
    } catch (error) {
      console.error('[CoinPurchase] Failed to fetch coin packages:', error);
    }
  };

  const handleAirtimePurchase = async () => {
    if (!allowsAirtime) {
      setResultSuccess(false);
      setResultMessage('Airtime payment is available only for the 10 ETB Starter Pack.');
      setShowResultModal(true);
      return;
    }

    if (!requireSubscription()) return;

    const purchasePhoneNumber = getRegisteredPhoneNumber() || phoneNumber;
    if (!purchasePhoneNumber) {
      setResultSuccess(false);
      setResultMessage('Please enter your phone number');
      setShowResultModal(true);
      return;
    }

    if (purchasePhoneNumber !== phoneNumber) {
      setPhoneNumber(purchasePhoneNumber);
    }

    setLoadingAirtime(true);
    try {
      const purchaseCoins = offerPackage.total_coins || offerPackage.coin_amount;
      const response = await api.request('/charging/coin-purchase/', {
        method: 'POST',
        body: JSON.stringify({
          phone_number: purchasePhoneNumber,
          coins: purchaseCoins,
        }),
      });

      if (response.success) {
        setResultSuccess(true);
        setResultMessage(response.message);
        setShowResultModal(true);
        setTimeout(() => {
          setShowResultModal(false);
          navigation.goBack();
        }, 2000);
      } else {
        setResultSuccess(false);
        // Map error messages to user-friendly text
        let errorMessage = response.message || response.error || 'Purchase failed';
        if (errorMessage === 'NO_BALANCE' || response.error === 'charging_failed') {
          errorMessage = 'You have insufficient balance';
        }
        setResultMessage(errorMessage);
        setShowResultModal(true);
      }
    } catch (error) {
      console.error('airtime coin purchase error:', error);
      console.error('error.message:', error.message);
      console.error('error.response:', error.response);
      setResultSuccess(false);
      let errorMessage = 'Purchase failed. Please try again.';
      
      // Parse the error message to extract NO_BALANCE
      if (error.message && error.message.includes('NO_BALANCE')) {
        errorMessage = 'You have insufficient balance';
      } else if (error.message && error.message.includes('charging_failed')) {
        errorMessage = 'You have insufficient balance';
      } else if (error.response && error.response.data && error.response.data.message === 'NO_BALANCE') {
        errorMessage = 'You have insufficient balance';
      }
      
      setResultMessage(errorMessage);
      setShowResultModal(true);
    } finally {
      setLoadingAirtime(false);
    }
  };

  const handletelebirrPurchase = async () => {
    if (!requireSubscription()) return;

    // ========================================
    // MOBILE APP USSD PUSH FLOW (MOBILE APP ONLY)
    // ========================================
    // Mobile app is standalone (NOT in SuperApp webview)
    // Uses Telebirr USSD Push (BuyGoodsForCustomer) for one-off payments
    // Matches the website's implementation in frontend/App.jsx
    const purchasePhoneNumber = getRegisteredPhoneNumber() || phoneNumber;

    // Log to backend
    try {
      await api.request('/client-log/', {
        method: 'POST',
        body: JSON.stringify({
          level: 'info',
          message: '[CoinPurchaseScreen] MOBILE APP: Starting USSD Push flow',
          data: { phone_number: purchasePhoneNumber },
        }),
      });
    } catch (logError) {
      // Ignore log errors
    }

    if (!purchasePhoneNumber) {
      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'error',
            message: '[CoinPurchaseScreen] MOBILE APP: No phone number available',
          }),
        });
      } catch (logError) {}
      setResultSuccess(false);
      setResultMessage('Please enter your phone number');
      setShowResultModal(true);
      return;
    }

    if (purchasePhoneNumber !== phoneNumber) {
      setPhoneNumber(purchasePhoneNumber);
      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'info',
            message: '[CoinPurchaseScreen] MOBILE APP: Updated phone number',
            data: { phone_number: purchasePhoneNumber },
          }),
        });
      } catch (logError) {}
    }

    setLoadingtelebirr(true);
    try {
      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'info',
            message: '[CoinPurchaseScreen] MOBILE APP: Initiating USSD Push payment',
            data: { package: offerPackage },
          }),
        });
      } catch (logError) {}

      // Call USSD Push payment endpoint (matches website implementation)
      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'info',
            message: '[CoinPurchaseScreen] MOBILE APP: Calling /wallet/telebirrUssdPurchase/ endpoint',
          }),
        });
      } catch (logError) {}

      const response = await api.telebirrCoinPurchase({
        packageId: offerPackage.id,
        amountEtb: offerPackage.price,
        phoneNumber: purchasePhoneNumber,
        coins: offerPackage.total_coins || offerPackage.coin_amount,
      });

      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'info',
            message: '[CoinPurchaseScreen] MOBILE APP: USSD Push response received',
            data: { full_response: response },
          }),
        });
      } catch (logError) {}

      if (response.success || response.mandate_id || response.originator_conversation_id) {
        try {
          await api.request('/client-log/', {
            method: 'POST',
            body: JSON.stringify({
              level: 'info',
              message: '[CoinPurchaseScreen] MOBILE APP: Payment request accepted',
              data: {
                originator_conversation_id: response.originator_conversation_id,
                conversation_id: response.conversation_id,
              },
            }),
          });
        } catch (logError) {}

        setResultSuccess(true);
        setResultMessage('Payment request sent! Please enter your PIN on your phone to complete the purchase.');
        setSuccessMessage('Payment request sent! Please enter your PIN on your phone to complete the purchase.');
        setShowSuccessModal(true);
        setTimeout(() => {
          setShowSuccessModal(false);
          navigation.goBack();
        }, 3000);
      } else {
        try {
          await api.request('/client-log/', {
            method: 'POST',
            body: JSON.stringify({
              level: 'error',
              message: '[CoinPurchaseScreen] MOBILE APP: Payment request failed',
              data: { error: response.error, full_response: response },
            }),
          });
        } catch (logError) {}

        setResultSuccess(false);
        setResultMessage(response.error || 'Payment request failed. Please try again.');
        setShowResultModal(true);
      }
    } catch (error) {
      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'error',
            message: '[CoinPurchaseScreen] MOBILE APP: USSD Push payment exception',
            data: { error: error.message, error_stack: error.stack },
          }),
        });
      } catch (logError) {}

      setResultSuccess(false);
      setResultMessage('Payment request failed. Please try again.');
      setShowResultModal(true);
    } finally {
      setLoadingtelebirr(false);
      try {
        await api.request('/client-log/', {
          method: 'POST',
          body: JSON.stringify({
            level: 'info',
            message: '[CoinPurchaseScreen] MOBILE APP: USSD Push flow completed, loading state reset',
          }),
        });
      } catch (logError) {}
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Buy Coins</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}>
        {/* Coin Offer Card — shows the currently selected package */}
        <View style={[styles.offerCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <View style={styles.offerContent}>
            <View style={[styles.coinIcon, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="wallet" size={32} color={colors.primary} />
            </View>
            <View style={styles.offerText}>
              <Text style={[styles.coinAmount, { color: colors.text }]}>{offerPackage.total_coins || offerPackage.coin_amount} Coins</Text>
              <Text style={[styles.offerPrice, { color: colors.textSecondary }]}>for {offerPackage.price_etb} ETB</Text>
              <Text style={[styles.offerSubtitle, { color: colors.textSecondary }]}>{offerPackage.name}</Text>
            </View>
          </View>
        </View>

        {/* Package Selector — lets the user choose from all available packages */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Choose a package</Text>
        <View style={styles.packageList}>
          {packages.map((pkg) => {
            const isSelected = offerPackage?.id === pkg.id;
            const totalCoins = pkg.total_coins || pkg.coin_amount;
            const bonusCoins = totalCoins - pkg.coin_amount;
            return (
              <View
                key={pkg.id}
                style={[
                  styles.packageOption,
                  {
                    backgroundColor: colors.cardBg,
                    borderColor: isSelected ? colors.primary : colors.border,
                    borderWidth: isSelected ? 2 : 1,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.pkgOptionHeader}
                  onPress={() => setSelectedPackage(pkg)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.pkgOptionName, { color: colors.text }]}>{pkg.name}</Text>
                      {pkg.is_featured && (
                        <View style={[styles.pkgBadge, { backgroundColor: colors.primary }]}>
                          <Text style={styles.pkgBadgeText}>POPULAR</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.pkgOptionCoins, { color: colors.textSecondary }]}>
                      {pkg.coin_amount.toLocaleString()} coins{bonusCoins > 0 ? ` +${bonusCoins} bonus` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.pkgOptionPrice, { color: colors.primary }]}>{pkg.price_etb} ETB</Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={{ marginLeft: 8 }} />
                  )}
                </TouchableOpacity>

                {/* Buy Coins button after each package */}
                <TouchableOpacity
                  style={[styles.pkgBuyBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    setSelectedPackage(pkg);
                    setShowReceiptModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cart-outline" size={16} color="#000" />
                  <Text style={styles.pkgBuyBtnText}>Buy Coins</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Phone Input (locked to registered number) */}
        <View style={styles.inputContainer}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Phone Number</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.cardBg, borderColor: colors.border, color: colors.text, opacity: 0.85 }]}
            value={phoneNumber}
            editable={false}
            placeholder="+251 9xx xxx xxx"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
          />
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6 }}>
            Charges go to your registered phone number.
          </Text>
        </View>

        {/* Payment Buttons */}
        <View style={styles.buttonContainer}>
          {allowsAirtime && (
            <TouchableOpacity
              style={[styles.paymentButton, { backgroundColor: colors.primary }]}
              onPress={() => { setReceiptMethod('airtime'); setShowReceiptModal(true); }}
              disabled={loadingAirtime || loadingtelebirr}
            >
              {loadingAirtime ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <>
                  <Ionicons name="phone-portrait-outline" size={18} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.buttonText}>From Airtime</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.paymentButton, { backgroundColor: colors.primary }]}
            onPress={() => { setReceiptMethod('telebirr'); setShowReceiptModal(true); }}
            disabled={loadingAirtime || loadingtelebirr}
          >
            {loadingtelebirr ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Image 
                  source={require('../../../assets/ethio-logo.png')} 
                  style={{ width: 26, height: 26, marginRight: 8 }} 
                  resizeMode="contain"
                />
                <Text style={styles.buttonText}>Pay with telebirr</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Payment Receipt Confirmation Popup — matches the web app's white/light
          Telebirr receipt design (title, big amount, details card, Proceed). */}
      <PaymentReceiptModal
        visible={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        onProceed={() => {
          setShowReceiptModal(false);
          if (receiptMethod === 'airtime') handleAirtimePurchase();
          else handletelebirrPurchase();
        }}
        processing={receiptMethod === 'airtime' ? loadingAirtime : loadingtelebirr}
        title={receiptMethod === 'airtime' ? 'Buy Coins via Airtime' : 'Buy Coins via telebirr'}
        amountLabel={`${offerPackage.price_etb || 0}.00`}
        rows={[
          { label: 'Package', value: offerPackage.name || 'Coin Pack' },
          { label: 'Coins', value: `${(offerPackage.total_coins || offerPackage.coin_amount || 0)}` },
          {
            label: 'Date',
            value: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          },
          {
            label: 'Phone Number',
            value: getRegisteredPhoneNumber() || phoneNumber || 'N/A',
          },
        ]}
        proceedLabel={receiptMethod === 'airtime' ? 'Confirm Airtime Payment' : 'Proceed to telebirr'}
      />

      {/* Result Modal */}
      <Modal
        visible={showResultModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowResultModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModal, { backgroundColor: colors.cardBg }]}>
            <View style={[styles.resultIcon, { backgroundColor: resultSuccess ? '#10B981' : '#EF4444' }]}>
              <Ionicons
                name={resultSuccess ? 'checkmark-circle' : 'close-circle'}
                size={32}
                color="#fff"
              />
            </View>
            <Text style={[styles.resultTitle, { color: colors.text }]}>
              {resultSuccess ? 'Success' : 'Error'}
            </Text>
            <Text style={[styles.resultMessage, { color: colors.textSecondary }]}>
              {resultMessage}
            </Text>
            <TouchableOpacity
              style={[styles.okButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowResultModal(false)}
            >
              <Text style={styles.buttonText}>OK</Text>
            </TouchableOpacity>
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
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  offerCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  offerContent: {
    alignItems: 'center',
    gap: 16,
  },
  coinIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offerText: {
    alignItems: 'center',
  },
  offerSubtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  coinAmount: {
    fontSize: 32,
    fontWeight: '700',
  },
  offerPrice: {
    fontSize: 16,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginHorizontal: 16,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  packageList: {
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 10,
  },
  packageOption: {
    padding: 14,
    borderRadius: 14,
    gap: 12,
  },
  pkgOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pkgOptionName: {
    fontSize: 15,
    fontWeight: '700',
  },
  pkgOptionCoins: {
    fontSize: 12,
    marginTop: 2,
  },
  pkgOptionPrice: {
    fontSize: 16,
    fontWeight: '800',
    marginLeft: 8,
  },
  pkgBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pkgBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
  },
  pkgBuyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    width: '100%',
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  pkgBuyBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  inputContainer: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
  },
  buttonContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  paymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  resultModal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  resultIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  resultMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  okButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
});
