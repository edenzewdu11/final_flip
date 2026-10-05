import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform,
  StatusBar, Alert, TouchableWithoutFeedback, Keyboard, Linking,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { sanitizeErrorMessage } from '../../utils/errorMessage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 440);

const GREEN = '#8fc441';
const BG_MODAL = '#161618';
const CARD_BG = '#1c1c20';
const BORDER = '#2a2a30';

function formatEthiopianDate() {
  try {
    const d = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return '25 Sept 2026';
  }
}

function maskPhoneNumber(phone) {
  if (!phone) return '2519********';
  const clean = phone.replace(/\D/g, '');
  if (clean.length >= 9) {
    const norm = clean.startsWith('251') ? clean : (clean.startsWith('0') ? '251' + clean.slice(1) : '251' + clean);
    const start = norm.slice(0, 5);
    const end = norm.slice(-3);
    return `${start}****${end}`;
  }
  return phone;
}

function normalizeToFullPhone(phoneDigits) {
  const clean = (phoneDigits || '').replace(/\D/g, '');
  if (clean.startsWith('251')) return clean;
  if (clean.startsWith('0')) return '251' + clean.slice(1);
  return '251' + clean;
}

const ONEVAS_PRODUCTS = {
  daily: {
    product_number: '10000302850',
    application_key: 'UPJG5ZM3X6C9LLDSKKCME4MA86UQRKWV',
  },
  weekly: {
    product_number: '10000302851',
    application_key: 'I6QEX9W5D341NN50QPB0KQ9HW6DH99TQ',
  },
  monthly: {
    product_number: '10000302852',
    application_key: '0Y72TFLJP4ZAQ127K0O43IJSD9QAPTWQ',
  },
};

