import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

export default function SubscriptionGate({ children, navigation }) {
  const { user, refreshSubscriptionStatus } = useAuth();

  // Periodically refresh subscription status (every 30 seconds like website).
  // NOTE: This no longer force-navigates the user away from whatever screen
  // they're on. Users without an active subscription can still browse the
  // app freely; only specific interactive actions (like, comment, gift,
  // share, post, etc.) should check `hasActiveSubscription` and redirect to
  // the Subscription screen themselves when needed.
  useEffect(() => {
    if (!user || !api.hasToken()) return;

    const interval = setInterval(async () => {
      console.log('[SUBSCRIPTION_GATE] Periodic subscription check (30 seconds)...');
      try {
        await refreshSubscriptionStatus();
      } catch (e) {
        console.log('[SUBSCRIPTION_GATE] Periodic subscription check failed:', e.message);
      }
    }, 30 * 1000); // 30 seconds

    return () => clearInterval(interval);
  }, [user, refreshSubscriptionStatus]);

  // Always render children - subscription status no longer blocks navigation.
  return children;
}
