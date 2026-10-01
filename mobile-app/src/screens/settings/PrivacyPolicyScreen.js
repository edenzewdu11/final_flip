import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useConsent } from '../../contexts/ConsentContext';

const TABLE_OF_CONTENTS = [
  ['01', 'Who We Are'],
  ['02', 'Data We Collect'],
  ['03', 'How We Use Your Data'],
  ['04', 'Data Storage & Security'],
  ['05', 'Data Sharing'],
  ['06', 'User-Generated Content'],
  ['07', 'Metadata & Location'],
  ['08', 'Cookies & Tracking'],
  ['09', 'Your Rights'],
  ['10', 'Data Retention'],
  ['11', "Children's Privacy"],
  ['12', 'Policy Updates'],
  ['13', 'Contact Us'],
];

const DATA_COLLECT_ROWS = [
  ['Account Identity', 'Ethio telecom mobile number, full name provided at registration', 'At Registration'],
  ['Subscription & Billing', 'Subscription plan type, billing timestamps, payment status, telebirr transaction references', 'Automatically'],
  ['Platform Activity', 'Uploads, votes, comments, shares, gifts sent and received, coins, points balance, login timestamps', 'Automatically'],
  ['Content Data', 'Videos, photos, captions, hashtags you upload, and moderation results', 'When You Post'],
  ['Prize & Identity', 'National ID or passport number, proxy authorisation documents for prize winners only', 'On Prize Claim'],
  ['Device & Technical', 'Device type, OS version, app version, and IP address for service delivery', 'Automatically'],
];

const DATA_SHARING_ROWS = [
  ['Ethio telecom', 'Billing, subscriber verification, prize delivery via telebirr, SMS notifications', 'Contract'],
  ['SkykinTechnologies PLC', 'Platform operation, content hosting, app maintenance, moderation', 'Contract'],
  ['Law Enforcement / Regulators', 'When required by Ethiopian law or court order', 'Legal Obligation'],
  ['Third Parties', 'We do not sell, rent, or share your personal data with unrelated third parties for marketing purposes.', 'Not Shared'],
];

const RIGHTS_ROWS = [
  ['Access', 'Request a copy of the personal data we hold about you', 'In-App Support or Email'],
  ['Correction', 'Request correction of inaccurate or incomplete data', 'Account Settings or Support'],
  ['Deletion', 'Request deletion of your account and associated data, subject to legal retention obligations', 'In-App Support or Email'],
  ['Unsubscription', 'Cancel your FlipStar subscription at any time via SMS, app settings, or telebirr', 'SMS · App · telebirr'],
  ['Objection', 'Object to the use of your data for promotional purposes', 'Email support@skykintech.com.et'],
];

const RETENTION_ROWS = [
  ['Digital Coins (purchased)', 'Valid while account is active; expire 30 days after unsubscription if not restored via re-subscription'],
  ['Earned Points', 'Forfeited after 180 days of account inactivity if not withdrawn or converted'],
  ['Unclaimed Prizes', 'Expire 30 days after winner notification and may be awarded to the next eligible runner-up'],
  ['Account Data', 'Retained while account is active; deleted upon verified deletion request subject to applicable legal obligations'],
  ['Transaction Records', 'Retained for the minimum period required by Ethiopian financial regulations'],
];

const CONTACTS = [
  { icon: 'chatbubble-ellipses-outline', label: 'In-App Support', value: 'Profile -> Help & Support -> Contact Us' },
  { icon: 'mail-outline', label: 'Email', value: 'support@skykintech.com.et', href: 'mailto:support@skykintech.com.et' },
  { icon: 'mail-open-outline', label: 'Ethio telecom Email', value: '994@ethionet.et', href: 'mailto:994@ethionet.et' },
  { icon: 'chatbox-outline', label: 'SMS', value: '9286', href: 'sms:9286' },
  { icon: 'logo-whatsapp', label: 'WhatsApp', value: '+251 99 400 0000', href: 'https://wa.me/251994000000' },
  { icon: 'send-outline', label: 'Telegram', value: 'https://t.me/ethio_telecom', href: 'https://t.me/ethio_telecom' },
];

