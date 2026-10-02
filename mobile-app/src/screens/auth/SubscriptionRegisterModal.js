import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, KeyboardAvoidingView, ScrollView,
  Platform, StatusBar, Image, Alert, TouchableWithoutFeedback,
  Keyboard, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 440);

const GREEN = '#8fc441';
const BG_MODAL = '#161618';
const CARD_BG = '#1c1c20';
const BORDER = '#2a2a30';

function normalizeToFullPhone(phoneDigits) {
  const clean = (phoneDigits || '').replace(/\D/g, '');
  if (clean.startsWith('251')) return clean;
  if (clean.startsWith('0')) return '251' + clean.slice(1);
  return '251' + clean;
}

export default function SubscriptionRegisterModal({
  visible,
  prefillPhone = '',
  prefillOtp = '',
  onSuccess,
  onBackToLogin,
  onClose,
}) {
  const { setUser } = useAuth();

  // Step 1: 'phone' (Image 1: SuperApp Login - Phone Number & Send OTP)
  // Step 2: 'verify' (Image 2: Verify & Set Your PIN)
  const [step, setStep] = useState('phone');

  // Phone input state
  const [phone, setPhone] = useState('');
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [sendOtpLoading, setSendOtpLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [serverMessage, setServerMessage] = useState('');
  const [onevasConfig, setOnevasConfig] = useState(null);

  // Step 2 state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpFocusedIndex, setOtpFocusedIndex] = useState(0);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [pinFocused, setPinFocused] = useState(false);
  const [confirmPinFocused, setConfirmPinFocused] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [resendingOtp, setResendingOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [loginLoading, setLoginLoading] = useState(false);

  const otpInputsRef = useRef([]);
  const timerRef = useRef(null);

  // Initialize modal state on open
  useEffect(() => {
    if (visible) {
      setErrorMsg('');
      setServerMessage('');
      setStep('phone');
      setPin('');
      setConfirmPin('');
      setShowPin(false);
      setShowConfirmPin(false);
      setAgreeTerms(true);
      setSendOtpLoading(false);
      setLoginLoading(false);
      setOnevasConfig(null);

      if (prefillPhone) {
        let clean = prefillPhone.replace(/\D/g, '');
        if (clean.startsWith('251')) clean = clean.slice(3);
        else if (clean.startsWith('0')) clean = clean.slice(1);
        setPhone(clean);
      } else {
        setPhone('');
      }

      if (prefillOtp && prefillOtp.length === 6) {
        setOtpDigits(prefillOtp.split(''));
        setStep('verify');
      } else {
        setOtpDigits(['', '', '', '', '', '']);
      }
    }
  }, [visible, prefillPhone, prefillOtp]);

  // Resend Countdown Timer
  useEffect(() => {
    if (resendTimer > 0) {
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
  }, [resendTimer]);

  if (!visible) return null;

  const displayPhone = phone.trim();
  const fullPhone = normalizeToFullPhone(displayPhone);
  const fullEnteredOtp = otpDigits.join('');

  // Handle Step 1: Send OTP
  const handleSendOtp = async () => {
    if (displayPhone.length < 9) {
      setErrorMsg('Please enter a valid 9-digit Ethiopian phone number');
      return;
    }

    setErrorMsg('');
    setServerMessage('');
    setSendOtpLoading(true);

    const raw9 = displayPhone.slice(-9);
    const localPhone = '0' + raw9;

    try {
      // 1. Check SuperApp subscription status via UAT API
      let subData = null;
      try {
        console.log('📱 [CHECK SUPERAPP SUB REQ]:', { phone: localPhone });
        subData = await api.checkSuperAppSubscription(localPhone);
        console.log('📱 [CHECK SUPERAPP SUB RES]:', JSON.stringify(subData));
        if (subData && subData.has_active_subscription === false) {
          setErrorMsg('No active SuperApp subscription found. Please subscribe first.');
          setSendOtpLoading(false);
          return;
        }
      } catch (checkErr) {
        console.log('📱 [CHECK SUPERAPP SUB SKIPPED/ERR]:', checkErr?.message);
      }

      let res = null;
      let lastErrorDetail = '';

      // 2. Website flow: POST /auth/resend-subscription-otp/ (setup OTP SMS); fall back to send-login-otp
      try {
        console.log('📱 [RESEND SUB OTP REQ]:', { phone: localPhone });
        res = await api.resendSubscriptionOtp(localPhone);
        console.log('📱 [RESEND SUB OTP RES]:', JSON.stringify(res));
      } catch (e) {
        lastErrorDetail = e?.data?.error || e?.data?.message || e?.message || '';
        console.log('📱 [RESEND SUB OTP ERROR]:', lastErrorDetail);
        if (e?.isRateLimited || (typeof lastErrorDetail === 'string' && lastErrorDetail.toLowerCase().includes('wait'))) {
          setErrorMsg(lastErrorDetail || 'Please wait before requesting another OTP');
          setResendTimer(45);
          return;
        }
        try {
          res = await api.sendLoginOtp(localPhone, {
            application_key: subData?.application_key,
            product_number: subData?.product_number,
          });
          console.log('📱 [SEND LOGIN OTP RES]:', JSON.stringify(res));
        } catch (e2) {
          lastErrorDetail = e2?.data?.error || e2?.data?.message || e2?.message || lastErrorDetail;
        }
      }

      // CRITICAL: If no OTP was successfully sent, do NOT move to verify step!
      if (!res) {
        setErrorMsg(lastErrorDetail || 'Failed to send verification code. Please check your phone number and try again.');
        return;
      }

      // Extract code if returned by server (dev_code, code, otp, or from message)
      const devCode =
        res?.dev_code ||
        res?.code ||
        res?.otp ||
        res?.data?.dev_code ||
        res?.data?.code ||
        res?.data?.otp;

      let codeToFill = null;
      if (devCode) {
        codeToFill = String(devCode).replace(/\D/g, '').slice(0, 6);
      } else if (typeof res?.message === 'string') {
        const match = res.message.match(/code(?:\s+is)?[:\s]+(\d{6})/i) || res.message.match(/otp(?:\s+is)?[:\s]+(\d{6})/i);
        if (match && match[1]) {
          codeToFill = match[1];
        }
      }

      if (codeToFill && codeToFill.length === 6) {
        setOtpDigits(codeToFill.split(''));
      }

      const statusMsg = res?.message || `Verification code requested for ${localPhone}`;
      setServerMessage(statusMsg);
      Alert.alert('Verification Code', statusMsg);

      setResendTimer(45);
      setStep('verify');
    } catch (err) {
      const msg = err?.data?.error || err?.message || 'Failed to send verification code. Please try again.';
      setErrorMsg(msg);
    } finally {
      setSendOtpLoading(false);
    }
  };

  // Handle Resend OTP in Step 2
  const handleResendOtp = async () => {
    if (resendTimer > 0 || resendingOtp) return;
    setErrorMsg('');
    setResendingOtp(true);
    try {
      const raw9 = displayPhone.slice(-9);
      const localPhone = '0' + raw9;
      let res = null;
      let lastErrorMsg = '';

      try {
        console.log('📱 [RESEND SUB OTP REQ]:', { phone: localPhone });
        res = await api.resendSubscriptionOtp(localPhone);
        console.log('📱 [RESEND SUB OTP RES]:', JSON.stringify(res));
      } catch (e) {
        lastErrorMsg = e?.data?.error || e?.data?.message || e?.message || '';
        if (e?.isRateLimited || (typeof lastErrorMsg === 'string' && lastErrorMsg.toLowerCase().includes('wait'))) {
          setErrorMsg(lastErrorMsg || 'Please wait before requesting another OTP');
          setResendTimer(45);
          return;
        }
        try {
          res = await api.sendLoginOtp(localPhone);
          console.log('📱 [RESEND LOGIN OTP RES]:', JSON.stringify(res));
        } catch (e2) {
          lastErrorMsg = e2?.data?.error || e2?.data?.message || e2?.message || lastErrorMsg;
        }
      }

      if (!res) {
        throw new Error(lastErrorMsg || 'Failed to resend code');
      }

      const devCode =
        res?.dev_code ||
        res?.code ||
        res?.otp ||
        res?.data?.dev_code ||
        res?.data?.code ||
        res?.data?.otp;

      let codeToFill = null;
      if (devCode) {
        codeToFill = String(devCode).replace(/\D/g, '').slice(0, 6);
      } else if (typeof res?.message === 'string') {
        const match = res.message.match(/code(?:\s+is)?[:\s]+(\d{6})/i) || res.message.match(/otp(?:\s+is)?[:\s]+(\d{6})/i);
        if (match && match[1]) {
          codeToFill = match[1];
        }
      }

      if (codeToFill && codeToFill.length === 6) {
        setOtpDigits(codeToFill.split(''));
      }

      const statusMsg = res?.message || `A new verification code was sent to ${localPhone}`;
      setServerMessage(statusMsg);
      setResendTimer(45);
      Alert.alert('Code Sent', statusMsg);
    } catch (err) {
      setErrorMsg(err?.data?.error || err?.message || 'Failed to resend code');
    } finally {
      setResendingOtp(false);
    }
  };

  // Handle OTP Box Change
  const handleOtpChange = (val, index) => {
    setErrorMsg('');
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

  // Step 2 Validation
  const isOtpComplete = fullEnteredOtp.length === 6;
  const hasPin = pin.length > 0 || confirmPin.length > 0;
  const isPinValid = /^\d{6}$/.test(pin);
  const isConfirmValid = isPinValid && pin === confirmPin;
  const canSubmitLogin = isOtpComplete && agreeTerms && (!hasPin || isConfirmValid);

  // Handle Step 2: Login / Set PIN
  const handleLoginSubmit = async () => {
    if (!isOtpComplete) {
      setErrorMsg('Please enter the 6-digit OTP code');
      return;
    }
    if (hasPin) {
      if (!isPinValid) {
        setErrorMsg('New PIN must be exactly 6 digits');
        return;
      }
      if (pin !== confirmPin) {
        setErrorMsg('PIN and Confirm PIN do not match');
        return;
      }
    }
    if (!agreeTerms) {
      setErrorMsg('Please agree to the Terms and Conditions');
      return;
    }

    setErrorMsg('');
    setLoginLoading(true);

    try {
      const raw9 = displayPhone.slice(-9);
      const localPhone = '0' + raw9;
      const username = `user_${raw9.slice(-6)}`;

      let res = null;
      let lastErr = null;
      const isDone = () => !!(res?.token || res?.user);
      // Each wrong guess counts against the server's 3-attempt limit, so stop once locked out.
      const isLockedOut = (e) => e?.status === 429 || /maximum attempts|throttled/i.test(`${e?.data?.error || ''}${e?.data?.detail || ''}${e?.message || ''}`);
      const attempts = [
        ...(isPinValid ? [() => api.loginWithSubscriptionOtp(localPhone, fullEnteredOtp, username, pin)] : []),
        () => api.verifyTelebirrSubscriptionOtp(localPhone, fullEnteredOtp, username, pin || undefined),
        () => api.loginWithOtp(localPhone, fullEnteredOtp),
        () => api.verifyPhoneOTP(localPhone, fullEnteredOtp),
      ];

      for (const attempt of attempts) {
        try {
          res = await attempt();
          if (isDone()) break;
        } catch (e) {
          lastErr = e;
          if (isLockedOut(e)) break;
        }
      }

      if (!res || (!res.token && !res.user)) {
        throw lastErr || new Error('Invalid OTP code or verification failed');
      }

      if (res?.token) {
        await api.setAuthToken(res.token);
      }
      if (res?.user && setUser) {
        setUser(res.user);
      }

      onSuccess && onSuccess(res);
      handleDismiss();
    } catch (err) {
      const msg = err?.data?.error || err?.message || 'Login failed. Please check your OTP and try again.';
      setErrorMsg(msg);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleDismiss = () => {
    if (onClose) onClose();
    else if (onBackToLogin) onBackToLogin();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleDismiss}>
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
            {/* ── STEP 1: SUPERAPP LOGIN (Image 1) ── */}
            {step === 'phone' && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>SuperApp Login</Text>
                  <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={18} color="#888" />
                  </TouchableOpacity>
                </View>

                {errorMsg ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                {/* Phone Number Input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <View style={[styles.inputRow, phoneFocused && styles.inputRowFocused]}>
                    <Ionicons name="call-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <Text style={styles.prefixText}>+251</Text>
                    <TextInput
                      style={styles.textInput}
                      value={phone}
                      onChangeText={(t) => {
                        let clean = t.replace(/\D/g, '');
                        if (clean.startsWith('251')) clean = clean.slice(3);
                        else if (clean.startsWith('0')) clean = clean.slice(1);
                        setPhone(clean.slice(0, 9));
                      }}
                      placeholder="9XXXXXXXX"
                      placeholderTextColor="#555"
                      keyboardType="phone-pad"
                      maxLength={12}
                      autoFocus
                      onFocus={() => setPhoneFocused(true)}
                      onBlur={() => setPhoneFocused(false)}
                    />
                  </View>
                </View>

                {/* Send OTP Button */}
                <TouchableOpacity
                  style={[styles.primaryBtn, displayPhone.length < 9 && styles.primaryBtnDisabled]}
                  onPress={handleSendOtp}
                  disabled={displayPhone.length < 9 || sendOtpLoading}
                  activeOpacity={0.85}
                >
                  {sendOtpLoading ? (
                    <ActivityIndicator color="#000000" size="small" />
                  ) : (
                    <Text style={displayPhone.length >= 9 ? styles.primaryBtnText : styles.primaryBtnTextDisabled}>
                      Send OTP
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* ── STEP 2: VERIFY & SET YOUR PIN (Image 2) ── */}
            {step === 'verify' && (
              <>
                {/* Close Button top right */}
                <View style={styles.step2TopRow}>
                  <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={18} color="#888" />
                  </TouchableOpacity>
                </View>

                {/* Ethio telecom & FlipStar Logos Banner */}
                <View style={styles.logosBanner}>
                  <View style={styles.logoItem}>
                    <View style={styles.ethioBadge}>
                      <View style={styles.ethioPill} />
                      <Text style={styles.ethioText}>ethio telecom</Text>
                    </View>
                  </View>
                  <View style={styles.logoDivider} />
                  <View style={styles.logoItem}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="flash" size={16} color={GREEN} style={{ marginRight: 4 }} />
                      <Text style={styles.flipstarText}>FLIP<Text style={{ color: GREEN }}>STAR</Text></Text>
                    </View>
                  </View>
                </View>

                {/* Title & Subtitle */}
                <Text style={styles.verifyTitle}>Verify & Set Your PIN</Text>
                <Text style={styles.verifySubtitle}>
                  Enter the code we sent by SMS, then choose a PIN to sign in.{' '}
                  <Text style={styles.phoneHighlight}>+251 {displayPhone}</Text>
                </Text>

                {serverMessage ? (
                  <View style={[
                    styles.infoBadge,
                    serverMessage.toLowerCase().includes('fail') || serverMessage.toLowerCase().includes('error')
                      ? { backgroundColor: '#331a1a', borderColor: '#ff4444' }
                      : { backgroundColor: '#1a2e1a', borderColor: GREEN },
                    { marginBottom: 12 }
                  ]}>
                    <Ionicons
                      name={serverMessage.toLowerCase().includes('fail') || serverMessage.toLowerCase().includes('error') ? 'alert-circle' : 'checkmark-circle'}
                      size={18}
                      color={serverMessage.toLowerCase().includes('fail') || serverMessage.toLowerCase().includes('error') ? '#ff4444' : GREEN}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={[
                      styles.infoBadgeText,
                      serverMessage.toLowerCase().includes('fail') || serverMessage.toLowerCase().includes('error')
                        ? { color: '#ff8888' }
                        : { color: '#c4e488' }
                    ]}>
                      {serverMessage}
                    </Text>
                  </View>
                ) : null}

                {errorMsg ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                {/* Field 1: Phone Number */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone Number *</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="call-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <Text style={styles.readOnlyPhoneText}>+251{displayPhone}</Text>
                  </View>
                </View>

                {/* Field 2: OTP from SMS */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>OTP from SMS *</Text>
                  <View style={styles.otpRow}>
                    {otpDigits.map((digit, index) => {
                      const isFocused = otpFocusedIndex === index;
                      return (
                        <TextInput
                          key={index}
                          ref={(r) => (otpInputsRef.current[index] = r)}
                          style={[styles.otpBox, isFocused && styles.otpBoxFocused, digit ? styles.otpBoxFilled : null]}
                          value={digit}
                          onChangeText={(val) => handleOtpChange(val, index)}
                          onKeyPress={(e) => handleOtpKeyPress(e, index)}
                          onFocus={() => setOtpFocusedIndex(index)}
                          keyboardType="number-pad"
                          maxLength={1}
                          selectTextOnFocus
                        />
                      );
                    })}
                  </View>

                  {/* Resend OTP helper */}
                  <View style={styles.resendRow}>
                    <Text style={styles.resendPrompt}>Didn't get the code? </Text>
                    <TouchableOpacity onPress={handleResendOtp} disabled={resendTimer > 0 || resendingOtp}>
                      <Text style={styles.resendLink}>
                        {resendingOtp
                          ? 'Sending...'
                          : resendTimer > 0
                            ? `Resend in ${resendTimer}s`
                            : 'Resend OTP'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Field 3: Set New PIN */}
                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>Set New PIN</Text>
                    <Text style={styles.labelHint}> 6 digits (optional)</Text>
                  </View>
                  <View style={[styles.inputRow, pinFocused && styles.inputRowFocused]}>
                    <Ionicons name="lock-closed-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={pin}
                      onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      placeholderTextColor="#555"
                      secureTextEntry={!showPin}
                      keyboardType="number-pad"
                      maxLength={6}
                      onFocus={() => setPinFocused(true)}
                      onBlur={() => setPinFocused(false)}
                    />
                    <TouchableOpacity onPress={() => setShowPin(!showPin)} style={{ padding: 4 }}>
                      <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={18} color={GREEN} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Field 4: Confirm PIN */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Confirm PIN{hasPin ? ' *' : ' (optional)'}</Text>
                  <View style={[styles.inputRow, confirmPinFocused && styles.inputRowFocused]}>
                    <Ionicons name="lock-closed-outline" size={18} color={GREEN} style={styles.leftIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={confirmPin}
                      onChangeText={(t) => setConfirmPin(t.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      placeholderTextColor="#555"
                      secureTextEntry={!showConfirmPin}
                      keyboardType="number-pad"
                      maxLength={6}
                      onFocus={() => setConfirmPinFocused(true)}
                      onBlur={() => setConfirmPinFocused(false)}
                    />
                    <TouchableOpacity onPress={() => setShowConfirmPin(!showConfirmPin)} style={{ padding: 4 }}>
                      <Ionicons name={showConfirmPin ? 'eye-off-outline' : 'eye-outline'} size={18} color={GREEN} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Info badge */}
                <View style={styles.infoBadge}>
                  <Ionicons name="information-circle" size={18} color={GREEN} style={{ marginRight: 8 }} />
                  <Text style={styles.infoBadgeText}>Enter the 6-digit code from the SMS</Text>
                </View>

                {/* Login Button */}
                <TouchableOpacity
                  style={[styles.primaryBtn, !canSubmitLogin && styles.primaryBtnDisabled]}
                  onPress={handleLoginSubmit}
                  disabled={!canSubmitLogin || loginLoading}
                  activeOpacity={0.85}
                >
                  {loginLoading ? (
                    <ActivityIndicator color="#000000" size="small" />
                  ) : (
                    <Text style={canSubmitLogin ? styles.primaryBtnText : styles.primaryBtnTextDisabled}>
                      Login
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Terms Checkbox */}
                <TouchableOpacity
                  style={styles.termsRow}
                  onPress={() => setAgreeTerms(!agreeTerms)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.checkbox, agreeTerms && styles.checkboxActive]}>
                    {agreeTerms && <Ionicons name="checkmark" size={14} color="#000000" />}
                  </View>
                  <Text style={styles.termsText}>
                    I agree to the <Text style={styles.termsLink}>Terms and Conditions</Text>
                  </Text>
                </TouchableOpacity>

                {/* Bottom link: Already have an account? Log in */}
                <View style={styles.bottomLinkRow}>
                  <Text style={styles.bottomLinkText}>Already have an account? </Text>
                  <TouchableOpacity onPress={handleDismiss}>
                    <Text style={styles.bottomLinkAction}>Log in</Text>
                  </TouchableOpacity>
                </View>
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
    padding: 22,
    borderWidth: 1,
    borderColor: '#26262a',
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    width: '100%',
  },
  step2TopRow: {
    alignItems: 'flex-end',
    width: '100%',
    marginBottom: 8,
  },
  modalTitle: {
    color: GREEN,
    fontSize: 22,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#26262a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logosBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0c',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#222228',
    marginBottom: 16,
    width: '100%',
  },
  logoItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#2a2a30',
    marginHorizontal: 8,
  },
  ethioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ethioPill: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#0072ce',
    marginRight: 6,
  },
  ethioText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  flipstarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  verifyTitle: {
    color: GREEN,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    width: '100%',
  },
  verifySubtitle: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
    width: '100%',
    lineHeight: 18,
  },
  phoneHighlight: {
    color: '#ffffff',
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#381616',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#602020',
    width: '100%',
  },
  errorText: {
    color: '#ff7777',
    fontSize: 12,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 14,
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  labelHint: {
    color: '#888888',
    fontSize: 13,
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
  readOnlyPhoneText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 6,
  },
  textInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    paddingVertical: 0,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
  otpBoxFilled: {
    borderColor: GREEN,
    backgroundColor: '#1a2912',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    width: '100%',
  },
  resendPrompt: {
    color: '#888888',
    fontSize: 13,
  },
  resendLink: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '700',
  },
  infoBadge: {
    backgroundColor: '#141f12',
    borderWidth: 1,
    borderColor: '#263b1e',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    width: '100%',
  },
  infoBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
  primaryBtn: {
    backgroundColor: GREEN,
    height: 52,
    width: '100%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  primaryBtnDisabled: {
    backgroundColor: '#2e2e34',
  },
  primaryBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryBtnTextDisabled: {
    color: '#777777',
    fontSize: 16,
    fontWeight: '700',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    width: '100%',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#1c1c20',
    borderWidth: 1,
    borderColor: '#44444a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  termsText: {
    color: '#ffffff',
    fontSize: 13,
  },
  termsLink: {
    color: GREEN,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  bottomLinkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    width: '100%',
  },
  bottomLinkText: {
    color: '#888888',
    fontSize: 13,
  },
  bottomLinkAction: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '700',
  },
});
