import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator,
  Image, Dimensions, Linking, Platform, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import PaymentReceiptModal from '../../components/subscription/PaymentReceiptModal';

const { width } = Dimensions.get('window');

// Coin packages matching the website (fallback used until /wallet/config/ loads)
const PACKAGE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

const COIN_PACKAGES = [
  { id: 1, coins: 100, price: 10, allowsAirtime: true, bonus: 0, popular: false, description: 'Starter Pack', savings: 0, color: PACKAGE_COLORS[0] },
  { id: 2, coins: 250, price: 25, allowsAirtime: false, bonus: 25, popular: false, description: 'Good Value', savings: 0, color: PACKAGE_COLORS[1] },
  { id: 3, coins: 500, price: 50, allowsAirtime: false, bonus: 75, popular: true, description: 'Most Popular', savings: 0, color: PACKAGE_COLORS[2] },
  { id: 4, coins: 1000, price: 100, allowsAirtime: false, bonus: 200, popular: false, description: 'Best Deal', savings: 0, color: PACKAGE_COLORS[3] },
  { id: 5, coins: 2500, price: 250, allowsAirtime: false, bonus: 625, popular: false, description: 'Premium Package', savings: 0, color: PACKAGE_COLORS[4] },
];

export default function WebsiteCoinScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user: authUser } = useAuth();
  const [userCoins, setUserCoins] = useState(0);
  const [coinPackages, setCoinPackages] = useState(COIN_PACKAGES);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [purchasedCoins, setPurchasedCoins] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('airtime');
  
  // New states for custom amount
  const [customAmount, setCustomAmount] = useState('');
  const [isCustomAmount, setIsCustomAmount] = useState(false);
  const [activeTab, setActiveTab] = useState('packages'); // 'custom' or 'packages'

  useEffect(() => {
    loadUserCoins();
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      // Use same endpoint as the website's Buy Coins page
      const response = await api.request('/wallet/config/');
      console.log('Wallet config response:', response);
      // Backend returns { packages: [...] }
      const rawPkgs = response?.packages || [];
      const pkgs = (Array.isArray(rawPkgs) ? rawPkgs : []).map((p, i) => ({
        id: p.id,
        coins: p.coin_amount,
        price: parseFloat(p.price_etb),
        allowsAirtime: p.allows_airtime === true,
        bonus: p.bonus_coins || 0,
        popular: p.is_featured || false,
        description: p.name,
        savings: 0,
        color: PACKAGE_COLORS[i % PACKAGE_COLORS.length],
      }));
      console.log('Loaded packages:', pkgs);
      if (pkgs.length > 0) setCoinPackages(pkgs);
    } catch (e) {
      console.log('Using fallback packages:', e);
    }
  };
  const loadUserCoins = async () => {
    try {
      // Use wallet API to get total coin balance (same as WalletScreen)
      const response = await api.request('/wallet/');
      console.log('Wallet API response for coins:', response);
      
      // Get total balance from wallet data
      const totalCoins = response?.balance?.total ?? response?.total ?? 0;
      console.log('Setting user coins to:', totalCoins);
      
      setUserCoins(totalCoins);
    } catch (error) {
      console.error('Failed to load user coins from wallet:', error);
      
      // Fallback to profile API if wallet fails
      try {
        let response;
        try {
          response = await api.request('/profile/');
        } catch {
          try {
            response = await api.request('/user/profile/');
          } catch {
            response = await api.request('/auth/profile/');
          }
        }
        const coins = response?.coins || 0;
        console.log('Fallback: Setting user coins to:', coins);
        setUserCoins(coins);
      } catch (fallbackError) {
        console.error('All coin loading methods failed:', fallbackError);
        setUserCoins(0);
      }
    }
  };

  const allowsAirtime = (pkg) => pkg?.allowsAirtime === true || Number(pkg?.price) === 10;

  // Function to handle custom amount
  const handleCustomAmount = () => {
    const amount = parseFloat(customAmount);
    if (!amount || amount < 1) {
      Alert.alert('Invalid Amount', 'Please enter an amount of at least 1 Birr');
      return;
    }
    if (amount > 1000) {
      Alert.alert('Invalid Amount', 'Maximum amount is 1000 Birr');
      return;
    }
    
    // Create a custom package for the entered amount
    // Assuming 1 ETB = 10 coins (you can adjust this rate)
    const coinsFromAmount = Math.floor(amount * 10);
    const customPackage = {
      id: 'custom',
      coins: coinsFromAmount,
      price: amount,
      allowsAirtime: amount >= 10, // Allow airtime for amounts >= 10 ETB
      bonus: 0,
      popular: false,
      description: `Custom ${coinsFromAmount} Coins`,
      savings: 0,
      color: '#8fc441',
    };
    
    setSelectedPackage(customPackage);
    setHighlightedId('custom');
    setIsCustomAmount(true);
    setShowPaymentMethodModal(true);
  };

  const handlePackageSelect = (pkg) => {
    setSelectedPackage(pkg);
    setHighlightedId(pkg.id);
    setIsCustomAmount(false);
    setShowPaymentMethodModal(true);
  };

  const handlePaymentMethodSelect = (method) => {
    setPaymentMethod(method);
    setShowPaymentMethodModal(false);
    setShowPaymentModal(true);
  };

  // Called from the receipt confirmation popup's "Proceed" button — no
  // native Alert.alert confirmations, matching the web app's flow of a
  // single receipt-style popup before charging.
  const handleConfirmPurchase = async () => {
    if (!selectedPackage) {
      Alert.alert('Error', 'No package selected. Please try again.');
      return;
    }

    if (paymentMethod === 'airtime') {
      await processAirtimeDirectPayment(selectedPackage);
      setShowPaymentModal(false);
      return;
    }

    if (paymentMethod === 'telebirr') {
      setLoading(true);
      try {
        let userPhoneNumber = authUser?.phone_number || authUser?.phone || authUser?.username || '';
        if (!userPhoneNumber || userPhoneNumber.replace(/\D/g, '').length < 9) {
          try {
            const profile = await api.getProfile();
            userPhoneNumber = profile?.phone_number || profile?.phone || userPhoneNumber;
          } catch (_) {}
        }

        const response = await api.telebirrCoinPurchase({
          packageId: selectedPackage.id,
          amountEtb: selectedPackage.price,
          phoneNumber: userPhoneNumber,
          coins: selectedPackage.coins,
        });

        if (response?.success || response?.mandate_id || response?.originator_conversation_id) {
          setShowPaymentModal(false);
          Alert.alert(
            'Payment Requested',
            'Payment request sent! Please enter your PIN on your phone to complete the purchase.',
            [{
              text: 'OK',
              onPress: () => {
                // Poll for balance update
                let pollCount = 0;
                const pollInterval = setInterval(async () => {
                  pollCount += 1;
                  await loadUserCoins();
                  if (pollCount >= 12) {
                    clearInterval(pollInterval);
                  }
                }, 5000);
              }
            }]
          );
        } else {
          Alert.alert('Payment Failed', response?.error || response?.message || 'Could not initiate payment. Please try again.');
        }
      } catch (error) {
        console.error('telebirr payment error:', error);
        Alert.alert('Error', error?.data?.error || error?.message || 'telebirr payment failed. Please try again.');
      } finally {
        setLoading(false);
      }
    }
  };

  const processAirtimeDirectPayment = async (pkg) => {
    try {
      setLoading(true);
      // Get user's phone number - send as-is like website
      let userPhoneNumber = authUser?.phone_number || authUser?.phone || authUser?.username;
      if (!userPhoneNumber) {
        Alert.alert('Error', 'Phone number not found. Please update your profile.');
        return;
      }

      const purchasedAmount = pkg.coins + (pkg.bonus || 0);
      const response = await api.request('/charging/coin-purchase/', {
        method: 'POST',
        body: JSON.stringify({
          phone_number: userPhoneNumber,
          coins: purchasedAmount,
        }),
      });

      console.log('Airtime coin purchase response:', response);

      if (response.success) {
        setShowPaymentModal(false);
        setPurchasedCoins(purchasedAmount);
        setShowSuccessModal(true);
        loadUserCoins();
      } else {
        Alert.alert('Payment Failed', response.error || response.message || 'Could not complete payment. Please try again.');
      }
      
    } catch (error) {
      console.error('Payment error:', error);
      const errMsg = error?.message || 'Payment failed. Please try again.';
      if (errMsg.includes('insufficient_balance') || errMsg.includes('not enough')) {
        Alert.alert('Insufficient Balance', 'Your airtime balance is not enough. Please recharge and try again.');
      } else if (errMsg.includes('INTERNAL_ERROR') || errMsg.includes('charging_failed')) {
        Alert.alert('Service Unavailable', 'The payment service is temporarily unavailable. Please try again in a few minutes.');
      } else {
        Alert.alert('Payment Failed', errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const getAirtimeSMSCode = (pkg) => {
    // Use the correct SMS codes for airtime payments that work with carrier
    const airtimeCodes = {
      1: 'COIN100',  // 100 coins for 10 ETB
      2: 'COIN250',  // 250 coins for 25 ETB
      3: 'COIN500',  // 500 coins for 50 ETB
      4: 'COIN1000', // 1000 coins for 100 ETB
      5: 'COIN2500'  // 2500 coins for 250 ETB
    };
    return airtimeCodes[pkg.id] || 'COIN100';
  };

  const getSMSCode = (pkg) => {
    const codes = {
      1: 'COIN100',
      2: 'COIN250', 
      3: 'COIN500',
      4: 'COIN1000',
      5: 'COIN2500'
    };
    return codes[pkg.id] || 'COIN100';
  };

  const formatSavings = (savings) => {
    return savings > 0 ? `Save ${savings}%` : '';
  };

  const enteredAmount = parseInt(customAmount, 10) || 0;
  const calculatedCoins = enteredAmount > 0 ? enteredAmount * 10 : 0;
  const isButtonEnabled = enteredAmount >= 1 && enteredAmount <= 1000;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Purchase Coins</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.balanceBar}>
          <View style={styles.balanceBarIcon}>
            <Ionicons name="wallet-outline" size={15} color="#B7E66A" />
          </View>
          <Text style={styles.balanceBarLabel}>YOUR BALANCE</Text>
          <Text style={styles.balanceBarAmount}>{userCoins.toLocaleString()} coins</Text>
        </View>

        {/* Hero Section - Minimized */}
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Ionicons name="wallet" size={20} color="#10140E" />
          </View>
          <Text style={styles.heroTitle}>Buy Coins</Text>
          <Text style={styles.heroSubtitle}>Choose your coin package</Text>
        </View>

        {/* Custom Amount Section */}
        <View style={styles.customSection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="link" size={14} color="#A3E635" />
            <Text style={styles.sectionTitle}>CHOOSE YOUR AMOUNT</Text>
          </View>
          
          <View style={[styles.customAmountContainer, highlightedId === 'custom' && { borderWidth: 2, borderColor: '#8fc441' }]}>
            <Text style={styles.amountLabel}>Amount</Text>

            <View style={styles.amountInputContainer}>
              <TextInput
                style={styles.amountInput}
                placeholder="e.g. 5"
                placeholderTextColor="#5B6854"
                value={customAmount}
                onFocus={() => setHighlightedId('custom')}
                onChangeText={(text) => {
                  const sanitized = text.replace(/[^0-9]/g, '');
                  setCustomAmount(sanitized);
                }}
                keyboardType="numeric"
              />
              <Text style={styles.currencyLabel}>Birr</Text>
            </View>

            <View style={styles.calculationContainer}>
              {enteredAmount > 0 ? (
                <Text style={styles.receiveText}>
                  You will receive <Text style={styles.receiveAmount}>{calculatedCoins.toLocaleString()}</Text> Coins
                </Text>
              ) : (
                <Text style={styles.bonusNote}>
                  1-1000 Birr. Bonus coins come with the packages{'\n'}below.
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.continueButton,
                isButtonEnabled ? styles.continueButtonActive : styles.continueButtonDisabled,
              ]}
              onPress={handleCustomAmount}
              disabled={!isButtonEnabled}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.continueButtonText,
                  isButtonEnabled ? styles.continueButtonTextActive : styles.continueButtonTextDisabled,
                ]}
              >
                Continue to Buy
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Or Pick Package Section - Minimized Cards */}
        <View style={styles.packageSection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="pricetags" size={14} color="#8fc441" />
            <Text style={styles.sectionTitle}>OR PICK A PACKAGE</Text>
          </View>

          {/* Coin Packages */}
          <View style={styles.packagesGrid}>
            {coinPackages.map((pkg) => (
              <TouchableOpacity
                key={pkg.id}
                activeOpacity={0.88}
                onPress={() => handlePackageSelect(pkg)}
                style={[
                  styles.packageCard,
                  { backgroundColor: colors.cardBg, borderColor: (highlightedId ?? coinPackages.find((p) => p.popular)?.id) === pkg.id ? '#8fc441' : '#262626' },
                ]}
              >
                {pkg.popular && (
                  <View style={styles.popularBadge}>
                    <Ionicons name="flame" size={10} color="#10140E" />
                    <Text style={styles.popularText}>POPULAR</Text>
                  </View>
                )}

                <View style={styles.packageCardLeft}>
                  <View style={styles.coinIconCircle}>
                    <Ionicons name="wallet" size={16} color="#10140E" />
                  </View>
                  <View style={styles.packageCoinInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                      <Text style={styles.coinAmount}>{pkg.coins.toLocaleString()}</Text>
                      <Text style={styles.coinLabel}>COINS</Text>
                    </View>
                    {pkg.bonus > 0 ? (
                      <View style={styles.bonusBadge}>
                        <Text style={styles.bonusText}>+{pkg.bonus} bonus</Text>
                      </View>
                    ) : (
                      <Text style={styles.packageDesc} numberOfLines={1}>{pkg.description || 'Starter Pack'}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.packageCardRight}>
                  <View style={styles.packagePrice}>
                    <Text style={styles.priceAmount}>{pkg.price}</Text>
                    <Text style={styles.priceLabel}>ETB</Text>
                  </View>
                  <View style={styles.buyCoinsButton}>
                    <Ionicons name="cart-outline" size={13} color="#000" />
                    <Text style={styles.buyCoinsButtonText}>Buy</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          
          <View style={styles.packageFooter}>
            <Text style={styles.packageFooterText}>Select a package</Text>
            <Text style={styles.packageFooterSubtext}>Tap Buy on any package above to continue</Text>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showPaymentMethodModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPaymentMethodModal(false)}
      >
        <View style={[styles.modalOverlay, { 
          backgroundColor: 'rgba(0,0,0,0.78)',
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
        }]}>
          <View style={[styles.paymentChoiceModal, { backgroundColor: colors.cardBg }]}>
            <TouchableOpacity
              accessibilityLabel="Close payment methods"
              style={styles.paymentCloseButton}
              onPress={() => setShowPaymentMethodModal(false)}
            >
              <Ionicons name="close" size={20} color="#AAB4A3" />
            </TouchableOpacity>

            <View style={styles.paymentChoiceIcon}>
              <Ionicons name="phone-portrait-outline" size={30} color="#10140E" />
            </View>
            <Text style={styles.paymentChoiceEyebrow}>SECURE CHECKOUT</Text>
            <Text
              style={[styles.paymentChoiceTitle, { color: colors.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Choose payment method
            </Text>
            <Text style={styles.paymentChoiceSubtitle}>Complete your coin purchase securely</Text>

            {selectedPackage && (
              <View style={styles.paymentPackageSummary}>
                <View>
                  <Text style={styles.paymentPackageName}>{selectedPackage.description}</Text>
                  <Text style={styles.paymentPackageCoins}>
                    {(selectedPackage.coins + (selectedPackage.bonus || 0)).toLocaleString()} coins
                  </Text>
                </View>
                <Text style={styles.paymentPackagePrice}>{selectedPackage.price} ETB</Text>
              </View>
            )}

            {selectedPackage && allowsAirtime(selectedPackage) && (
              <TouchableOpacity
                style={styles.airtimeButton}
                onPress={() => handlePaymentMethodSelect('airtime')}
              >
                <Ionicons name="phone-portrait-outline" size={21} color="#B7E66A" />
                <View style={styles.paymentButtonCopy}>
                  <Text style={styles.airtimeButtonText}>Pay with Airtime</Text>
                  <Text style={styles.paymentButtonHint}>Charge your registered phone</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#8BD34C" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.telebirrButton}
              onPress={() => handlePaymentMethodSelect('telebirr')}
            >
              <Image 
                source={require('../../../assets/ethio-logo.png')} 
                style={{ width: 28, height: 28, marginRight: 12 }} 
                resizeMode="contain"
              />
              <Text style={styles.telebirrButtonText}>Pay with telebirr</Text>
            </TouchableOpacity>
            <Text style={styles.paymentSecureNote}>You will receive a payment request on your phone</Text>
          </View>
        </View>
      </Modal>

      {/* Payment Receipt Confirmation Popup — matches the web app's Telebirr
          subscription receipt design (plan/amount/date/phone + Proceed). */}
      {selectedPackage && (
        <PaymentReceiptModal
          visible={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          onProceed={handleConfirmPurchase}
          processing={loading}
          title={paymentMethod === 'airtime' ? 'Buy Coins via Airtime' : 'Buy Coins via telebirr'}
          amountLabel={`${selectedPackage.price || 0}.00`}
          rows={[
            { label: 'Package', value: selectedPackage.description || 'Coin Pack' },
            { label: 'Coins', value: `${(selectedPackage.coins || 0) + (selectedPackage.bonus || 0)}` },
            {
              label: 'Date',
              value: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            },
            {
              label: 'Phone Number',
              value: authUser?.phone_number || authUser?.phone || authUser?.username || 'N/A',
            },
          ]}
          proceedLabel={paymentMethod === 'airtime' ? 'Confirm Airtime Payment' : 'Proceed to telebirr'}
        />
      )}

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSuccessModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.successModal, { backgroundColor: colors.cardBg }]}>
            <View style={[styles.successIconCircle, { backgroundColor: '#10B98120' }]}>
              <Ionicons name="checkmark-circle" size={48} color="#10B981" />
            </View>
            <Text style={[styles.successTitle, { color: colors.text }]}>Payment Successful!</Text>
            <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
              {purchasedCoins} coins have been added to your account!
            </Text>
            <TouchableOpacity
              style={[styles.successBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                setShowSuccessModal(false);
                loadUserCoins(); // Refresh balance
              }}
            >
              <Text style={styles.successBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  content: {
    flex: 1,
  },
  heroSection: {
    paddingHorizontal: 16,
    paddingVertical: 30,
    marginHorizontal: 16,
    borderRadius: 20,
    marginBottom: 20,
  },
  coinBalanceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  balanceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  coinIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 36,
  },
  balanceSubtext: {
    fontSize: 14,
    fontWeight: '500',
  },
  addCoinsBtn: {
    padding: 12,
    borderRadius: 20,
  },
  titleSection: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  packagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  packageCard: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    minHeight: 160,
    marginBottom: 16,
    position: 'relative',
  },
  packageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
  },
  coinDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  coinInfo: {
    alignItems: 'flex-start',
  },
  coinAmount: {
    fontSize: 28,
    fontWeight: '800',
  },
  coinLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  priceTag: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  priceAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  packageInfo: {
    marginBottom: 20,
  },
  packageName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  packageDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  featuresList: {
    gap: 8,
    marginBottom: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    fontSize: 14,
    fontWeight: '500',
  },
  purchaseOptions: {
    gap: 12,
  },
  purchaseBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  purchaseBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  paymentMethodInfo: {
    alignItems: 'center',
    padding: 20,
    marginBottom: 20,
  },
  paymentMethodIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  paymentMethodTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  paymentMethodDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmPaymentBtn: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmPaymentBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 8,
  },
  popularText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  balanceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#151A13',
    borderWidth: 1,
    borderColor: '#293325',
  },
  balanceBarIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#26351D',
    marginRight: 8,
  },
  balanceBarLabel: {
    color: '#87917C',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  balanceBarAmount: {
    color: '#B7E66A',
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 'auto',
  },
  packagesGrid: {
    gap: 8,
  },
  packageCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    position: 'relative',
    backgroundColor: '#161616',
    marginBottom: 8,
  },
  popularBadge: {
    position: 'absolute',
    top: -7,
    right: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#8fc441',
  },
  popularText: {
    color: '#10140E',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  packageCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  coinIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8fc441',
  },
  packageCoinInfo: {
    justifyContent: 'center',
  },
  coinAmount: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  coinLabel: {
    color: '#8fc441',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  bonusBadge: {
    marginTop: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: '#12362B',
    borderWidth: 1,
    borderColor: '#17765A',
    alignSelf: 'flex-start',
  },
  bonusText: {
    color: '#47D3A0',
    fontSize: 9,
    fontWeight: '800',
  },
  packageDesc: {
    color: '#888',
    fontSize: 11,
    marginTop: 1,
  },
  packageCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  packagePrice: {
    alignItems: 'flex-end',
  },
  priceAmount: {
    color: '#8fc441',
    fontSize: 16,
    fontWeight: '900',
  },
  priceLabel: {
    color: '#8fc441',
    fontSize: 9,
    fontWeight: '800',
  },
  buyCoinsButton: {
    backgroundColor: '#8fc441',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  buyCoinsButtonText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  packageInfo: {
    alignItems: 'center',
    marginBottom: 12,
  },
  totalCoins: {
    color: '#8BD34C',
    fontSize: 23,
    fontWeight: '900',
  },
  etb: {
    fontSize: 12,
    letterSpacing: 1,
  },
  packageDesc: {
    color: '#9BA693',
    fontSize: 10,
    marginTop: 4,
  },
  purchaseOptions: {
    marginTop: 'auto',
  },
  purchaseBtn: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#20271C',
    borderWidth: 1,
    borderColor: '#293325',
  },
  purchaseBtnText: {
    color: '#B7E66A',
    fontSize: 12,
    fontWeight: '800',
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    right: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#B7E66A',
  },
  popularText: {
    color: '#10140E',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  paymentChoiceModal: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#384832',
    backgroundColor: '#1a1a1a',
  },
  paymentCloseButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222A20',
  },
  paymentChoiceIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B7E66A',
    marginTop: 8,
    marginBottom: 14,
    shadowColor: '#B7E66A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  paymentChoiceEyebrow: {
    color: '#8BD34C',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  paymentChoiceTitle: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 6,
  },
  paymentChoiceSubtitle: {
    color: '#9BA693',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  paymentPackageSummary: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#151A13',
    borderWidth: 1,
    borderColor: '#293325',
    marginBottom: 16,
  },
  paymentPackageName: {
    color: '#E8EFE2',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  paymentPackageCoins: {
    color: '#8C9885',
    fontSize: 12,
  },
  paymentPackagePrice: {
    color: '#B7E66A',
    fontSize: 18,
    fontWeight: '900',
  },
  telebirrButton: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 14,
    backgroundColor: '#B7E66A',
  },
  telebirrButtonText: {
    color: '#10140E',
    fontSize: 15,
    fontWeight: '900',
  },
  airtimeButton: {
    width: '100%',
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    borderRadius: 14,
    backgroundColor: '#20271C',
    borderWidth: 1,
    borderColor: '#506B39',
    marginBottom: 10,
  },
  paymentButtonCopy: {
    flex: 1,
    marginLeft: 10,
  },
  airtimeButtonText: {
    color: '#E8EFE2',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  paymentButtonHint: {
    color: '#8C9885',
    fontSize: 10,
  },
  paymentSecureNote: {
    color: '#788273',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 12,
  },

  // Minimized styles for hero and custom amount
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8fc441',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    fontSize: 12,
    color: '#8fc441',
    fontWeight: '600',
  },

  customSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  packageSection: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#A3E635',
    letterSpacing: 0.8,
  },

  customAmountContainer: {
    backgroundColor: '#121710',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#3F5B22',
  },
  amountLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#BAC7B3',
    textAlign: 'center',
    marginBottom: 10,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#182015',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 50,
  },
  amountInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingVertical: 0,
  },
  currencyLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#768570',
    marginLeft: 8,
  },
  calculationContainer: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  receiveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9EAEA0',
    textAlign: 'center',
  },
  receiveAmount: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  bonusNote: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7D8C76',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 270,
    alignSelf: 'center',
  },
  continueButton: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonActive: {
    backgroundColor: '#8fc441',
  },
  continueButtonDisabled: {
    backgroundColor: '#354725',
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
  continueButtonTextActive: {
    color: '#0D1606',
  },
  continueButtonTextDisabled: {
    color: '#131D0F',
  },

  packageFooter: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
  },
  packageFooterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
    marginBottom: 2,
  },
  packageFooterSubtext: {
    fontSize: 11,
    color: '#666',
  },
});