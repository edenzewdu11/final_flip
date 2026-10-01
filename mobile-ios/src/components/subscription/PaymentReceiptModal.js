import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GREEN = '#8fc441';

/**
 * Light/white receipt-style confirmation popup, matching the web app's
 * Telebirr subscription receipt design:
 *   - Title (e.g. "Subscribe to FlipStar Daily")
 *   - Big total amount
 *   - White details card with label/value rows (e.g. Plan, Amount, Date, Phone)
 *   - Green "Proceed" button
 *
 * Used for both the Telebirr subscription flow and coin purchases
 * (via Airtime or Telebirr).
 */
export default function PaymentReceiptModal({
  visible,
  onClose,
  onProceed,
  processing,
  title,
  amountLabel,
  currency = 'ETB',
  rows = [],
  phoneEditable = false,
  phoneValue = '',
  onPhoneChange,
  proceedLabel = 'Proceed',
  proceedDisabled = false,
}) {
  const [phone, setPhone] = useState(phoneValue || '');

  useEffect(() => {
    if (visible) setPhone(phoneValue || '');
  }, [visible, phoneValue]);

  if (!visible) return null;

  const handlePhoneChange = (t) => {
    setPhone(t);
    onPhoneChange && onPhoneChange(t);
  };

  const isValidPhone = !phoneEditable || (phone && phone.replace(/\D/g, '').length >= 9);
  const disabled = processing || proceedDisabled || !isValidPhone;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.card}>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} disabled={processing}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>

          <Text style={s.title}>{title}</Text>

          <View style={s.amountRow}>
            <Text style={s.amount}>{amountLabel}</Text>
            <Text style={s.currency}>{currency}</Text>
          </View>

          <View style={s.detailsCard}>
            {rows.map((r, i) => (
              <View
                key={i}
                style={[s.detailRow, i === rows.length - 1 && !phoneEditable && { marginBottom: 0 }]}
              >
                <Text style={s.detailLabel}>{r.label}</Text>
                <Text style={s.detailValue}>{r.value}</Text>
              </View>
            ))}
            {phoneEditable && (
              <View style={[s.detailRow, { marginBottom: 0 }]}>
                <Text style={s.detailLabel}>Phone Number</Text>
                <TextInput
                  style={s.phoneInlineInput}
                  value={phone}
                  onChangeText={handlePhoneChange}
                  placeholder="09XXXXXXXX"
                  placeholderTextColor="#999"
                  keyboardType="phone-pad"
                  editable={!processing}
                  textAlign="right"
                />
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[s.proceedBtn, disabled && { opacity: 0.6 }]}
            onPress={() => onProceed(phone)}
            disabled={disabled}
          >
            {processing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.proceedText}>{proceedLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
  },
  closeBtn: {
    alignSelf: 'flex-start',
    marginBottom: 4,
    padding: 4,
  },
  title: {
    textAlign: 'center',
    fontSize: 14,
    color: '#fff',
    marginBottom: 4,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginBottom: 20,
  },
  amount: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
  },
  currency: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginLeft: 4,
  },
  detailsCard: {
    backgroundColor: '#262626',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  detailLabel: {
    fontSize: 14,
    color: '#999',
  },
  detailValue: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '700',
  },
  phoneInlineInput: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    marginLeft: 12,
    padding: 0,
  },
  proceedBtn: {
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  proceedText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
