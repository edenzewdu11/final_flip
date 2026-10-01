import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

const REQUEST_STEPS = [
  {
    title: 'Open the FlipStar App',
    body: 'Launch FlipStar on Android, iOS, or the web and sign in with your Ethio telecom mobile number.',
  },
  {
    title: 'Go to Profile Settings',
    body: 'Open your profile, then go to settings and choose the account deletion option.',
    path: ['Profile', 'Settings', 'Account', 'Delete Account'],
  },
  {
    title: 'Confirm your identity',
    body: 'Review your registered number and confirm that you understand this action is permanent. For security, only the account owner can submit the request.',
  },
  {
    title: 'Submit the deletion request',
    body: 'Read the summary of what will be deleted, add an optional reason, then tap the final delete button to submit your request.',
    note: 'If you cannot access the app, contact support@skykintech.com.et or 994@ethionet.et and include your registered mobile number with the subject “Account Deletion Request”.',
  },
  {
    title: 'Deletion is processed',
    body: 'Your account is hidden quickly and your personal data is permanently deleted within up to 30 days, except records retained by law.',
  },
];

const TIMELINE = [
  { label: 'Day 0', detail: 'Request confirmed immediately' },
  { label: 'Day 7', detail: 'Profile hidden from public view' },
  { label: 'Day 30', detail: 'Personal data permanently deleted' },
];

const DELETED_ITEMS = [
  'Your account profile, display name, avatar, and mobile-linked profile data',
  'All Flips, comments, votes, shares, saves, and creator activity',
  'Followers, following lists, notifications, sessions, and device tokens',
  'Digital Coins balance, Points balance, and unrecovered creator earnings',
  'In-app support history and non-required personal records',
];

const RETAINED_ITEMS = [
  'Transaction and payout records retained for legal and financial compliance',
  'Prize claim and audit records where required by Ethiopian law',
  'Security and fraud-prevention logs retained for a limited compliance window',
  'Deletion audit records proving your request was processed',
];

const SUPPORT_CHANNELS = [
  { icon: 'mail-outline', label: 'Email', value: 'support@skykintech.com.et', href: 'mailto:support@skykintech.com.et' },
  { icon: 'mail-open-outline', label: 'Ethio telecom', value: '994@ethionet.et', href: 'mailto:994@ethionet.et' },
  { icon: 'chatbox-ellipses-outline', label: 'SMS Support', value: 'Send DELETE to 9286', href: 'sms:9286' },
  { icon: 'send-outline', label: 'Telegram', value: 't.me/ethio_telecom', href: 'https://t.me/ethio_telecom' },
  { icon: 'logo-whatsapp', label: 'WhatsApp', value: '+251 99 400 0000', href: 'https://wa.me/251994000000' },
  { icon: 'globe-outline', label: 'Web Portal', value: 'flipstar.et', href: 'https://flipstar.et' },
];

const UNSUBSCRIBE_OPTIONS = [
  'Via SMS: send STOP1, STOP2, or STOP3 to 9286',
  'Via app: Profile -> Settings -> Subscription -> Cancel',
  'Via telebirr: open VAS Services -> Manage Subscriptions -> FlipStar',
];

