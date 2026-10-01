import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

const GOLD = '#C8B56A';
const CARD = '#1A1A1A';
const BORDER = '#262626';

export default function InsufficientCoinsModal({ visible, onClose, onBuyCoins }) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Insufficient Coins</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={s.iconContainer}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.primary} />
          </View>

          <Text style={s.message}>
            You have insufficient coins to perform this action.
          </Text>

          <TouchableOpacity
            style={[s.buyBtn, { backgroundColor: colors.primary }]}
            onPress={onBuyCoins}
          >
            <Text style={s.buyBtnText}>Buy Coins</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalSheet: {
    backgroundColor: '#111',
    borderRadius: 18,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#8fc441',
  },
  iconContainer: {
    marginBottom: 16,
  },
  message: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  buyBtn: {
    width: '100%',
    padding: 14,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buyBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
  },
  cancelBtn: {
    width: '100%',
    padding: 14,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#262626',
  },
  cancelBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
