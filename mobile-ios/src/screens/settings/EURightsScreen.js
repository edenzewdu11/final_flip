import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';

export default function EURightsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [summary, setSummary] = useState({ rights: [], transfer_mechanisms: [] });

  useEffect(() => {
    api.getEURightsSummary().then(setSummary).catch(() => {});
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}> 
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}> 
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>EU Privacy Rights</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.heroTitle, { color: colors.text }]}>GDPR information for EU and EEA users</Text>
          <Text style={[styles.heroBody, { color: colors.textSecondary }]}>If you are in the EU or EEA, you can access, correct, export, erase, or restrict the processing of your data. You can also object to certain processing and withdraw optional consent at any time.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your rights</Text>
          {summary.rights.map((item) => (
            <Text key={item} style={[styles.bullet, { color: colors.textSecondary }]}>• {item}</Text>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>International transfer safeguards</Text>
          {summary.transfer_mechanisms.map((item) => (
            <Text key={item} style={[styles.bullet, { color: colors.textSecondary }]}>• {item}</Text>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>How to exercise these rights</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>Use the data export screen to download your data, use the account deletion screen to request erasure, and use the consent dashboard to withdraw optional processing consent. For unresolved concerns, contact privacy@flipstar.et or your local supervisory authority.</Text>
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
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  bullet: { fontSize: 14, lineHeight: 22 },
  body: { fontSize: 14, lineHeight: 22 },
});
