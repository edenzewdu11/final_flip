import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function CameraDisclosure({ visible, colors, onAccept, onDecline }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + '22' }]}> 
            <Ionicons name="camera-outline" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Camera Access Required</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>FlipStar collects camera data to enable video and photo creation for social content sharing and campaign participation.</Text>
          <View style={styles.list}>
            <Text style={[styles.item, { color: colors.text }]}>• Record videos and photos for posts</Text>
            <Text style={[styles.item, { color: colors.text }]}>• Participate in creator campaigns</Text>
            <Text style={[styles.item, { color: colors.text }]}>• Capture profile and social content</Text>
            <Text style={[styles.item, { color: colors.text }]}>• Upload content for community interaction</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={onDecline}>
              <Text style={[styles.secondaryText, { color: colors.text }]}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={onAccept}>
              <Text style={styles.primaryText}>Allow Camera Access</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    gap: 14,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  list: {
    gap: 8,
  },
  item: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: {
    fontWeight: '700',
  },
  primaryButton: {
    flex: 1.3,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: '#08110A',
    fontWeight: '800',
  },
});
