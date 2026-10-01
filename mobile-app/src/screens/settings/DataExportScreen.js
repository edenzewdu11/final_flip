import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';

export default function DataExportScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [exportData, setExportData] = useState(null);
  const [fileUri, setFileUri] = useState('');

  const handleExport = async () => {
    setLoading(true);
    try {
      const response = await api.downloadData();
      setExportData(response);
      const uri = `${FileSystem.documentDirectory || ''}flipstar-data-export-${Date.now()}.json`;
      if (FileSystem.documentDirectory) {
        await FileSystem.writeAsStringAsync(uri, JSON.stringify(response, null, 2));
        setFileUri(uri);
      }
      Alert.alert('Export ready', 'Your data export has been generated and saved locally on this device.');
    } catch (error) {
      Alert.alert('Export failed', error.message || 'Unable to generate your data export right now.');
    } finally {
      setLoading(false);
    }
  };

  const summary = exportData
    ? [
        ['Reels', exportData.reels?.length || 0],
        ['Comments', exportData.comments?.length || 0],
        ['Replies', exportData.comment_replies?.length || 0],
        ['Votes', exportData.votes?.length || 0],
        ['Notifications', exportData.notifications?.length || 0],
        ['Consent events', exportData.consent_history?.length || 0],
      ]
    : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}> 
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}> 
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Export Your Data</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.heroTitle, { color: colors.text }]}>Download a machine-readable copy of your data</Text>
          <Text style={[styles.heroBody, { color: colors.textSecondary }]}>This export includes your profile, content, interactions, privacy settings, and consent history in JSON format for GDPR and Google Play compliance.</Text>
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={handleExport} disabled={loading}>
            {loading ? <ActivityIndicator color="#08110A" /> : <Text style={styles.primaryText}>Generate Export</Text>}
          </TouchableOpacity>
          {fileUri ? <Text style={[styles.filePath, { color: colors.textSecondary }]}>Saved to: {fileUri}</Text> : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Included in your export</Text>
          {summary.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Generate an export to preview the included records.</Text>
          ) : (
            summary.map(([label, value]) => (
              <View key={label} style={[styles.summaryRow, { borderBottomColor: colors.border + '70' }]}> 
                <Text style={[styles.summaryLabel, { color: colors.text }]}>{label}</Text>
                <Text style={[styles.summaryValue, { color: colors.primary }]}>{value}</Text>
              </View>
            ))
          )}
        </View>

        {exportData ? (
          <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Export preview</Text>
            <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={28}>{JSON.stringify(exportData, null, 2)}</Text>
          </View>
        ) : null}
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
  primaryButton: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#08110A', fontWeight: '800' },
  filePath: { fontSize: 12, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginVertical: 10 },
  emptyText: { fontSize: 14, paddingVertical: 14 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1 },
  summaryLabel: { fontSize: 15, fontWeight: '700' },
  summaryValue: { fontSize: 15, fontWeight: '800' },
  preview: { fontSize: 12, lineHeight: 18, paddingBottom: 18 },
});