export default function TelebirrSubscriptionModal({
  visible,
  onClose,
  tier,
  onProceedPayment,
  onPaySms,
  processing = false,
  initialPhone = '',
}) {
  // Step 1: 'method' (Image 1: Choose Payment Method)
  // Step 2: 'input'  (Image 2: Enter Phone Number)
  // Step 3: 'receipt' (Image 3: Receipt + Send code button)
  // Step 4: 'otp'    (Image 4: Receipt + 6 OTP boxes + Verify)
  const [step, setStep] = useState('method');

  // Step 2 Form state
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [focusedInput, setFocusedInput] = useState(null);
  const [stepError, setStepError] = useState('');

  // Step 3 state
  const [sendCodeLoading, setSendCodeLoading] = useState(false);

  // Step 4 OTP state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpFocusedIndex, setOtpFocusedIndex] = useState(0);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [resendTimer, setResendTimer] = useState(46);
  const [authData, setAuthData] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  const otpInputsRef = useRef([]);
  const timerRef = useRef(null);

  // Initialize when modal opens
  useEffect(() => {
    if (visible) {
      setStep('method');
      setIsOtpVerified(false);
      setOtpDigits(['', '', '', '', '', '']);
      setStepError('');
      setOtpError('');
      setSendCodeLoading(false);
      setVerifyingOtp(false);
      setAuthData(null);
      setSessionId(null);
      setResendTimer(46);

      if (initialPhone) {
        let clean = initialPhone.replace(/\D/g, '');
        if (clean.startsWith('251')) clean = clean.slice(3);
        else if (clean.startsWith('0')) clean = clean.slice(1);
        setPhone(clean);
      }
    }
  }, [visible, initialPhone]);

  // Resend Countdown Timer (starts when step === 'otp')
  useEffect(() => {
    if (step === 'otp' && resendTimer > 0) {
      timerRef.current = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step, resendTimer]);

  if (!visible || !tier) return null;

  const planName = tier.name ? (tier.name.toLowerCase().includes('premium') ? tier.name : `${tier.name} Premium`) : 'Daily Premium';
  const planPrice = tier.price_etb || 3;
  const durationLabel = tier.duration_type === 'weekly' ? 'Weekly Amount' : tier.duration_type === 'monthly' ? 'Monthly Amount' : 'Daily Amount';
  const displayPhone = phone.trim();
  const fullPhone = normalizeToFullPhone(displayPhone);

  const isStep1Valid = displayPhone.length >= 9 && username.trim().length >= 2 && pin.length === 6;
  const fullEnteredOtp = otpDigits.join('');

  // Step 1: Pay via SMS Handler
  const handlePayViaSms = () => {
    const tierCode = tier.duration_type === 'daily' ? '1' :
                     tier.duration_type === 'weekly' ? '2' :
                     tier.duration_type === 'monthly' ? '3' : '1';
    const shortCode = tier.short_code || '9286';
    const smsUrl = Platform.OS === 'ios'
      ? `sms:${shortCode}&body=${encodeURIComponent(tierCode)}`
      : `sms:${shortCode}?body=${encodeURIComponent(tierCode)}`;

    Linking.openURL(smsUrl).catch(() => {
      Alert.alert(
        'SMS Subscription',
        `Send "${tierCode}" to ${shortCode} from your Ethio telecom mobile number to subscribe.`
      );
    });

    if (onPaySms) {
      onPaySms(tier);
    } else {
      onClose && onClose();
    }
  };

  // Step 2: Continue button handler
  const handleStep1Continue = () => {
    if (!isStep1Valid) {
      if (displayPhone.length < 9) setStepError('Please enter a valid Ethiopian phone number (9 digits)');
      else if (username.trim().length < 2) setStepError('Username must be at least 2 characters');
      else if (pin.length !== 6) setStepError('PIN must be exactly 6 digits');
      return;
    }
    setStepError('');
    setStep('receipt');
  };

  // Step 3: Send code button handler
  const handleSendCode = async () => {
    setSendCodeLoading(true);
    setStepError('');
    try {
      const raw9 = displayPhone.slice(-9);
      const cleanPhone = '251' + raw9;
      console.log('[Telebirr USSD] Requesting OTP for:', cleanPhone, 'tier:', tier?.id);

      const res = await api.requestChargingOtp(cleanPhone, tier?.id || 1, 'subscription');
      console.log('[Telebirr USSD] Request OTP response:', res);

      const sid = res?.session_id || res?.data?.session_id || res?.id;
      if (sid) {
        setSessionId(sid);
      }

      if (res?.dev_code) {
        const codeStr = String(res.dev_code).slice(0, 6);
        if (codeStr.length === 6) {
          setOtpDigits(codeStr.split(''));
        }
      } else if (res?.code) {
        const codeStr = String(res.code).slice(0, 6);
        if (codeStr.length === 6) {
          setOtpDigits(codeStr.split(''));
        }
      } else if (res?.otp) {
        const codeStr = String(res.otp).slice(0, 6);
        if (codeStr.length === 6) {
          setOtpDigits(codeStr.split(''));
        }
      }

      setResendTimer(46);
      setStep('otp');
    } catch (err) {
      console.error('[Telebirr USSD] Request OTP error:', err);
      const errMsg = err?.data?.error || err?.data?.detail || err?.message || 'Failed to send verification code. Please check your phone number.';
      setStepError(errMsg);
    } finally {
      setSendCodeLoading(false);
    }
  };

  // Step 4: Resend OTP
  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    setOtpError('');
    try {
      const raw9 = displayPhone.slice(-9);
      const cleanPhone = '251' + raw9;
      console.log('[Telebirr USSD] Resending OTP for:', cleanPhone, 'tier:', tier?.id);

      const res = await api.requestChargingOtp(cleanPhone, tier?.id || 1, 'subscription');
      console.log('[Telebirr USSD] Resend OTP response:', res);

      const sid = res?.session_id || res?.data?.session_id || res?.id;
      if (sid) {
        setSessionId(sid);
      }

      if (res?.dev_code) {
        const codeStr = String(res.dev_code).slice(0, 6);
        if (codeStr.length === 6) {
          setOtpDigits(codeStr.split(''));
        }
      } else if (res?.code) {
        const codeStr = String(res.code).slice(0, 6);
        if (codeStr.length === 6) {
          setOtpDigits(codeStr.split(''));
        }
      } else if (res?.otp) {
        const codeStr = String(res.otp).slice(0, 6);
        if (codeStr.length === 6) {
          setOtpDigits(codeStr.split(''));
        }
      }

      setResendTimer(46);
      Alert.alert('Code Sent', `A new verification code was requested for +251 ${raw9}`);
    } catch (err) {
      console.error('[Telebirr USSD] Resend OTP error:', err);
      const errMsg = err?.data?.error || err?.data?.detail || err?.message || 'Failed to resend code';
      setOtpError(errMsg);
    }
  };

  // Step 4: Handle Individual OTP Box Change
  const handleOtpChange = (val, index) => {
    setOtpError('');
    if (val.length > 1) {
      const digits = val.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otpDigits];
      digits.forEach((d, i) => {
        if (i < 6) newOtp[i] = d;
      });
      setOtpDigits(newOtp);
      const nextIdx = Math.min(digits.length - 1, 5);
      setOtpFocusedIndex(nextIdx);
      otpInputsRef.current[nextIdx]?.focus();
      return;
    }

    const cleanChar = val.replace(/\D/g, '');
    const newOtp = [...otpDigits];
    newOtp[index] = cleanChar;
    setOtpDigits(newOtp);

    if (cleanChar && index < 5) {
      setOtpFocusedIndex(index + 1);
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace') {
      if (!otpDigits[index] && index > 0) {
        setOtpFocusedIndex(index - 1);
        otpInputsRef.current[index - 1]?.focus();
      }
    }
  };

  // Step 4: Verify OTP
  const handleVerifyOtp = async () => {
    if (fullEnteredOtp.length !== 6) {
      setOtpError('Please enter all 6 digits');
      return;
    }

    setOtpError('');
    setVerifyingOtp(true);

    try {
      const raw9 = displayPhone.slice(-9);
      const cleanPhone = '251' + raw9;
      console.log('[Telebirr USSD] Verifying OTP:', fullEnteredOtp, 'sessionId:', sessionId, 'phone:', cleanPhone);

      const res = await api.verifyChargingOtp(sessionId, fullEnteredOtp, cleanPhone);
      console.log('[Telebirr USSD] Verify OTP response:', res);

      if (res && res.success !== false && !res.error) {
        if (res.session_id) setSessionId(res.session_id);
        if (res.token) await api.setAuthToken(res.token);
        setAuthData(res);
        setIsOtpVerified(true);
        return;
      }

      const errMsg = res?.error || res?.detail || res?.message || 'Verification failed. Please check the code.';
      setOtpError(errMsg);
    } catch (err) {
      console.error('[Telebirr USSD] Verify OTP error:', err);
      const errMsg = err?.data?.error || err?.data?.detail || err?.message || 'Invalid verification code. Please try again.';
      setOtpError(errMsg);
    } finally {
      setVerifyingOtp(false);
    }
  };

  // Final Action: Proceed to Pay via Telebirr
  const handleFinalProceed = () => {
    if (!isOtpVerified) return;
    onProceedPayment && onProceedPayment({
      phone: fullPhone,
      username: username.trim(),
      pin,
      authData,
      verificationSessionId: sessionId,
    });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.85)" />
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollStyle}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.modalCard}>
            {/* ── STEP 1: CHOOSE PAYMENT METHOD (Image 1) ── */}
            {step === 'method' && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.modalTitle} numberOfLines={1}>Choose Payment Method</Text>
                    <Text style={styles.modalSubtitle}>How would you like to pay?</Text>
                  </View>
                  <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={18} color="#888" />
                  </TouchableOpacity>
                </View>

                {/* Selected Plan Card */}
                <View style={styles.planCard}>
                  <View style={styles.planIconWrap}>
                    <Ionicons name="flash" size={18} color={GREEN} />
                  </View>
                  <View style={styles.planInfo}>
                    <Text style={styles.planName} numberOfLines={1}>{planName}</Text>
                    <Text style={styles.planDesc} numberOfLines={1}>
                      {tier.description || '24-hour access to premium features'}
                    </Text>
                  </View>
                  <View style={styles.planPriceWrap}>
                    <Text style={styles.planPrice}>{planPrice} <Text style={styles.planCurrency}>ETB</Text></Text>
                  </View>
                </View>

                {/* Pay via Telebirr Button */}
                <TouchableOpacity
                  style={styles.payTelebirrBtn}
                  onPress={() => setStep('input')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="trophy-outline" size={20} color="#000000" style={{ marginRight: 8 }} />
                  <Text style={styles.payTelebirrBtnText}>Pay via Telebirr</Text>
                </TouchableOpacity>

                {/* Pay via SMS Button */}
                <TouchableOpacity
                  style={styles.paySmsBtn}
                  onPress={handlePayViaSms}
                  activeOpacity={0.85}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={20} color={GREEN} style={{ marginRight: 8 }} />
                  <Text style={styles.paySmsBtnText}>Pay via SMS</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ── STEP 2: ENTER PHONE NUMBER (Image 2) ── */}
            {step === 'input' && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.modalTitle} numberOfLines={1}>Enter Phone Number</Text>
                    <Text style={styles.modalSubtitle}>We'll send a Telebirr prompt to confirm.</Text>
                  </View>
                  <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={18} color="#888" />
                  </TouchableOpacity>
                </View>

                {/* Selected Plan Card */}
                <View style={styles.planCard}>
                  <View style={styles.planIconWrap}>
                    <Ionicons name="flash" size={18} color={GREEN} />
                  </View>
                  <View style={styles.planInfo}>
                    <Text style={styles.planName} numberOfLines={1}>{planName}</Text>
                    <Text style={styles.planDesc} numberOfLines={1}>
                      {tier.description || '24-hour access to premium features'}
                    </Text>
                  </View>
                  <View style={styles.planPriceWrap}>
                    <Text style={styles.planPrice}>{planPrice} <Text style={styles.planCurrency}>ETB</Text></Text>
                  </View>
                </View>

                {stepError ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{stepError}</Text>
                  </View>
                ) : null}

                {/* Phone Number Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <View style={[styles.inputRow, focusedInput === 'phone' && styles.inputRowFocused]}>
                    <Ionicons name="call-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <Text style={styles.prefixText}>+251</Text>
                    <TextInput
                      style={styles.textInput}
                      value={phone}
                      onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
                      placeholder="9XXXXXXXX"
                      placeholderTextColor="#555"
                      keyboardType="phone-pad"
                      maxLength={9}
                      onFocus={() => setFocusedInput('phone')}
                      onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                  <Text style={styles.helperText}>Example: 944365493</Text>
                </View>

                {/* Username Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Username</Text>
                  <View style={[styles.inputRow, focusedInput === 'username' && styles.inputRowFocused]}>
                    <Ionicons name="person-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={username}
                      onChangeText={setUsername}
                      placeholder="Choose a username"
                      placeholderTextColor="#555"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={() => setFocusedInput('username')}
                      onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                </View>

                {/* PIN Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>PIN</Text>
                  <View style={[styles.inputRow, focusedInput === 'pin' && styles.inputRowFocused]}>
                    <Ionicons name="lock-closed-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={pin}
                      onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit PIN"
                      placeholderTextColor="#555"
                      secureTextEntry
                      keyboardType="number-pad"
                      maxLength={6}
                      onFocus={() => setFocusedInput('pin')}
                      onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                </View>

                {/* Continue Button */}
                <TouchableOpacity
                  style={[styles.continueBtn, isStep1Valid ? styles.continueBtnActive : styles.continueBtnDisabled]}
                  onPress={handleStep1Continue}
                  disabled={!isStep1Valid}
                  activeOpacity={0.85}
                >
                  <Text style={isStep1Valid ? styles.continueBtnTextActive : styles.continueBtnTextDisabled}>
                    Continue
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* ── STEP 3: RECEIPT & SEND CODE (Image 3) ── */}
            {step === 'receipt' && (
              <>
                <View style={styles.stepTopRow}>
                  <TouchableOpacity
                    style={styles.backStepBtn}
                    onPress={() => setStep('input')}
                  >
                    <Ionicons name="chevron-back" size={18} color={GREEN} />
                    <Text style={styles.backStepText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={18} color="#888" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.stepHeaderSubtitle}>
                  Subscribe to FlipStar {planName}
                </Text>

                {/* Big Amount Display */}
                <View style={styles.bigAmountWrap}>
                  <Text style={styles.bigAmount}>{Number(planPrice).toFixed(2)}</Text>
                  <Text style={styles.bigCurrency}>ETB</Text>
                </View>

                {/* Receipt Details Card */}
                <View style={styles.receiptCard}>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Plan</Text>
                    <Text style={styles.receiptValue}>{planName}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>{durationLabel}</Text>
                    <Text style={styles.receiptValue}>{Number(planPrice).toFixed(2)} ETB</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Date</Text>
                    <Text style={styles.receiptValue}>{formatEthiopianDate()}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Phone Number</Text>
                    <Text style={styles.receiptValue}>+251 {displayPhone}</Text>
                  </View>
                </View>

                {/* Verify Phone Number Section */}
                <View style={styles.verifyCard}>
                  <Text style={styles.verifyTitle}>Verify your phone number</Text>
                  <Text style={styles.verifySubtitle}>
                    We'll text you a 6-digit code. Payment starts only after you enter it.
                  </Text>

                  {stepError ? (
                    <Text style={styles.otpErrorText}>{stepError}</Text>
                  ) : null}

                  {/* Send code Button */}
                  <TouchableOpacity
                    style={styles.sendCodeBtn}
                    onPress={handleSendCode}
                    disabled={sendCodeLoading}
                    activeOpacity={0.85}
                  >
                    {sendCodeLoading ? (
                      <ActivityIndicator color="#000000" size="small" />
                    ) : (
                      <Text style={styles.sendCodeBtnText}>Send code</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Bottom Disabled Button */}
                <View style={styles.bottomDisabledBtn}>
                  <Text style={styles.bottomDisabledBtnText}>Verify your number first</Text>
                </View>
              </>
            )}

            {/* ── STEP 4: OTP VERIFICATION & PROCEED (Image 4) ── */}
            {step === 'otp' && (
              <>
                <View style={styles.stepTopRow}>
                  <TouchableOpacity
                    style={styles.backStepBtn}
                    onPress={() => setStep('receipt')}
                  >
                    <Ionicons name="chevron-back" size={18} color={GREEN} />
                    <Text style={styles.backStepText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={18} color="#888" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.stepHeaderSubtitle}>
                  Subscribe to FlipStar {planName}
                </Text>

                {/* Big Amount Display */}
                <View style={styles.bigAmountWrap}>
                  <Text style={styles.bigAmount}>{Number(planPrice).toFixed(2)}</Text>
                  <Text style={styles.bigCurrency}>ETB</Text>
                </View>

                {/* Receipt Details Card */}
                <View style={styles.receiptCard}>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Plan</Text>
                    <Text style={styles.receiptValue}>{planName}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>{durationLabel}</Text>
                    <Text style={styles.receiptValue}>{Number(planPrice).toFixed(2)} ETB</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Date</Text>
                    <Text style={styles.receiptValue}>{formatEthiopianDate()}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Phone Number</Text>
                    <Text style={styles.receiptValue}>+251 {displayPhone}</Text>
                  </View>
                </View>

                {/* Verify Phone Number Section */}
                <View style={styles.verifyCard}>
                  <Text style={styles.verifyTitle}>Verify your phone number</Text>
                  <Text style={styles.verifySubtitle}>
                    Enter the code we sent to {maskPhoneNumber(fullPhone)}.
                  </Text>

                  {/* 6 OTP Individual Boxes */}
                  <View style={styles.otpRow}>
                    {otpDigits.map((digit, index) => {
                      const isFocused = otpFocusedIndex === index;
                      return (
                        <TextInput
                          key={index}
                          ref={(r) => (otpInputsRef.current[index] = r)}
                          style={[
                            styles.otpBox,
                            isFocused && styles.otpBoxFocused,
                            isOtpVerified && styles.otpBoxVerified,
                          ]}
                          value={digit}
                          onChangeText={(val) => handleOtpChange(val, index)}
                          onKeyPress={(e) => handleOtpKeyPress(e, index)}
                          onFocus={() => setOtpFocusedIndex(index)}
                          keyboardType="number-pad"
                          maxLength={1}
                          selectTextOnFocus
                          editable={!isOtpVerified}
                        />
                      );
                    })}
                  </View>

                  {otpError ? (
                    <Text style={styles.otpErrorText}>{sanitizeErrorMessage(otpError)}</Text>
                  ) : null}

                  {/* Action Row: [ Verify ] + Timer */}
                  <View style={styles.verifyActionRow}>
                    <TouchableOpacity
                      style={[
                        styles.verifyBtn,
                        (fullEnteredOtp.length === 6 && !isOtpVerified) ? styles.verifyBtnActive : styles.verifyBtnDisabled,
                        isOtpVerified && styles.verifyBtnSuccess,
                      ]}
                      onPress={handleVerifyOtp}
                      disabled={fullEnteredOtp.length !== 6 || verifyingOtp || isOtpVerified}
                      activeOpacity={0.85}
                    >
                      {verifyingOtp ? (
                        <ActivityIndicator color={fullEnteredOtp.length === 6 ? '#000000' : '#7b944b'} size="small" />
                      ) : isOtpVerified ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="checkmark-circle" size={16} color="#000000" style={{ marginRight: 4 }} />
                          <Text style={styles.verifyBtnTextActive}>Verified</Text>
                        </View>
                      ) : (
                        <Text style={fullEnteredOtp.length === 6 ? styles.verifyBtnTextActive : styles.verifyBtnTextDisabled}>
                          Verify
                        </Text>
                      )}
                    </TouchableOpacity>

                    <View style={styles.resendWrap}>
                      {resendTimer > 0 ? (
                        <Text style={styles.resendTimerText}>Resend in {resendTimer}s</Text>
                      ) : (
                        <TouchableOpacity onPress={handleResendOtp}>
                          <Text style={styles.resendActiveText}>Resend Code</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Helper Note */}
                  <Text style={styles.resendFootnote}>
                    {resendTimer > 0
                      ? `You can ask for a new code in ${resendTimer}s.`
                      : 'Tap Resend Code if you did not receive the SMS.'}
                  </Text>
                </View>

                {/* Bottom Action Button */}
                <TouchableOpacity
                  style={[
                    styles.bottomBtn,
                    isOtpVerified ? styles.bottomBtnActive : styles.bottomBtnDisabled,
                  ]}
                  onPress={handleFinalProceed}
                  disabled={!isOtpVerified || processing}
                  activeOpacity={0.85}
                >
                  {processing ? (
                    <ActivityIndicator color="#000000" />
                  ) : (
                    <Text style={isOtpVerified ? styles.bottomBtnTextActive : styles.bottomBtnTextDisabled}>
                      {isOtpVerified ? 'Proceed to Pay via Telebirr' : 'Verify your number first'}
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Bottom Footnote */}
                <Text style={styles.bottomFootnote}>
                  You'll get a telebirr prompt to approve this payment.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  scrollStyle: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
    width: '100%',
  },
  modalCard: {
    width: CARD_WIDTH,
    maxWidth: '100%',
    backgroundColor: BG_MODAL,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#26262a',
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    width: '100%',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#888888',
    fontSize: 13,
    marginTop: 3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#26262a',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    width: '100%',
  },
  backStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  backStepText: {
    color: GREEN,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 2,
  },
  stepHeaderSubtitle: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 6,
    width: '100%',
  },
  bigAmountWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: 16,
    width: '100%',
  },
  bigAmount: {
    color: '#ffffff',
    fontSize: 38,
    fontWeight: '800',
  },
  bigCurrency: {
    color: GREEN,
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 6,
  },
  planCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    width: '100%',
  },
  planIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#1a2912',
    borderWidth: 1,
    borderColor: '#344e1c',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  planInfo: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  planName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  planDesc: {
    color: '#777777',
    fontSize: 12,
    marginTop: 2,
  },
  planPriceWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
  },
  planPrice: {
    color: GREEN,
    fontSize: 18,
    fontWeight: '800',
  },
  planCurrency: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '700',
  },
  payTelebirrBtn: {
    backgroundColor: GREEN,
    borderRadius: 14,
    height: 52,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  payTelebirrBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  paySmsBtn: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    height: 52,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paySmsBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#381616',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#602020',
    width: '100%',
  },
  errorText: {
    color: '#ff7777',
    fontSize: 12,
  },
  inputGroup: {
    marginBottom: 14,
    width: '100%',
  },
  inputLabel: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputRow: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  inputRowFocused: {
    borderColor: GREEN,
  },
  leftIcon: {
    marginRight: 6,
    flexShrink: 0,
  },
  prefixText: {
    color: GREEN,
    fontSize: 15,
    fontWeight: '700',
    marginRight: 8,
    flexShrink: 0,
  },
  textInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    paddingVertical: 0,
  },
  helperText: {
    color: '#666666',
    fontSize: 12,
    marginTop: 4,
  },
  continueBtn: {
    height: 52,
    width: '100%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  continueBtnActive: {
    backgroundColor: GREEN,
  },
  continueBtnDisabled: {
    backgroundColor: '#252e1b',
  },
  continueBtnTextActive: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  continueBtnTextDisabled: {
    color: '#55683e',
    fontSize: 16,
    fontWeight: '700',
  },
  receiptCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
    width: '100%',
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    width: '100%',
  },
  receiptLabel: {
    color: '#777777',
    fontSize: 14,
  },
  receiptValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#25252b',
    width: '100%',
  },
  verifyCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    width: '100%',
  },
  verifyTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  verifySubtitle: {
    color: '#888888',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 14,
  },
  sendCodeBtn: {
    backgroundColor: GREEN,
    height: 48,
    width: '100%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCodeBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    width: '100%',
  },
  otpBox: {
    width: 40,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: BORDER,
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  otpBoxFocused: {
    borderColor: GREEN,
    borderWidth: 2,
  },
  otpBoxVerified: {
    borderColor: GREEN,
    backgroundColor: '#1a2912',
  },
  otpErrorText: {
    color: '#ff7777',
    fontSize: 12,
    marginBottom: 10,
    textAlign: 'center',
    width: '100%',
  },
  verifyActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  verifyBtn: {
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBtnActive: {
    backgroundColor: GREEN,
  },
  verifyBtnDisabled: {
    backgroundColor: '#3c4a24',
  },
  verifyBtnSuccess: {
    backgroundColor: GREEN,
  },
  verifyBtnTextActive: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  verifyBtnTextDisabled: {
    color: '#7b944b',
    fontSize: 14,
    fontWeight: '700',
  },
  resendWrap: {
    paddingVertical: 6,
  },
  resendTimerText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '600',
  },
  resendActiveText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  resendFootnote: {
    color: '#777777',
    fontSize: 12,
    marginTop: 10,
    width: '100%',
  },
  bottomDisabledBtn: {
    backgroundColor: '#252e1b',
    height: 52,
    width: '100%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomDisabledBtnText: {
    color: '#55683e',
    fontSize: 15,
    fontWeight: '700',
  },
  bottomBtn: {
    height: 52,
    width: '100%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBtnActive: {
    backgroundColor: GREEN,
  },
  bottomBtnDisabled: {
    backgroundColor: '#252e1b',
  },
  bottomBtnTextActive: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  bottomBtnTextDisabled: {
    color: '#55683e',
    fontSize: 15,
    fontWeight: '700',
  },
  bottomFootnote: {
    color: '#777777',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    width: '100%',
  },
});