function PolicyCard({ children, colors }) {
  return <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>{children}</View>;
}

function SectionHeading({ number, title, icon, colors }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '28' }]}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text style={[styles.sectionNumber, { color: colors.primary }]}>{number}</Text>
      </View>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
    </View>
  );
}

function BulletList({ items, colors }) {
  return items.map((item) => (
    <View key={item} style={styles.bulletRow}>
      <Ionicons name="ellipse" size={8} color={colors.primary} style={styles.bulletDot} />
      <Text style={[styles.body, { color: colors.textSecondary }]}>{item}</Text>
    </View>
  ));
}

function Table({ headers, rows, colors, flexValues }) {
  const flex = flexValues || headers.map(() => 1);

  return (
    <View style={[styles.table, { borderColor: colors.border }]}>
      <View style={[styles.tableRow, styles.tableHeader, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        {headers.map((header, index) => (
          <Text key={header} style={[styles.tableHeaderText, { color: colors.text, flex: flex[index] }]}>{header}</Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={`${row[0]}-${rowIndex}`} style={[styles.tableRow, rowIndex !== rows.length - 1 && { borderBottomColor: colors.border }]}>
          {row.map((cell, cellIndex) => (
            <Text key={`${row[0]}-${cellIndex}`} style={[styles.tableCell, { color: colors.textSecondary, flex: flex[cellIndex] }]}>{cell}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function PrivacyPolicyScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { updateConsent } = useConsent();

  const acknowledgePolicy = async () => {
    await updateConsent('privacy_policy', true, { source: 'privacy_policy_screen' });
    Alert.alert('Policy acknowledged', 'Your acknowledgment of the current privacy policy has been recorded.');
  };

  const openLink = async (href) => {
    if (!href) return;
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Privacy Policy</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <Text style={[styles.heroEyebrow, { color: colors.textSecondary }]}>Legal & Privacy</Text>
          <Text style={[styles.heroTitle, { color: colors.text }]}>Privacy Policy</Text>
          <Text style={[styles.heroBody, { color: colors.textSecondary }]}>This policy explains how FlipStar, a service by Ethio telecom and SkykinTechnologies PLC, collects, uses, stores, and protects your personal data when you use the FlipStar app and web portal.</Text>

          <View style={[styles.metaGrid, { borderTopColor: colors.border }]}>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Effective Date</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>May 2026</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Version</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>2.1</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Applies To</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>Android · iOS · Web (flipstar.et)</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Data Jurisdiction</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>Federal Democratic Republic of Ethiopia</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={acknowledgePolicy}>
            <Text style={styles.primaryText}>Acknowledge Latest Policy</Text>
          </TouchableOpacity>
        </View>

        <PolicyCard colors={colors}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Table of Contents</Text>
          <View style={styles.tocGrid}>
            {TABLE_OF_CONTENTS.map(([number, label]) => (
              <View key={number} style={[styles.tocItem, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[styles.tocNumber, { color: colors.primary }]}>{number}</Text>
                <Text style={[styles.tocLabel, { color: colors.text }]}>{label}</Text>
              </View>
            ))}
          </View>
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="01" title="Who We Are" icon="business-outline" colors={colors} />
          <BulletList items={[
            "Ethio telecom is Ethiopia's national telecommunications provider and is responsible for billing, subscriber management, and data prize delivery via telebirr.",
            'SkykinTechnologies PLC is the technology partner responsible for the FlipStar platform, app, and web portal hosted at https://flipstar.et.',
            'Ethio telecom and SkykinTechnologies PLC act as joint data controllers for FlipStar user data under the laws of the Federal Democratic Republic of Ethiopia.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="02" title="Data We Collect" icon="document-text-outline" colors={colors} />
          <Table headers={['Category', 'Data Points', 'Collected']} rows={DATA_COLLECT_ROWS} colors={colors} flexValues={[1.1, 2.2, 1]} />
          <View style={[styles.noticeBox, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '22' }]}>
            <Text style={[styles.noticeText, { color: colors.text }]}>What we do not collect: We do not collect GPS location data linked to your profile. Any location or device metadata embedded in uploaded Flips is automatically removed before storage and publication.</Text>
          </View>
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="03" title="How We Use Your Data" icon="settings-outline" colors={colors} />
          <BulletList items={[
            'Service provision: to create and manage your account, process subscription charges, and grant access to FlipStar features and competitions.',
            'Billing and payments: to deduct subscription fees from airtime or telebirr balances, process coin purchases, and deliver cash prizes via telebirr.',
            'Platform operations: to calculate Engagement Score, maintain leaderboards, and award competition prizes.',
            'SMS notifications: to send subscription confirmation, auto-renewal alerts, unsubscription confirmations, and prize notifications.',
            'Content moderation: to review uploaded content via AI and manual moderation for brand safety and legal compliance.',
            'Promotion and marketing: your name, initials, photos, and video images may be used by Ethio telecom for promotional purposes as described in the Terms and Conditions.',
            'Fraud prevention: to detect and prevent botting, vote manipulation, self-gifting, and other prohibited behaviours.',
            'Support: to respond to enquiries submitted via in-app support, SMS 9286, email, WhatsApp, or Telegram.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="04" title="Data Storage & Security" icon="lock-closed-outline" colors={colors} />
          <Text style={[styles.body, { color: colors.textSecondary }]}>FlipStar is hosted exclusively on the Ethio telecom InfraCloud, located within Ethiopia. Your data does not leave the country.</Text>
          <BulletList items={[
            'Encrypted storage: your mobile phone number is stored in encrypted form and is never displayed publicly on the platform.',
            'Metadata stripping: GPS coordinates and device information are automatically removed from every Flip before it is stored or published.',
            'Secure transactions: coin purchases and point payouts are processed through the secure telebirr payment infrastructure.',
            'Access controls: only authorised personnel at Ethio telecom and SkykinTechnologies PLC have access to personal data on a need-to-know basis.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="05" title="Data Sharing" icon="people-outline" colors={colors} />
          <Table headers={['Shared With', 'Purpose', 'Basis']} rows={DATA_SHARING_ROWS} colors={colors} flexValues={[1.2, 2.1, 1]} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="06" title="User-Generated Content" icon="videocam-outline" colors={colors} />
          <BulletList items={[
            'By uploading a Flip, you grant Ethio telecom and SkykinTechnologies PLC a non-exclusive, royalty-free, worldwide licence to host, store, reproduce, and promote your content within the FlipStar platform.',
            'Your name, initials, photos, and video images may be used for promotional and advertising purposes without separate individual consent each time, as agreed in the Terms and Conditions.',
            'Content submitted for Weekly competitions and above may be reviewed by AI and or manual moderation for brand safety compliance before reward eligibility.',
            'You retain ownership of your original content. The licence granted is limited to operation and promotion of the FlipStar platform.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="07" title="Metadata & Location" icon="location-outline" colors={colors} />
          <Text style={[styles.body, { color: colors.textSecondary }]}>FlipStar automatically removes all personal metadata, including GPS location data and device information, from every Flip before the content is stored or made publicly visible on the platform.</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>Approximate location may be inferred from Ethio telecom network registration for subscriber verification purposes only. This is not associated with your public profile or shared with other users.</Text>
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="08" title="Cookies & Tracking Technologies" icon="finger-print-outline" colors={colors} />
          <BulletList items={[
            'Session cookies are used on the web portal to maintain your logged-in session and are deleted when you close your browser.',
            'The mobile app stores session tokens and preferences locally on your device to provide a smooth experience.',
            'Basic usage analytics may be collected to improve the platform and are aggregated rather than linked to identifiable individuals.',
            'FlipStar does not embed third-party advertising trackers or sell browsing data to advertisers.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="09" title="Your Rights" icon="shield-checkmark-outline" colors={colors} />
          <Table headers={['Right', 'What It Means', 'How to Exercise']} rows={RIGHTS_ROWS} colors={colors} flexValues={[1, 2, 1.2]} />
          <Text style={[styles.body, { color: colors.textSecondary }]}>To exercise any of these rights, contact support@skykintech.com.et or use In-App Support. We aim to respond within 30 days.</Text>
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="10" title="Data Retention" icon="calendar-outline" colors={colors} />
          <Table headers={['Data Type', 'Retention Period']} rows={RETENTION_ROWS} colors={colors} flexValues={[1.2, 2]} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="11" title="Children's Privacy" icon="happy-outline" colors={colors} />
          <BulletList items={[
            'FlipStar is intended exclusively for users aged 18 years and above.',
            'We do not knowingly collect personal data from individuals under the age of 18.',
            'If you believe a person under 18 has registered for FlipStar, contact support@skykintech.com.et so we can remove the account and associated data.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="12" title="Policy Updates" icon="sync-outline" colors={colors} />
          <BulletList items={[
            'Ethio telecom reserves the right to update this Privacy Policy at any time in accordance with applicable Ethiopian law.',
            'The current version of this policy is always published at https://flipstar.et.',
            'Continued use of FlipStar after a policy update constitutes acceptance of the revised policy.',
            'For material changes, users will be notified by SMS to the registered mobile number.',
          ]} colors={colors} />
        </PolicyCard>

        <PolicyCard colors={colors}>
          <SectionHeading number="13" title="Contact Us" icon="mail-outline" colors={colors} />
          <Text style={[styles.body, { color: colors.textSecondary }]}>For privacy-related questions, data requests, or complaints, use any of the following channels:</Text>
          <View style={styles.contactList}>
            {CONTACTS.map((contact) => (
              <TouchableOpacity key={contact.label} activeOpacity={contact.href ? 0.75 : 1} onPress={() => openLink(contact.href)} style={[styles.contactRow, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <View style={[styles.contactIcon, { backgroundColor: colors.primary + '14' }]}>
                  <Ionicons name={contact.icon} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.contactLabel, { color: colors.text }]}>{contact.label}</Text>
                  <Text style={[styles.contactValue, { color: colors.textSecondary }]}>{contact.value}</Text>
                </View>
                {contact.href ? <Ionicons name="open-outline" size={16} color={colors.textSecondary} /> : null}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.footerLaw, { color: colors.textSecondary }]}>Governing Law: This Privacy Policy is governed by the laws of the Federal Democratic Republic of Ethiopia. Any disputes relating to this policy shall be resolved in accordance with Ethiopian law.</Text>
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>© 2026 Ethio telecom & SkykinTechnologies PLC · All rights reserved · flipstar.et</Text>
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>Privacy Policy v2.1 · May 2026</Text>
        </PolicyCard>
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
  hero: { borderWidth: 1, borderRadius: 22, padding: 20, gap: 12 },
  heroEyebrow: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  heroTitle: { fontSize: 28, fontWeight: '800', lineHeight: 32 },
  heroBody: { fontSize: 15, lineHeight: 22 },
  metaGrid: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, gap: 10 },
  metaItem: { gap: 4 },
  metaLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  metaValue: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  primaryButton: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#08110A', fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  sectionHeader: { gap: 10 },
  sectionBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  sectionNumber: { fontSize: 12, fontWeight: '800' },
  sectionTitle: { fontSize: 18, fontWeight: '800', lineHeight: 23 },
  body: { fontSize: 14, lineHeight: 21 },
  tocGrid: { gap: 10 },
  tocItem: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  tocNumber: { fontSize: 12, fontWeight: '800', minWidth: 28 },
  tocLabel: { fontSize: 14, fontWeight: '600', flex: 1 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { marginTop: 7 },
  table: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  tableHeader: { borderBottomWidth: 1 },
  tableRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 12, gap: 10, borderBottomWidth: 1 },
  tableHeaderText: { fontSize: 12, fontWeight: '800' },
  tableCell: { fontSize: 13, lineHeight: 19 },
  noticeBox: { borderWidth: 1, borderRadius: 16, padding: 14 },
  noticeText: { fontSize: 14, lineHeight: 21 },
  contactList: { gap: 10 },
  contactRow: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  contactIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  contactValue: { fontSize: 13, lineHeight: 18 },
  footerLaw: { fontSize: 13, lineHeight: 20, marginTop: 2 },
  footerNote: { fontSize: 12, lineHeight: 18 },
});
