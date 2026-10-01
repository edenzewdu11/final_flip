import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';

const ConsentContext = createContext();

const CONSENT_STORAGE_KEY = 'privacy_consents_cache';
const HISTORY_STORAGE_KEY = 'privacy_consent_history_cache';

const isMissingConsentEndpoint = (error) => {
  const message = error?.message || '';
  return message.includes('/privacy/consents/') && (
    message.includes('404') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('Failed to parse response')
  );
};

const isNetworkFailure = (error) => {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.name === 'TypeError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network')
  );
};

const DEFAULT_CONSENTS = {
  camera: {
    type: 'camera',
    title: 'Camera Access',
    disclosure: 'FlipStar collects camera data to enable video and photo creation for social content sharing and campaign participation.',
    granted: false,
  },
  storage: {
    type: 'storage',
    title: 'Storage Access',
    disclosure: 'FlipStar accesses device storage to save your created content, profile media, and app preferences needed for core functionality.',
    granted: false,
  },
  analytics: {
    type: 'analytics',
    title: 'Analytics',
    disclosure: 'FlipStar uses analytics data to improve app performance, reliability, and user experience.',
    granted: false,
  },
  marketing: {
    type: 'marketing',
    title: 'Marketing',
    disclosure: 'FlipStar uses marketing consent to send product updates, campaigns, and creator opportunities.',
    granted: false,
  },
  gdpr_banner: {
    type: 'gdpr_banner',
    title: 'Cookie and Tracking Banner',
    disclosure: 'FlipStar asks EU users for tracking consent before enabling optional analytics or marketing technologies.',
    granted: false,
  },
  privacy_policy: {
    type: 'privacy_policy',
    title: 'Privacy Policy Acceptance',
    disclosure: 'FlipStar records the privacy policy version you accepted so that we can notify you about material changes.',
    granted: false,
  },
};

export const useConsent = () => {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error('useConsent must be used within a ConsentProvider');
  }
  return context;
};

export const ConsentProvider = ({ children }) => {
  const [consents, setConsents] = useState(DEFAULT_CONSENTS);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const persist = async (nextConsents, nextHistory = history) => {
    try {
      await AsyncStorage.multiSet([
        [CONSENT_STORAGE_KEY, JSON.stringify(nextConsents)],
        [HISTORY_STORAGE_KEY, JSON.stringify(nextHistory)],
      ]);
    } catch (error) {
      console.error('Failed to persist consent state:', error);
    }
  };

  const loadLocalState = async () => {
    try {
      const [[, cachedConsents], [, cachedHistory]] = await AsyncStorage.multiGet([
        CONSENT_STORAGE_KEY,
        HISTORY_STORAGE_KEY,
      ]);
      if (cachedConsents) {
        setConsents({ ...DEFAULT_CONSENTS, ...JSON.parse(cachedConsents) });
      }
      if (cachedHistory) {
        setHistory(JSON.parse(cachedHistory));
      }
    } catch (error) {
      console.error('Failed to load local consent state:', error);
    }
  };

  const refreshConsents = async () => {
    try {
      const [statusResponse, historyResponse] = await Promise.all([
        api.getConsentStatus().catch((error) => {
          if (isMissingConsentEndpoint(error)) {
            return { consents: null, unavailable: true };
          }
          throw error;
        }),
        api.getConsentHistory().catch((error) => {
          if (isMissingConsentEndpoint(error)) {
            return { history: [], unavailable: true };
          }
          return { history: [] };
        }),
      ]);
      const nextConsents = { ...DEFAULT_CONSENTS, ...(statusResponse?.consents || {}) };
      const nextHistory = historyResponse?.history || [];
      setConsents(nextConsents);
      setHistory(nextHistory);
      await persist(nextConsents, nextHistory);
      return nextConsents;
    } catch (error) {
      if (!isMissingConsentEndpoint(error) && !isNetworkFailure(error)) {
        console.error('Failed to refresh consent state:', error);
      }
      return consents;
    }
  };

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      await loadLocalState();
      try {
        await refreshConsents();
      } catch {
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const updateConsent = async (type, granted, extra = {}) => {
    const localConsent = {
      ...(consents[type] || DEFAULT_CONSENTS[type] || { type }),
      granted,
      updated_at: new Date().toISOString(),
      source: extra.source || 'in_app',
      metadata: extra.metadata || {},
      disclosure_version: extra.disclosure_version || '2026.05',
      granted_at: granted ? new Date().toISOString() : consents[type]?.granted_at || null,
      withdrawn_at: granted ? null : new Date().toISOString(),
    };
    const nextConsents = { ...consents, [type]: localConsent };
    const localEvent = {
      type,
      action: granted ? 'granted' : 'withdrawn',
      granted,
      source: localConsent.source,
      metadata: localConsent.metadata,
      created_at: new Date().toISOString(),
    };
    const nextHistory = [localEvent, ...history].slice(0, 200);
    setConsents(nextConsents);
    setHistory(nextHistory);
    await persist(nextConsents, nextHistory);

    try {
      const response = await api.updateConsent({
        type,
        granted,
        source: localConsent.source,
        metadata: localConsent.metadata,
        disclosure_version: localConsent.disclosure_version,
      });
      const syncedConsents = {
        ...nextConsents,
        ...(response?.consents || {}),
      };
      setConsents(syncedConsents);
      const refreshedHistory = await api.getConsentHistory().catch(() => ({ history: nextHistory }));
      const syncedHistory = refreshedHistory?.history || nextHistory;
      setHistory(syncedHistory);
      await persist(syncedConsents, syncedHistory);
      return response;
    } catch (error) {
      if (!isMissingConsentEndpoint(error)) {
        console.error('Failed to sync consent update:', error);
      }
      return { offline: true, consents: { [type]: localConsent } };
    }
  };

  const hasConsent = (type) => Boolean(consents[type]?.granted);

  const value = useMemo(
    () => ({
      consents,
      history,
      loading,
      hasConsent,
      refreshConsents,
      updateConsent,
    }),
    [consents, history, loading]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
};
