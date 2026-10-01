import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import api from '../api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);

  useEffect(() => { loadUser(); }, []);

  // Check subscription status when user changes (with delay to ensure token is ready)
  useEffect(() => {
    if (user && !subscriptionChecked) {
      const timer = setTimeout(() => checkSubscriptionStatus(), 1000);
      return () => clearTimeout(timer);
    } else if (!user) {
      setSubscriptionStatus(null);
      setSubscriptionChecked(false);
    }
  }, [user]);

  const checkSubscriptionStatus = async () => {
    try {
      // Ensure token is available before checking
      const hasToken = await api.hasToken();
      if (!hasToken) {
        console.log('[AUTH] No token available yet, skipping subscription check');
        setSubscriptionStatus({ has_subscription: false });
        setSubscriptionChecked(true);
        return;
      }
      const status = await api.checkSubscriptionStatus();
      console.log('[AUTH] Subscription status:', status);
      setSubscriptionStatus(status);
      setSubscriptionChecked(true);
    } catch (error) {
      console.log('[AUTH] Failed to check subscription status:', error);
      // Handle 403 errors - they mean no subscription
      if (error.message?.includes('403') || error.message?.includes('has_subscription":false')) {
        console.log('🔒 [AUTH] 403 error - user has no subscription');
        setSubscriptionStatus({ has_subscription: false });
      } else {
        // On other errors (network, server, etc.), assume user HAS subscription to avoid blocking them
        // This prevents false blocking due to API failures
        console.log('[AUTH] API error - assuming user has subscription to avoid blocking:', error.message);
        setSubscriptionStatus({ has_subscription: true });
      }
      setSubscriptionChecked(true);
    }
  };

  // Refresh subscription status
  const refreshSubscriptionStatus = async () => {
    try {
      const status = await api.checkSubscriptionStatus();
      console.log('[AUTH] Subscription status refreshed:', status);
      setSubscriptionStatus(status);
      setSubscriptionChecked(true);

      // Log when subscription expires
      if (!status.has_subscription) {
        console.log('🔒 [AUTH] User has no active subscription after refresh');
      }
    } catch (error) {
      console.log('[AUTH] Failed to refresh subscription status:', error);
      // Handle 403 errors - they mean no subscription
      if (error.message?.includes('403') || error.message?.includes('has_subscription":false')) {
        console.log('🔒 [AUTH] 403 error - user has no subscription');
        setSubscriptionStatus({ has_subscription: false });
      } else {
        // On other errors (network, server, etc.), assume user HAS subscription to avoid blocking them
        // This prevents false blocking due to API failures
        console.log('[AUTH] API error - assuming user has subscription to avoid blocking:', error.message);
        setSubscriptionStatus({ has_subscription: true });
      }
      setSubscriptionChecked(true);
    }
  };

  const loadUser = async () => {
    try {
      const token = await api.getAuthToken();
      if (token) {
        const userData = await api.getProfile();
        setUser(userData);
      }
    } catch {
      // Token invalid — clear it
      await api.clearAuth();
    } finally {
      setLoading(false);
    }
  };

  const login = async (identifier, password) => {
    const data = await api.login(identifier, password);
    setUser(data.user);
    // Don't check subscription immediately - let the useEffect handle it with delay
    return data;
  };

  const register = async (payload) => {
    // payload: { fullName, phone, password } from RegisterScreen
    const { fullName, phone, password, first_name, last_name } = payload;

    // Generate a username from full name + timestamp suffix
    const baseUsername = (fullName || 'user')
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    const username = `${baseUsername}_${Date.now().toString().slice(-4)}`;

    const data = await api.request('/auth/register-with-phone/', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        username,
        password,
        first_name: first_name || (fullName || '').split(' ')[0] || '',
        last_name: last_name || (fullName || '').split(' ').slice(1).join(' ') || '',
        email: '',
        skip_otp: true,
      }),
    });

    if (data.token) await api.setAuthToken(data.token);
    setUser(data.user);
    // Don't check subscription immediately - let the useEffect handle it with delay
    return data;
  };

  const logout = async () => {
    await api.clearAuth();
    setUser(null);
    setSubscriptionStatus(null);
    setSubscriptionChecked(false);
  };

  const confirmLogout = (title = 'Logout', message = 'Are you sure you want to log out of your account?') => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
            } catch (error) {
              console.error('Logout error:', error);
            }
          },
        },
      ]
    );
  };

  const contextValue = useMemo(
    () => ({ 
      user, 
      setUser,
      loading, 
      subscriptionStatus, 
      subscriptionChecked, 
      hasActiveSubscription: subscriptionStatus?.has_subscription || false,
      login, 
      register, 
      logout, 
      confirmLogout,
      loadUser,
      refreshSubscriptionStatus 
    }),
    [user, loading, subscriptionStatus, subscriptionChecked, login, register, logout, confirmLogout, loadUser, refreshSubscriptionStatus]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};