export default function AccountDeletionScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { logout, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');

  const registeredNumber = useMemo(() => {
    return user?.phone_number || user?.mobile || user?.username || 'Your registered mobile number';
  }, [user]);

  const performDeletion = async () => {
    setLoading(true);
    try {
      await api.deleteAccount({
        confirm: true,
        confirm_phrase: 'DELETE',
        reason,
        feedback,
      });
      await logout();
      Alert.alert('Account deleted', 'Your account has been permanently deleted. Limited records may be retained where required by law.', [
        { text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) },
      ]);
    } catch (error) {
      Alert.alert('Deletion failed', error.message || 'Unable to delete your account right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (!confirmed) {
      Alert.alert('Confirmation required', 'Please acknowledge that account deletion is permanent before continuing.');
      return;
    }

    if (confirmPhrase.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Type DELETE', 'Please type DELETE to confirm this permanent action.');
      return;
    }

    Alert.alert(
      'Delete account',
      'This permanently removes your profile, uploaded content, comments, saved posts, Coins, Points, and most personal account data. Some transaction, legal, security, and audit records may be retained for compliance. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDeletion },
      ]
    );
  };

  const openLink = async (href) => {
    try {
      await Linking.openURL(href);
    } catch {
      Alert.alert('Unable to open link', href);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}> 
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}> 
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Delete Account</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <View style={[styles.pill, { backgroundColor: colors.error + '14', borderColor: colors.error + '30' }]}>
            <Ionicons name="warning-outline" size={14} color={colors.error} />
            <Text style={[styles.pillText, { color: colors.error }]}>Permanent Action</Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.text }]}>Delete My Account</Text>
          <Text style={[styles.heroBody, { color: colors.textSecondary }]}>This page explains how to request deletion of your FlipStar account, what data is removed, what is retained for legal reasons, and how to contact support if you cannot access the app.</Text>

          <View style={[styles.metaGrid, { borderTopColor: colors.border }]}> 
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Operated by</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>Ethio telecom & SkykinTechnologies PLC</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>App</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>FlipStar (Android · iOS · Web)</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Processing time</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>Up to 30 days</Text>
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>1 · How to Request Account Deletion</Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Step-by-step instructions</Text>

          <View style={[styles.alertBox, { backgroundColor: colors.error + '12', borderColor: colors.error + '28' }]}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
            <Text style={[styles.alertText, { color: colors.text }]}>This action is permanent and cannot be undone. Withdraw any earned Points before deletion, because uncashed balances are permanently forfeited.</Text>
          </View>

          {REQUEST_STEPS.map((step, index) => (
            <View key={step.title} style={styles.stepRow}>
              <View style={styles.stepRail}>
                <View style={[styles.stepBadge, { backgroundColor: colors.text }]}>
                  <Text style={styles.stepBadgeText}>{index + 1}</Text>
                </View>
                {index !== REQUEST_STEPS.length - 1 ? <View style={[styles.stepLine, { backgroundColor: colors.border }]} /> : null}
              </View>
              <View style={styles.stepBody}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                <Text style={[styles.stepText, { color: colors.textSecondary }]}>{step.body}</Text>
                {step.path ? (
                  <View style={styles.pathWrap}>
                    {step.path.map((part, partIndex) => (
                      <React.Fragment key={`${step.title}-${part}`}>
                        <View style={[styles.pathPill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                          <Text style={[styles.pathText, { color: colors.text }]}>{part}</Text>
                        </View>
                        {partIndex !== step.path.length - 1 ? <Text style={[styles.pathArrow, { color: colors.textSecondary }]}>→</Text> : null}
                      </React.Fragment>
                    ))}
                  </View>
                ) : null}
                {step.note ? (
                  <View style={[styles.stepNote, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                    <Text style={[styles.stepNoteText, { color: colors.textSecondary }]}>{step.note}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>Processing timeline</Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>What happens after you confirm</Text>

          <View style={styles.timelineGrid}>
            {TIMELINE.map((item) => (
              <View key={item.label} style={[styles.timelineCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[styles.timelineLabel, { color: colors.primary }]}>{item.label}</Text>
                <Text style={[styles.timelineText, { color: colors.text }]}>{item.detail}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.dualCardRow]}>
          <View style={[styles.infoCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
            <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>2 · Deleted</Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Removed within 30 days</Text>
            {DELETED_ITEMS.map((item) => (
              <View key={item} style={styles.listRow}>
                <Ionicons name="remove-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.listText, { color: colors.textSecondary }]}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.infoCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
            <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>2 · Retained</Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Kept for legal compliance</Text>
            {RETAINED_ITEMS.map((item) => (
              <View key={item} style={styles.listRow}>
                <Ionicons name="document-text-outline" size={16} color={colors.primary} />
                <Text style={[styles.listText, { color: colors.textSecondary }]}>{item}</Text>
              </View>
            ))}
            <Text style={[styles.retentionNote, { color: colors.textSecondary }]}>Retention period: minimum 5 years for required financial and audit records, then permanently destroyed.</Text>
          </View>
        </View>

        <View style={[styles.alertBox, styles.fullWidthAlert, { backgroundColor: colors.error + '12', borderColor: colors.error + '28' }]}>
          <Ionicons name="warning-outline" size={18} color={colors.error} />
          <Text style={[styles.alertText, { color: colors.text }]}>Points and Coins cannot be recovered after deletion. We strongly recommend withdrawing earned Points before submitting this request.</Text>
        </View>

        <View style={[styles.alertBox, styles.fullWidthAlert, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '22' }]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          <Text style={[styles.alertText, { color: colors.text }]}>Your mobile number is never sold or shared. It is used only for account verification, service delivery, and compliance obligations.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>3 · Need Help?</Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Contact support directly</Text>
          <Text style={[styles.bodyText, { color: colors.textSecondary }]}>If you cannot complete deletion in the app, our team can process the request manually. Include your registered mobile number and, optionally, your reason for deletion.</Text>

          {SUPPORT_CHANNELS.map((channel) => (
            <TouchableOpacity key={channel.label} style={[styles.contactRow, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => openLink(channel.href)}>
              <View style={[styles.contactIcon, { backgroundColor: colors.primary + '12' }]}>
                <Ionicons name={channel.icon} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.contactLabel, { color: colors.text }]}>{channel.label}</Text>
                <Text style={[styles.contactValue, { color: colors.textSecondary }]}>{channel.value}</Text>
              </View>
              <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>4 · Just Want to Unsubscribe?</Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Cancel subscription without deleting your account</Text>
          {UNSUBSCRIBE_OPTIONS.map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
              <Text style={[styles.listText, { color: colors.textSecondary }]}>{item}</Text>
            </View>
          ))}
          <Text style={[styles.bodyText, { color: colors.textSecondary }]}>Your profile, Flips, and most progress remain available if you unsubscribe without deleting your account.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]}>Final confirmation</Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Submit deletion request</Text>
          <Text style={[styles.bodyText, { color: colors.textSecondary }]}>Registered account: {registeredNumber}</Text>

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Why are you leaving?</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.bg }]}
            placeholder="Reason for deletion"
            placeholderTextColor={colors.textSecondary}
            value={reason}
            onChangeText={setReason}
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Additional feedback</Text>
          <TextInput
            style={[styles.textArea, { borderColor: colors.border, color: colors.text, backgroundColor: colors.bg }]}
            placeholder="Additional feedback (optional)"
            placeholderTextColor={colors.textSecondary}
            value={feedback}
            onChangeText={setFeedback}
            multiline
            textAlignVertical="top"
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Type DELETE to continue</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.bg }]}
            placeholder="DELETE"
            placeholderTextColor={colors.textSecondary}
            value={confirmPhrase}
            onChangeText={setConfirmPhrase}
            autoCapitalize="characters"
          />
        </View>

        <TouchableOpacity style={[styles.confirmRow, { backgroundColor: colors.cardBg, borderColor: colors.border }]} onPress={() => setConfirmed((prev) => !prev)}>
          <View style={[styles.checkbox, { borderColor: confirmed ? colors.primary : colors.border, backgroundColor: confirmed ? colors.primary : 'transparent' }]}> 
            {confirmed ? <Ionicons name="checkmark" size={16} color="#08110A" /> : null}
          </View>
          <Text style={[styles.confirmText, { color: colors.text }]}>I understand that account deletion is permanent and cannot be undone.</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.deleteButton, { backgroundColor: colors.error, opacity: loading ? 0.8 : 1 }]} onPress={handleDelete} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteText}>Confirm Delete Account</Text>}
        </TouchableOpacity>

        <Text style={[styles.footerText, { color: colors.textSecondary }]}>Governing law: this deletion process follows the laws of the Federal Democratic Republic of Ethiopia. If you need help, contact support before confirming.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 14 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  heroTitle: { fontSize: 30, fontWeight: '800', lineHeight: 34 },
  heroBody: { fontSize: 15, lineHeight: 23 },
  metaGrid: { marginTop: 10, paddingTop: 16, borderTopWidth: 1, gap: 14 },
  metaItem: { gap: 4 },
  metaLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  metaValue: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 14 },
  dualCardRow: { gap: 16 },
  infoCard: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  sectionEyebrow: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  bodyText: { fontSize: 14, lineHeight: 22 },
  alertBox: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  fullWidthAlert: { marginTop: -2 },
  alertText: { flex: 1, fontSize: 14, lineHeight: 20 },
  stepRow: { flexDirection: 'row', gap: 14 },
  stepRail: { width: 34, alignItems: 'center' },
  stepBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stepLine: { width: 2, flex: 1, marginTop: 6, marginBottom: -6 },
  stepBody: { flex: 1, paddingBottom: 18 },
  stepTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  stepText: { fontSize: 14, lineHeight: 21 },
  pathWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  pathPill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  pathText: { fontSize: 12, fontWeight: '700' },
  pathArrow: { fontSize: 14, fontWeight: '700' },
  stepNote: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  stepNoteText: { fontSize: 13, lineHeight: 20 },
  timelineGrid: { gap: 12 },
  timelineCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  timelineLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  timelineText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  listRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  listText: { flex: 1, fontSize: 14, lineHeight: 21 },
  retentionNote: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  contactRow: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  contactIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  contactValue: { fontSize: 13, lineHeight: 19 },
  inputLabel: { fontSize: 13, fontWeight: '700', marginBottom: -4 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  textArea: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 120, fontSize: 15 },
  confirmRow: { borderWidth: 1, borderRadius: 20, padding: 18, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  confirmText: { flex: 1, fontSize: 14, lineHeight: 20 },
  deleteButton: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  deleteText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  footerText: { fontSize: 12, lineHeight: 18, paddingHorizontal: 4, paddingBottom: 8 },
});