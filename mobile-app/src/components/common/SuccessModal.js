import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

const SuccessModal = ({ visible, onClose, title = 'Success', message = '' }) => {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.cardBg }]}>
          {/* Success Icon */}
          <View style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark" size={40} color="#fff" />
            </View>
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>

          {/* Message */}
          {message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              {message}
            </Text>
          ) : null}

          {/* OK Button */}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.buttonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  iconContainer: {
    marginBottom: 20,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'linear-gradient(135deg, #10B981, #059669)',
    justifyContent: 'center',
    alignItems: 'center',
    // Fallback for linear-gradient
    backgroundColor: '#10B981',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 48,
    borderRadius: 24,
    alignItems: 'center',
  },
  buttonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default SuccessModal;
