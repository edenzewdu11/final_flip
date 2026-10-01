import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useConsent } from '../../contexts/ConsentContext';
import api from '../../api';

function ConsentRow({ title, description, value, onToggle, colors }) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border + '70' }]}>
      <View style={{ flex: 1, paddingRight: 16 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onToggle} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
    </View>
  );
}

export default function ConsentDashboard({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { consents, history, loading, updateConsent, refreshConsents } = useConsent();
  const [policySummary, setPolicySummary] = useState(null);

  useEffect(() => {
    refreshConsents().catch(() => {});
    api.getPrivacyPolicySummary().then(setPolicySummary).catch(() => {});
  }, []);

  const entries = Object.values(consents || {});

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}> 
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}> 
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Consent Dashboard</Text>
        <TouchableOpacity onPress={() => refreshConsents().catch(() => {})}>
          <Ionicons name="refresh-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.heroTitle, { color: colors.text }]}>Manage your privacy choices</Text>
          <Text style={[styles.heroBody, { color: colors.textSecondary }]}>Review every optional permission in one place, withdraw consent at any time, and keep an audit trail of changes for Google Play and GDPR compliance.</Text>
          {policySummary ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>Privacy policy version {policySummary.version} effective {policySummary.effective_date}</Text>
          ) : null}
          <View style={styles.linkRow}>
            <TouchableOpacity style={[styles.linkButton, { borderColor: colors.border }]} onPress={() => navigation.navigate('PrivacyPolicyScreen')}>
              <Text style={[styles.linkText, { color: colors.text }]}>Privacy Policy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.linkButton, { borderColor: colors.border }]} onPress={() => navigation.navigate('EURightsScreen')}>
              <Text style={[styles.linkText, { color: colors.text }]}>EU Rights</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Permission controls</Text>
          {loading && entries.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : (
            entries.map((item) => (
              <ConsentRow
                key={item.type}
                title={item.title || item.type}
                description={item.disclosure}
                value={Boolean(item.granted)}
                onToggle={(nextValue) => updateConsent(item.type, nextValue, { source: 'consent_dashboard' })}
                colors={colors}
              />
            ))
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Consent history</Text>
          {history.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No consent changes recorded yet.</Text>
          ) : (
            history.slice(0, 12).map((event, index) => (
              <View key={`${event.type}-${event.created_at}-${index}`} style={[styles.historyRow, { borderBottomColor: colors.border + '70' }]}> 
                <View style={[styles.historyIcon, { backgroundColor: colors.primary + '20' }]}> 
                  <Ionicons name={event.granted ? 'checkmark' : 'close'} size={14} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.historyTitle, { color: colors.text }]}>{event.type.replace(/_/g, ' ')} {event.action}</Text>
                  <Text style={[styles.historyMeta, { color: colors.textSecondary }]}>{new Date(event.created_at).toLocaleString()} via {event.source}</Text>
                </View>
              </View>
            ))
          )}
        </View>
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
  heroTitle: { fontSize: 24, fontWeight: '800' },
  heroBody: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 12 },
  linkRow: { flexDirection: 'row', gap: 12 },
  linkButton: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  linkText: { fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  rowDescription: { fontSize: 13, lineHeight: 19 },
  emptyText: { fontSize: 14, paddingVertical: 14 },
  historyRow: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  historyIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  historyTitle: { fontSize: 14, fontWeight: '700', textTransform: 'capitalize' },
  historyMeta: { fontSize: 12, marginTop: 4 },
});
