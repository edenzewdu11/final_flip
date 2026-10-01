import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { useTheme } from '../../contexts/ThemeContext';

const GOLD = '#8fc441';
const CARD = '#1A1A1A';
const BORDER = '#262626';

export default function ForgotPasswordPhone({ onClose, onSuccess }) {
  const { colors } = useTheme();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [devCode, setDevCode] = useState('');
  
  // Animation values
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Animate on step change
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start();
  }, [step]);

  // Success animation
  useEffect(() => {
    if (step === 3) {
      // Scale animation for the success icon
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.2,
          useNativeDriver: true,
          tension: 100,
          friction: 3,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 5,
        }),
      ]).start();

      // Check mark animation
      Animated.spring(checkScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 3,
        delay: 200,
      }).start();

      // Fade in text
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        delay: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [step]);

  const sendCode = async () => {
    setError(''); setMsg(''); setDevCode('');
    if (!phone) { setError('Enter your phone number'); return; }
    const cleanPhone = phone.replace(/[^\d]/g, '');
    if (cleanPhone.length === 0) { setError('Phone number must contain only numbers'); return; }
    if (cleanPhone.length !== 10) { setError('Phone number must be exactly 10 digits'); return; }
    if (!/^\d+$/.test(phone)) { setError('Phone number must contain only numbers'); return; }
    setLoading(true);
    try {
      const data = await api.forgotPasswordPhoneRequest(phone);
      setMsg('Reset code sent via SMS!');
      if (data.dev_code) {
        setDevCode(data.dev_code);
        setMsg(`Reset code sent! Dev code: ${data.dev_code}`);
      }
      setStep(2);
    } catch (e) {
      const err = e?.message || 'Failed to send code';
      setError(err);
    } finally { setLoading(false); }
  };

  const confirmReset = async () => {
    setError(''); setMsg('');
    if (code.length !== 6) { setError('Enter the 6-digit code'); return; }
    if (!/^\d{6}$/.test(pwd)) { setError('New PIN must be exactly 6 digits'); return; }
    if (pwd !== confirm) { setError('PINs do not match'); return; }
    setLoading(true);
    try {
      await api.forgotPasswordPhoneVerify(phone, code, pwd);
      setStep(3);
    } catch (e) {
      const err = e?.message || 'Invalid or expired code';
      setError(err);
    } finally { setLoading(false); }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={s.modalOverlay}>
          <ScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.modalSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>
                  {step === 1 ? 'Forgot PIN' : step === 2 ? 'Verify & Reset' : 'Success!'}
                </Text>
                <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              {!!error && (
                <View style={s.errorBox}>
                  <Ionicons name="alert-circle" size={20} color="#EF4444" style={{ marginRight: 8 }} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              )}
              {!!msg && (
                <View style={s.successBox}>
                  <Ionicons name="checkmark-circle" size={20} color="#22C55E" style={{ marginRight: 8 }} />
                  <Text style={s.successText}>{msg}</Text>
                </View>
              )}

          {step === 1 && (
            <>
              <Text style={s.modalDesc}>Enter your registered phone number to receive a verification code.</Text>
              <View style={[s.inputRow, { marginBottom: 24 }]}>
                <View style={s.iconWrapper}>
                  <Ionicons name="call" size={20} color={GOLD} />
                </View>
                <TextInput
                  style={s.textInput}
                  placeholder="09XXXXXXXX"
                  placeholderTextColor="#666"
                  value={phone}
                  onChangeText={t => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  maxLength={10}
                />
              </View>
              <TouchableOpacity 
                style={[s.goldBtn, loading && s.goldBtnDisabled]} 
                onPress={sendCode} 
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    <Text style={s.goldBtnText}>Send Verification Code</Text>
                    <Ionicons name="arrow-forward" size={20} color="#000" style={{ marginLeft: 8 }} />
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.modalDesc}>
                Enter the 6-digit code sent to{' '}
                <Text style={{ color: GOLD, fontWeight: '700' }}>{phone}</Text>
              </Text>
              
              <View style={[s.inputRow, { marginBottom: 16 }]}>
                <View style={s.iconWrapper}>
                  <Ionicons name="mail" size={20} color={GOLD} />
                </View>
                <TextInput
                  style={s.textInput}
                  placeholder="6-digit code"
                  placeholderTextColor="#666"
                  value={code}
                  onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>

              <View style={[s.inputRow, { marginBottom: 16 }]}>
                <View style={s.iconWrapper}>
                  <Ionicons name="lock-closed" size={20} color={GOLD} />
                </View>
                <TextInput
                  style={[s.textInput, { flex: 1 }]}
                  placeholder="New 6-digit PIN"
                  placeholderTextColor="#666"
                  value={pwd}
                  onChangeText={t => setPwd(t.replace(/\D/g, '').slice(0, 6))}
                  secureTextEntry={!showPwd}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TouchableOpacity onPress={() => setShowPwd(v => !v)} style={s.eyeBtn}>
                  <Ionicons name={showPwd ? 'eye-off' : 'eye'} size={20} color="#666" />
                </TouchableOpacity>
              </View>

              <View style={[s.inputRow, { marginBottom: 24 }]}>
                <View style={s.iconWrapper}>
                  <Ionicons name="shield-checkmark" size={20} color={GOLD} />
                </View>
                <TextInput
                  style={[s.textInput, { flex: 1 }]}
                  placeholder="Confirm new PIN"
                  placeholderTextColor="#666"
                  value={confirm}
                  onChangeText={t => setConfirm(t.replace(/\D/g, '').slice(0, 6))}
                  secureTextEntry={!showConfirm}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={s.eyeBtn}>
                  <Ionicons name={showConfirm ? 'eye-off' : 'eye'} size={20} color="#666" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity 
                style={[s.goldBtn, loading && s.goldBtnDisabled]} 
                onPress={confirmReset} 
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    <Text style={s.goldBtnText}>Reset PIN</Text>
                    <Ionicons name="checkmark" size={20} color="#000" style={{ marginLeft: 8 }} />
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => { setStep(1); setCode(''); setError(''); setMsg(''); setDevCode(''); }} 
                style={s.backBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={16} color={GOLD} />
                <Text style={s.backBtnText}>Change Phone Number</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 3 && (
            <View style={s.successContainer}>
              <Animated.View style={[s.successIconContainer, { transform: [{ scale: scaleAnim }] }]}>
                <View style={s.successIconBg}>
                  <Ionicons name="checkmark" size={60} color="#fff" />
                </View>
              </Animated.View>

              <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
                <Text style={s.successTitle}>PIN Reset!</Text>
                <Text style={s.successMessage}>
                  Your PIN has been successfully reset.{'\n'}
                  You can now log in with your new PIN.
                </Text>
              </Animated.View>

              <TouchableOpacity 
                style={s.goldBtn} 
                onPress={() => { onClose(); onSuccess && onSuccess(); }}
                activeOpacity={0.8}
              >
                <Text style={s.goldBtnText}>Go to Login</Text>
                <Ionicons name="arrow-forward" size={20} color="#000" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            </View>
          )}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.95)', 
    justifyContent: 'flex-end' 
  },
  modalSheet: { 
    backgroundColor: '#1a1a1a', 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    padding: 24, 
    paddingBottom: 40, 
    maxHeight: '88%',
    shadowColor: '#8fc441',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(143, 196, 65, 0.1)',
  },
  modalTitle: { 
    fontSize: 24, 
    fontWeight: '800', 
    color: '#fff',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDesc: { 
    fontSize: 14, 
    color: '#999', 
    marginBottom: 24, 
    lineHeight: 22,
  },
  errorBox: { 
    backgroundColor: 'rgba(239, 68, 68, 0.1)', 
    borderWidth: 1, 
    borderColor: '#EF4444', 
    borderRadius: 12, 
    padding: 14, 
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: { 
    color: '#EF4444', 
    fontSize: 13, 
    fontWeight: '600',
    flex: 1,
  },
  successBox: { 
    backgroundColor: 'rgba(34, 197, 94, 0.1)', 
    borderWidth: 1, 
    borderColor: '#22C55E', 
    borderRadius: 12, 
    padding: 14, 
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  successText: { 
    color: '#22C55E', 
    fontSize: 13, 
    fontWeight: '600',
    flex: 1,
  },
  inputRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#0f0f0f', 
    borderRadius: 14, 
    borderWidth: 2, 
    borderColor: '#2a2a2a', 
    paddingHorizontal: 16, 
    height: 56,
    marginBottom: 16,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(143, 196, 65, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  inputIcon: { 
    marginRight: 12 
  },
  textInput: { 
    flex: 1, 
    fontSize: 15, 
    color: '#fff',
    fontWeight: '500',
  },
  eyeBtn: {
    padding: 8,
    marginLeft: 8,
  },
  goldBtn: { 
    backgroundColor: GOLD, 
    borderRadius: 14, 
    height: 56, 
    flexDirection: 'row',
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 16,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  goldBtnDisabled: { 
    backgroundColor: '#3A3A3A',
    shadowOpacity: 0,
    elevation: 0,
  },
  goldBtnText: { 
    color: '#000', 
    fontSize: 16, 
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(143, 196, 65, 0.05)',
    marginTop: 8,
  },
  backBtnText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  // Success screen styles
  successContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  successIconContainer: {
    marginBottom: 24,
  },
  successIconBg: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  successMessage: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
});
