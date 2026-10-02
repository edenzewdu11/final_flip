import config from './config';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  configureEncryption,
  decryptResponseBody,
  encryptRequestBody,
  ensureEncryptionReady,
  getClientPublicKey,
  isCryptoError,
  isEncryptedRoute,
  rotateKeyPair,
} from './security';

const API_BASE_URLS = (config.API_BASE_URL_CANDIDATES && config.API_BASE_URL_CANDIDATES.length
  ? config.API_BASE_URL_CANDIDATES
  : [config.API_BASE_URL]
).filter(Boolean);
let activeApiBaseUrl = API_BASE_URLS[0] || config.API_BASE_URL;

let authToken = null;

// Token management
const TOKEN_KEY = 'authToken';

const webStorage = {
  async getItem(key) {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
      return null;
    }
    return globalThis.localStorage.getItem(key);
  },

  async setItem(key, value) {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
      return;
    }
    globalThis.localStorage.setItem(key, value);
  },

  async deleteItem(key) {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
      return;
    }
    globalThis.localStorage.removeItem(key);
  },
};

async function getStoredToken(key) {
  if (Platform.OS === 'web') {
    return webStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setStoredToken(key, value) {
  if (Platform.OS === 'web') {
    return webStorage.setItem(key, value);
  }
  return SecureStore.setItemAsync(key, value);
}

async function deleteStoredToken(key) {
  if (Platform.OS === 'web') {
    return webStorage.deleteItem(key);
  }
  return SecureStore.deleteItemAsync(key);
}

// Initialize auth token from secure storage
const initAuthToken = async () => {
  try {
    const token = await getStoredToken(TOKEN_KEY);
    if (token) {
      authToken = token;
    }
  } catch (error) {
    console.error('Error loading auth token:', error);
  }
};

// Cache configuration
const _cache = new Map();
const _inflight = new Map();
const CACHE_TTL = 300_000; // 5 minutes default TTL for better performance
const MAX_RETRIES = 1;
const RETRY_DELAY = 500;

function getEndpointUrl(baseUrl, endpoint) {
  if (typeof endpoint === 'string' && (endpoint.startsWith('http://') || endpoint.startsWith('https://'))) {
    return endpoint;
  }
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  let cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  if (cleanEndpoint.startsWith('/api/v1/')) {
    if (cleanBase.endsWith('/api/v1')) {
      cleanEndpoint = cleanEndpoint.replace('/api/v1', '');
    } else if (cleanBase.endsWith('/api')) {
      cleanEndpoint = cleanEndpoint.replace('/api', '');
    }
  } else if (cleanEndpoint.startsWith('/api/')) {
    if (cleanBase.endsWith('/api')) {
      cleanEndpoint = cleanEndpoint.replace('/api', '');
    }
  }

  return `${cleanBase}${cleanEndpoint}`;
}

function isNetworkFailure(error) {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.name === 'TypeError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('fetch') ||
    message.includes('network')
  );
}

function buildNetworkError(endpoint, originalError) {
  const details = [
    `Network request failed for ${endpoint}.`,
    `Base URL: ${activeApiBaseUrl}`,
    'Check internet connectivity and backend SSL certificate/domain configuration.',
  ].join(' ');

  const wrapped = new Error(details);
  wrapped.name = originalError?.name || 'NetworkError';
  wrapped.endpoint = endpoint;
  wrapped.baseUrl = activeApiBaseUrl;
  wrapped.cause = originalError;
  return wrapped;
}

async function fetchWithBaseUrlFailover(endpoint, options) {
  let lastError;
  let lastResponse;

  for (let i = 0; i < API_BASE_URLS.length; i++) {
    const baseUrl = API_BASE_URLS[i];
    const isLast = i === API_BASE_URLS.length - 1;
    try {
      const response = await retryWithBackoff(async () => {
        return await fetch(getEndpointUrl(baseUrl, endpoint), options);
      });
      const isIdempotent = !options?.method || ['GET', 'HEAD'].includes(String(options.method).toUpperCase());
      // Re-sending a POST after a gateway error trips the server's replay protection.
      if (isIdempotent && (response.status === 404 || response.status === 502 || response.status === 503 || response.status === 504) && !isLast) {
        lastResponse = response;
        continue;
      }
      activeApiBaseUrl = baseUrl;
      return response;
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error) && !isLast) {
        continue;
      }
      if (!isNetworkFailure(error)) {
        throw error;
      }
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError;
}

configureEncryption({
  serverKeyLoader: async () => {
    let response;
    try {
      response = await fetchWithBaseUrlFailover('/crypto/public-key/', {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      });
    } catch (_) { }
    if (!response || !response.ok) {
      try {
        response = await fetchWithBaseUrlFailover('/v1/crypto/public-key/', {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        });
      } catch (_) { }
    }
    if (!response || !response.ok) {
      throw new Error(`server key unavailable (${response ? response.status : 'network error'})`);
    }
    return response.json();
  },
});

function getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < entry.ttl) return entry.data;
  _cache.delete(key);
  return null;
}

function setCache(key, data, ttl = CACHE_TTL) {
  _cache.set(key, { data, ts: Date.now(), ttl });
}

function isMissingPrivacyEndpointError(error) {
  const message = error?.message || '';
  const isOptionalPrivacyFailure = (
    message.includes('[HTTP 404]') ||
    message.includes('[HTTP 502]') ||
    message.includes('[HTTP 503]') ||
    message.includes('[HTTP 504]') ||
    message.includes('Failed to parse response')
  );
  return isOptionalPrivacyFailure && (
    message.includes('/privacy/consents/') ||
    message.includes('/privacy/consents/history/') ||
    message.includes('/privacy/consents/update/') ||
    message.includes('/privacy/policy/summary/') ||
    message.includes('/privacy/eu-rights/')
  );
}

function invalidateCache(pattern) {
  for (const key of _cache.keys()) {
    if (key.includes(pattern)) _cache.delete(key);
  }
}

async function retryWithBackoff(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (
        error.name === 'TypeError' ||
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('502') ||
        error.message.includes('503') ||
        error.message.includes('504') ||
        error.message.includes('HTTP 502') ||
        error.message.includes('HTTP 503') ||
        error.message.includes('HTTP 504')
      ) {
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
          continue;
        }
      }
      throw error;
    }
  }
  return fn();
}

const api = {
  setAuthToken: async (token) => {
    authToken = token;
    if (token) {
      await setStoredToken(TOKEN_KEY, token);
    } else {
      await deleteStoredToken(TOKEN_KEY);
    }
    _cache.clear();
  },

  // Test backend connectivity
  testBackend: async () => {
    try {
      const response = await fetch(`${activeApiBaseUrl}/`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      return response.status !== 401;
    } catch (error) {
      console.error('Backend test failed:', error);
      return false;
    }
  },

  getAuthToken: async () => {
    // Return the in-memory token directly without re-initializing
    // This prevents race conditions where initAuthToken might clear the token
    return authToken;
  },

  hasToken: async () => {
    // Just check the in-memory token directly
    return !!authToken;
  },

  clearAuth: async () => {
    console.log('Clearing all auth data');
    authToken = null;
    await deleteStoredToken(TOKEN_KEY);
    _cache.clear();
  },

  async request(endpoint, options = {}) {
    // Cache logic
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    const isRealtime = (
      endpoint.startsWith('/messages/') ||
      endpoint.includes('/notifications/unread') ||
      endpoint.includes('unread-count')
    );
    const cacheable = isGet && !options.skipCache && !isRealtime;
    const cacheKey = cacheable ? endpoint : null;

    if (cacheable && cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const inflightKey = isGet ? `GET:${endpoint}` : null;
    if (inflightKey && _inflight.has(inflightKey)) {
      return _inflight.get(inflightKey);
    }

    const doRequest = async () => {
      const headers = { ...options.headers };
      if (!options.isFormData) {
        headers['Content-Type'] = 'application/json';
      }

      const currentToken = await this.getAuthToken();
      // Auth endpoints that DO require token
      const authenticatedAuthEndpoints = [
        '/auth/change-password/',
        '/auth/delete-account/',
        '/auth/password/change',
        '/auth/download-data/',
        '/auth/export-data/',
      ];
      const isAuthenticatedAuthEndpoint = authenticatedAuthEndpoints.some((authEndpoint) => endpoint.includes(authEndpoint));
      const isPublicEndpoint =
        (endpoint.includes('/auth/') && !isAuthenticatedAuthEndpoint) ||
        endpoint.includes('/settings/public') ||
        endpoint.includes('/subscription/check-superapp') ||
        endpoint.includes('/subscription/telebirr/ussd/') ||
        endpoint.includes('/charging/ussd-push/');
      // Don't send Authorization header for public auth endpoints (like login/register)
      if (currentToken && !isPublicEndpoint) {
        headers['Authorization'] = `Token ${currentToken}`;
      }

      // Always provide X-Client-Public-Key so encrypted transport views can encrypt responses
      try {
        const clientKey = await getClientPublicKey();
        if (clientKey) {
          headers['X-Client-Public-Key'] = clientKey;
        }
      } catch (_) { }

      let body = options.body;
      if (!options.isFormData && body !== undefined && body !== null && body !== '') {
        try {
          if (isEncryptedRoute(endpoint)) {
            const sealed = await encryptRequestBody(endpoint, body);
            if (sealed !== null) {
              body = sealed;
            }
          }
        } catch (error) {
          if (isCryptoError(error)) {
            error.endpoint = endpoint;
          }
          throw error;
        }
      }

      let response;
      try {
        response = await fetchWithBaseUrlFailover(endpoint, {
          ...options,
          headers,
          body,
        });
      } catch (error) {
        if (isNetworkFailure(error)) {
          throw buildNetworkError(endpoint, error);
        }
        throw error;
      }

      let data;
      if (response.status === 204) {
        data = { success: true };
      } else {
        try {
          data = await response.json();
        } catch (e) {
          // Include status in error message for retry logic
          const statusPrefix = !response.ok ? `[HTTP ${response.status}] ` : '';
          data = response.ok ? { success: true } : { error: `${statusPrefix}Failed to parse response` };
        }
      }

      try {
        data = await decryptResponseBody(data);
      } catch (error) {
        if (isCryptoError(error)) {
          error.endpoint = endpoint;
          error.status = response.status;
        }
        throw error;
      }

      if (!response.ok) {
        // NOTE: We intentionally do NOT clear stored credentials or retry
        // without auth on a 401. A transient 401 (server hiccup, race
        // condition on a background request) does not mean the token is
        // actually invalid, and wiping the token here would silently log
        // the user out mid-session. Only an explicit logout call should
        // clear credentials.
        if (response.status === 401) {
          console.error('🔒 401 Unauthorized - authentication required');
        }
        const silentEndpoints = ['/notifications/me/', '/profile/get_privacy/', '/profile/update_privacy/', '/blocks/', '/gamification/login-bonus/', '/privacy/consents/', '/privacy/consents/history/', '/privacy/consents/update/', '/privacy/policy/summary/', '/privacy/eu-rights/', '/auth/verify-telebirr-subscription-otp/'];
        const isSilent = silentEndpoints.some(e => endpoint.includes(e));

        if (!isSilent) {
          console.error(`API Error [${endpoint}]:`, response.status, data);
        }
        const errorMsg = typeof data === 'string' ? data : (data.error || JSON.stringify(data));
        const error = new Error(`[HTTP ${response.status}] ${endpoint}: ${errorMsg}`);
        error.status = response.status;
        error.endpoint = endpoint;
        error.data = data;
        throw error;
      }

      if (cacheable && cacheKey) setCache(cacheKey, data);
      return data;
    };

    const resultPromise = doRequest();
    if (inflightKey) {
      _inflight.set(inflightKey, resultPromise);
      resultPromise.finally(() => {
        if (_inflight.get(inflightKey) === resultPromise) {
          _inflight.delete(inflightKey);
        }
      });
    }
    return resultPromise;
  },

  invalidateCache,

  // Returns cached data immediately (if any) and refreshes in background.
  // onUpdate(freshData) is called when the network response arrives.
  requestStale(endpoint, onUpdate) {
    const cached = getCached(endpoint);
    // Fire network request in background regardless
    this.request(endpoint, { skipCache: true })
      .then(fresh => {
        setCache(endpoint, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => { });
    return cached; // may be null on first load
  },

  // Wake up the Render backend so it's ready before the user hits a real endpoint
  warmUp() {
    fetch(`${activeApiBaseUrl}/health/`, { method: 'GET' }).catch(() => { });
    ensureEncryptionReady().catch(() => { });
  },

  ensureEncryptionReady,

  rotateEncryptionKeys: rotateKeyPair,

  // Auth
  register: (username, email, password, firstName = '', lastName = '') =>
    api.request('/auth/register/', {
      method: 'POST',
      body: JSON.stringify({
        username,
        email,
        password,
        first_name: firstName,
        last_name: lastName,
      }),
    }),

  // OTP Phone Registration
  sendPhoneOTP: (phone) =>
    api.request('/auth/send-phone-otp/', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  verifyPhoneOTP: (phone, code) =>
    api.request('/auth/verify-phone-otp/', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),

  registerWithPhone: (phone, username, password, email = '', dateOfBirth = '', ageConfirmed = false) =>
    api.request('/auth/register-with-phone/', {
      method: 'POST',
      body: JSON.stringify({ phone, username, password, email, date_of_birth: dateOfBirth, age_confirmed: ageConfirmed }),
    }),

  login: async (identifier, password) => {
    // Use same endpoint as website - username/password login
    const data = await api.request('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username: identifier, password }),
    });
    if (data.token) {
      // Set token in memory and storage
      authToken = data.token;
      await setStoredToken(TOKEN_KEY, data.token);
    }
    return data;
  },

  // Phone + PIN login for OTP-registered users
  loginWithPhonePin: async (phone, pin) => {
    const data = await api.request('/auth/login-with-phone-pin/', {
      method: 'POST',
      body: JSON.stringify({ phone, pin }),
    });
    if (data.token) {
      // Set token in memory and storage
      authToken = data.token;
      await setStoredToken(TOKEN_KEY, data.token);
    }
    return data;
  },

  // Forgot Password
  forgotPasswordRequest: (email) =>
    api.request('/auth/forgot-password/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPasswordConfirm: (email, code, new_password) =>
    api.request('/auth/forgot-password/confirm/', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password }),
    }),

  // Forgot Password (Phone-based with SMS OTP)
  forgotPasswordPhoneRequest: (phone) =>
    api.request('/auth/forgot-password-phone/', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  forgotPasswordPhoneVerify: (phone, code, new_password) =>
    api.request('/auth/forgot-password-phone/verify/', {
      method: 'POST',
      body: JSON.stringify({ phone, code, new_password }),
    }),

  // SuperApp & Subscription OTP Auth (matches user curl & Postman {{base_url}}/api/v1/auth/send-login-otp/)
  checkSuperAppSubscription: async (phone) => {
    let cleanPhone = String(phone || '').trim();
    const digits = cleanPhone.replace(/\D/g, '');
    let localPhone = cleanPhone;
    if (digits.length >= 9) {
      localPhone = '0' + digits.slice(-9);
    }
    const intlPhone = '251' + digits.slice(-9);
    const candidatePhones = [localPhone, intlPhone];

    const targetUrls = [
      'https://api.uat.flipstar.et/api/v1/subscription/check-superapp/',
      'https://api.uat.flipstar.et/api/subscription/check-superapp/',
      'https://flipstar.et/api/v1/subscription/check-superapp/',
    ];

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    for (const url of targetUrls) {
      for (const p of candidatePhones) {
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ phone: p }),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && typeof data === 'object') {
              console.log(`📱 [CHECK SUPERAPP SUB SUCCESS on ${url}]:`, JSON.stringify(data));
              return data;
            }
          }
        } catch (_) {}
      }
    }

    return api.request('/subscription/check-superapp/', {
      method: 'POST',
      body: JSON.stringify({ phone: localPhone }),
    });
  },

  sendLoginOtp: async (phone, extraParams = {}) => {
    let cleanPhone = String(phone || '').trim();
    const digits = cleanPhone.replace(/\D/g, '');
    let localPhone = cleanPhone;
    if (digits.length >= 9) {
      localPhone = '0' + digits.slice(-9);
    }

    const payload = {
      phone: localPhone,
      ...(extraParams?.application_key ? { application_key: extraParams.application_key } : {}),
      ...(extraParams?.product_number ? { product_number: extraParams.product_number } : {}),
    };

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    // Primary: POST https://api.uat.flipstar.et/api/v1/auth/send-login-otp/
    console.log('📱 [SEND LOGIN OTP REQ TO UAT]:', JSON.stringify({ url: 'https://api.uat.flipstar.et/api/v1/auth/send-login-otp/', payload }));

    let resp = null;
    let data = null;

    try {
      resp = await fetch('https://api.uat.flipstar.et/api/v1/auth/send-login-otp/', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      data = await resp.json().catch(() => ({}));
    } catch (networkErr) {
      console.log('📱 [SEND LOGIN OTP UAT network error]:', networkErr?.message);
    }

    // Check for rate limit / cooldown
    if (resp && (resp.status === 429 || (data && typeof data.error === 'string' && data.error.toLowerCase().includes('wait')))) {
      const waitMsg = data.error || data.message || 'Please wait before requesting another OTP';
      const err = new Error(waitMsg);
      err.status = 429;
      err.isRateLimited = true;
      console.log('📱 [SEND LOGIN OTP RATE LIMITED]:', waitMsg);
      throw err;
    }

    if (resp && resp.ok) {
      console.log('📱 [SEND LOGIN OTP SUCCESS on UAT]:', JSON.stringify(data));
      return data;
    }

    // Failover only on server outage (404/500/502/network failure)
    const fallbackUrls = [
      'https://api.uat.flipstar.et/api/auth/send-login-otp/',
      'https://flipstar.et/api/v1/auth/send-login-otp/',
    ];

    for (const url of fallbackUrls) {
      try {
        console.log(`📱 [SEND LOGIN OTP trying fallback ${url}]:`, JSON.stringify(payload));
        const fbResp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const fbData = await fbResp.json().catch(() => ({}));

        if (fbResp.status === 429 || (fbData && typeof fbData.error === 'string' && fbData.error.toLowerCase().includes('wait'))) {
          const waitMsg = fbData.error || fbData.message || 'Please wait before requesting another OTP';
          const err = new Error(waitMsg);
          err.status = 429;
          err.isRateLimited = true;
          throw err;
        }

        if (fbResp.ok) {
          console.log(`📱 [SEND LOGIN OTP SUCCESS on fallback ${url}]:`, JSON.stringify(fbData));
          return fbData;
        }
      } catch (fbErr) {
        if (fbErr.isRateLimited) throw fbErr;
      }
    }

    const errorMsg = data?.error || data?.message || (resp ? `HTTP ${resp.status}` : 'Network error');
    const err = new Error(errorMsg);
    if (resp) err.status = resp.status;
    err.data = data;
    throw err;
  },

  resendSubscriptionOtp: async (phone) => {
    let cleanPhone = String(phone || '').trim();
    const digits = cleanPhone.replace(/\D/g, '');
    let localPhone = cleanPhone;
    if (digits.length >= 9) {
      localPhone = '0' + digits.slice(-9);
    }

    const payload = { phone: localPhone };
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    const targetUrls = [
      'https://api.uat.flipstar.et/api/v1/auth/resend-subscription-otp/',
      'https://api.uat.flipstar.et/api/auth/resend-subscription-otp/',
      'https://flipstar.et/api/v1/auth/resend-subscription-otp/',
    ];

    for (const url of targetUrls) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          console.log(`📱 [RESEND SUB OTP SUCCESS on ${url}]:`, JSON.stringify(data));
          return data;
        }
        if (resp.status === 429 || (data?.error && data.error.includes('wait'))) {
          const err = new Error(data.error || 'Please wait before requesting another OTP');
          err.isRateLimited = true;
          throw err;
        }
      } catch (e) {
        if (e.isRateLimited) throw e;
      }
    }

    return api.request('/auth/resend-subscription-otp/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  loginWithOtp: async (phone, code) => {
    let cleanPhone = String(phone || '').trim();
    const digits = cleanPhone.replace(/\D/g, '');
    let localPhone = cleanPhone;
    if (digits.length >= 9) {
      localPhone = '0' + digits.slice(-9);
    }
    const cleanCode = String(code || '').trim();

    const targetUrls = [
      'https://api.uat.flipstar.et/api/v1/auth/login-with-otp/',
      'https://api.uat.flipstar.et/api/auth/login-with-otp/',
      'https://flipstar.et/api/v1/auth/login-with-otp/',
      'https://api.uat.flipstar.et/api/v1/auth/verify-telebirr-subscription-otp/',
    ];

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    let lastError = null;
    for (const url of targetUrls) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            phone: localPhone,
            code: cleanCode,
            otp: cleanCode,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && (data?.token || data?.user)) {
          console.log(`📱 [LOGIN WITH OTP SUCCESS on ${url}]`);
          if (data.token) {
            authToken = data.token;
            await setStoredToken(TOKEN_KEY, data.token);
          }
          return data;
        } else if (!resp.ok) {
          lastError = new Error(data?.error || data?.message || `HTTP ${resp.status}`);
        }
      } catch (err) {
        lastError = err;
      }
    }

    return api.request('/auth/login-with-otp/', {
      method: 'POST',
      body: JSON.stringify({ phone: localPhone, code: cleanCode, otp: cleanCode }),
    });
  },

  loginWithSubscriptionOtp: (phone, otp, username, password) =>
    api.request('/auth/login-with-subscription-otp/', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        otp,
        password,
        ...(username ? { username } : {}),
      }),
    }),

  verifyTelebirrSubscriptionOtp: (phone, otp, username, password) =>
    api.request('/auth/verify-telebirr-subscription-otp/', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        otp,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      }),
    }),

  telebirrCoinPurchase: async ({ packageId, amountEtb, phoneNumber, coins }) => {
    let rawPhone = String(phoneNumber || '').trim().replace(/\D/g, '');
    let msisdn = '';
    let localPhone = '';
    if (rawPhone.length >= 9) {
      const raw9 = rawPhone.slice(-9);
      msisdn = '251' + raw9;
      localPhone = '0' + raw9;
    }

    const validPackageId = packageId && packageId !== 'custom' ? Number(packageId) : undefined;
    const numericAmount = amountEtb ? Number(amountEtb) : undefined;
    const numericCoins = coins ? Number(coins) : undefined;

    const payload = {};
    if (validPackageId) payload.package_id = validPackageId;
    if (numericAmount) {
      payload.amount_etb = String(numericAmount);
      payload.amount = numericAmount;
    }
    if (msisdn) {
      payload.phone_number = msisdn;
      payload.payer_msisdn = msisdn;
      payload.phone = localPhone;
    }
    if (numericCoins) {
      payload.coins = numericCoins;
      payload.coin_amount = numericCoins;
    }

    // Attempt 1: POST /wallet/telebirrUssdPurchase/ (Postman Line 16754)
    try {
      console.log('📱 [TELEBIRR USSD PURCHASE REQ]:', JSON.stringify(payload));
      const res = await api.request('/wallet/telebirrUssdPurchase/', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      console.log('📱 [TELEBIRR USSD PURCHASE RES]:', JSON.stringify(res));
      return res;
    } catch (err) {
      console.log('📱 [TELEBIRR USSD PURCHASE FAILED]:', err?.message, err?.status);

      // Attempt 2: POST /direct-debit/one-off-coin-purchase/ (Postman Line 10184)
      try {
        const ddPayload = {
          payer_msisdn: msisdn || undefined,
          amount: numericAmount,
          coins: numericCoins,
          coin_amount: numericCoins,
          ...(validPackageId ? { package_id: validPackageId } : {}),
        };
        console.log('📱 [ONE OFF COIN PURCHASE REQ]:', JSON.stringify(ddPayload));
        const ddRes = await api.request('/direct-debit/one-off-coin-purchase/', {
          method: 'POST',
          body: JSON.stringify(ddPayload),
        });
        console.log('📱 [ONE OFF COIN PURCHASE RES]:', JSON.stringify(ddRes));
        return ddRes;
      } catch (ddErr) {
        console.log('📱 [ONE OFF COIN PURCHASE FAILED]:', ddErr?.message);

        // Attempt 3: POST /wallet/telebirr/initiate/ (Postman Line 16696)
        try {
          console.log('📱 [TELEBIRR INITIATE REQ]:', JSON.stringify(payload));
          const initRes = await api.request('/wallet/telebirr/initiate/', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          console.log('📱 [TELEBIRR INITIATE RES]:', JSON.stringify(initRes));
          return initRes;
        } catch (initErr) {
          throw err || ddErr || initErr;
        }
      }
    }
  },

  // Profile
  getProfile: () => api.request('/profile/me/'),

  updateProfile: (data) =>
    api.request('/profile/update_profile/', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }).then(r => { invalidateCache('/profile'); return r; }),

  // Reels
  getReels: () => api.request('/reels/'),

  getReelsFollowing: () => api.request('/reels/following/'),

  getReelsSaved: () => api.request('/reels/saved/'),

  getReelsTrending: () => api.request('/reels/trending/'),

  createPost: async (formData, options = {}) => {
    try {
      console.log('Starting upload with fetch API...');
      console.log('FormData entries being sent:');
      for (let [key, value] of formData._parts) {
        console.log(`${key}:`, value);
      }

      const token = await api.getAuthToken();

      const response = await fetch(`${activeApiBaseUrl}/posts/create/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token}`,
          // Don't set Content-Type - let fetch set it automatically for FormData
        },
        body: formData,
      });

      console.log('Fetch response status:', response.status);
      console.log('Fetch response headers:', response.headers);

      const responseText = await response.text();
      console.log('Fetch response text:', responseText);

      let body;
      try {
        body = JSON.parse(responseText);
        console.log('Parsed response body:', body);
      } catch (e) {
        console.log('Failed to parse JSON response:', e);
        body = { error: 'Invalid JSON response', responseText };
      }

      if (response.ok) {
        invalidateCache('/reels');
        return body;
      } else {
        console.log('Upload failed:', response.status, body);
        throw body;
      }
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  },

  voteReel: (reelId) =>
    api.request(`/reels/${reelId}/vote/`, {
      method: 'POST',
    }).then(r => { invalidateCache('/reels'); return r; }),

  postComment: (reelId, text) =>
    api.request(`/reels/${reelId}/comments/`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }).then(r => { invalidateCache(`/reels/${reelId}/comments`); invalidateCache('/reels'); return r; }),

  replyToComment: (commentId, text) =>
    api.request(`/comments/${commentId}/reply/`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }).then(r => { invalidateCache('/comments'); invalidateCache('/reels'); return r; }),

  likeComment: (commentId) =>
    api.request(`/comments/${commentId}/like/`, {
      method: 'POST',
    }).then(r => { invalidateCache('/comments'); invalidateCache('/reels'); return r; }),

  getComments: (reelId) => api.request(`/reels/${reelId}/comments/`),

  async toggleFollow(userId) {
    return this.request('/follows/toggle/', {
      method: 'POST',
      body: JSON.stringify({ following_id: userId }),
    });
  },

  // Block
  async blockUser(userId) {
    return this.request('/blocks/block/', {
      method: 'POST',
      body: JSON.stringify({ blocked_id: userId }),
    });
  },

  async unblockUser(userId) {
    return this.request('/blocks/unblock/', {
      method: 'POST',
      body: JSON.stringify({ blocked_id: userId }),
    });
  },

  getBlockedUsers: () =>
    api.request('/blocks/').then(r => { invalidateCache('/follows'); return r; }).catch(() => []),

  getFollowers: (userId) => api.request(`/follows/?following=${userId}`),

  getFollowing: (userId) => api.request(`/follows/?follower=${userId}`),

  getUserSuggestions: () => api.request('/follows/suggestions/'),

  deletePost: (reelId) =>
    api.request(`/reels/${reelId}/`, {
      method: 'DELETE',
    }).then(r => { invalidateCache('/reels'); return r; }),

  updatePost: (reelId, data) =>
    api.request(`/reels/${reelId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }).then(r => { invalidateCache('/reels'); return r; }),

  // Notifications
  getUserNotifications: () => api.request('/notifications/'),

  getUnreadNotificationCount: () => api.request('/notifications/unread-count/'),

  markNotificationRead: (notificationId) =>
    api.request(`/notifications/${notificationId}/read/`, { method: 'POST' }),

  markAllNotificationsRead: () =>
    api.request('/notifications/read/', { method: 'POST', body: JSON.stringify({}) }),

  // Search
  search: (query) => api.request(`/search/?q=${encodeURIComponent(query)}`),

  // Explore/Trending
  getTrendingContent: (category = 'all', timeRange = '7d', limit = 12, offset = 0) =>
    api.request(`/explorer/trending/?category=${category}&time_range=${timeRange}&limit=${limit}&offset=${offset}`),

  getTrendingHashtags: (timeRange = '7d', limit = 15) =>
    api.request(`/explorer/trending-hashtags/?time_range=${timeRange}&limit=${limit}`),

  getHashtagContent: (tag, limit = 30) =>
    api.request(`/explorer/hashtag/?tag=${encodeURIComponent(tag)}&limit=${limit}`),

  getUser: (userId) => api.request(`/profile/${userId}/`),

  getUserPosts: (userId) => api.request(`/reels/?user=${userId}`),

  // Saved posts
  getSavedPosts: () => api.request('/reels/?saved=true'),

  toggleSavePost: (reelId) =>
    api.request('/saved/toggle/', {
      method: 'POST',
      body: JSON.stringify({ reel_id: reelId }),
    }),

  // Profile photo
  uploadProfilePhoto: (photoFile) => {
    const formData = new FormData();
    formData.append('photo', {
      uri: photoFile.uri,
      type: photoFile.type || 'image/jpeg',
      name: photoFile.name || 'photo.jpg',
    });

    return api.request('/profile-photo/upload/', {
      method: 'POST',
      body: formData,
      isFormData: true,
    });
  },

  updateUserProfile: (data) => {
    const formData = new FormData();
    // Always append these fields to ensure they are updated correctly
    formData.append('username', data.username || '');
    formData.append('email', data.email || '');
    formData.append('first_name', data.first_name || '');
    formData.append('last_name', data.last_name || '');
    formData.append('bio', data.bio || '');

    if (data.profile_photo) {
      formData.append('profile_photo', {
        uri: Platform.OS === 'ios' ? data.profile_photo.uri.replace('file://', '') : data.profile_photo.uri,
        type: data.profile_photo.type || 'image/jpeg',
        name: data.profile_photo.name || 'photo.jpg',
      });
    }

    return api.request('/profile/update_profile/', {
      method: 'PATCH',
      body: formData,
      isFormData: true,
    });
  },

  updateNotificationSettings: (settings) =>
    api.request('/notifications/me/update/', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getNotificationSettings: () => api.request('/notifications/me/'),

  getPrivacySettings: () => api.request('/profile/privacy/'),

  updatePrivacySettings: (settings) =>
    api.request('/profile/privacy/update/', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getConsentStatus: async () => {
    try {
      return await api.request('/privacy/consents/', { skipCache: true });
    } catch (error) {
      if (isMissingPrivacyEndpointError(error)) {
        return { consents: null, unavailable: true };
      }
      throw error;
    }
  },

  updateConsent: async (payload) => {
    try {
      const response = await api.request('/privacy/consents/update/', {
        method: 'POST',
        body: JSON.stringify(payload),
        skipCache: true,
      });
      invalidateCache('/privacy/consents/');
      invalidateCache('/privacy/consents/history/');
      return response;
    } catch (error) {
      if (isMissingPrivacyEndpointError(error)) {
        return { offline: true, consents: { [payload?.type]: payload } };
      }
      throw error;
    }
  },

  getConsentHistory: async () => {
    try {
      return await api.request('/privacy/consents/history/', { skipCache: true });
    } catch (error) {
      if (isMissingPrivacyEndpointError(error)) {
        return { history: [], unavailable: true };
      }
      throw error;
    }
  },

  getPrivacyPolicySummary: async () => {
    try {
      return await api.request('/auth/privacy-policy/', { skipCache: true });
    } catch (error) {
      if (isMissingPrivacyEndpointError(error)) {
        return {
          version: '2.1',
          effective_date: 'May 2026',
          unavailable: true,
        };
      }
      throw error;
    }
  },

  getEURightsSummary: async () => {
    try {
      return await api.request('/privacy/eu-rights/', { skipCache: true });
    } catch (error) {
      if (isMissingPrivacyEndpointError(error)) {
        return {
          rights: [
            'Access your personal data',
            'Correct inaccurate information',
            'Request deletion of eligible data',
            'Restrict or object to certain processing',
            'Download a copy of your data',
            'Withdraw optional consent at any time',
          ],
          transfer_mechanisms: [
            'Standard Contractual Clauses',
            'Equivalent contractual and organizational safeguards',
          ],
          unavailable: true,
        };
      }
      throw error;
    }
  },

  changePassword: (currentPassword, newPassword) =>
    api.request('/auth/change-password/', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),

  deleteAccount: (payload = { confirm: true }) =>
    api.request('/auth/delete-account/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  downloadData: () =>
    api.request('/auth/download-data/'),

  // Campaigns
  getCampaigns: () => api.request('/campaigns/'),

  getCampaignsByStatus: (status) => api.request(`/campaigns/?status=${status}`),

  getCampaignDetail: (campaignId) => api.request(`/campaigns/${campaignId}/`),

  getCampaignFeed: (campaignId, filter = 'all') =>
    api.request(`/campaigns/${campaignId}/feed/?filter=${filter}`),

  getCampaignLeaderboard: (campaignId, period = 'overall') =>
    api.request(`/campaigns/${campaignId}/leaderboard/?period=${period}`),

  voteCampaignEntry: (entryId) =>
    api.request(`/campaigns/entries/${entryId}/vote/`, { method: 'POST' }),

  submitCampaignEntry: (campaignId, reelId) =>
    api.request(`/campaigns/${campaignId}/entries/`, {
      method: 'POST',
      body: JSON.stringify({ reel_id: reelId }),
    }),

  getCampaignScoringConfig: (campaignId) =>
    api.request(`/campaigns/${campaignId}/scoring-config/`),

  updateCampaignEngagement: (campaignId) =>
    api.request(`/campaigns/${campaignId}/engagement/update/`, { method: 'POST' }),

  getUserCampaignEntries: (userId) => api.request(`/campaigns/profile/${userId || ''}`),

  // Health check
  healthCheck: () => api.request('/health/'),

  // Public Settings (Admin controlled)
  getPublicSettings: () => api.request('/settings/public/'),

  // ─── Gamification ─────────────────────────────────────────────────────────
  getGamificationStatus: () => api.request('/gamification/status/'),
  claimLoginBonus: () => api.request('/gamification/login-bonus/', { method: 'POST' }),
  sendGift: (recipientUsername, amount, message) =>
    api.request('/gamification/gift/', {
      method: 'POST',
      body: JSON.stringify({ recipient_username: recipientUsername, amount, message })
    }),
  getDailySpin: () => api.request('/gamification/daily-spin/'),
  performSpin: () => api.request('/gamification/perform-spin/', { method: 'POST' }),

  // Wallet
  getWalletBalance: () => api.request('/wallet/'),
  getWalletConfig: () => api.request('/wallet/config/'),
  getCoinPackages: () => api.request('/coins/packages/'),
  appleVerifyCoinPurchase: (packageId, receiptData, productId) =>
    api.request('/wallet/apple/verify-purchase/', {
      method: 'POST',
      body: JSON.stringify({
        package_id: packageId,
        receipt_data: receiptData,
        product_id: productId,
      }),
    }),

  // Subscription
  getSubscription: () => api.request('/subscriptions/'),
  getSubscriptionTiers: () => api.request('/subscriptions/tiers/active/'),
  checkSubscriptionStatus: () => api.request('/subscription/status/'),
  subscribeToTier: (tierId, paymentMethod = 'sms') =>
    api.request('/subscriptions/subscribe/', {
      method: 'POST',
      body: JSON.stringify({
        tier_id: tierId,
        payment_method: paymentMethod,
      }),
    }),
  unsubscribe: () =>
    api.request('/subscriptions/unsubscribe/', {
      method: 'POST',
    }),
  upgradeSubscription: (plan) =>
    api.request('/subscription/upgrade/', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),
  upgradeToProPlan: () =>
    api.request('/subscription/upgrade/', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro' }),
    }),
  upgradeToPremiumPlan: () =>
    api.request('/subscription/upgrade/', {
      method: 'POST',
      body: JSON.stringify({ plan: 'premium' }),
    }),

  // Telebirr USSD Push Charging & Subscription
  requestChargingOtp: async (phoneNumber, tierId, purpose = 'subscription') => {
    const payload = {
      purpose,
      tier_id: tierId,
      phone_number: phoneNumber,
    };
    return await api.request('/api/v1/charging/ussd-push/request-otp/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  verifyChargingOtp: async (sessionId, code, phoneNumber) => {
    const payload = {
      session_id: sessionId,
      code,
      phone_number: phoneNumber,
    };
    return await api.request('/api/v1/charging/ussd-push/verify-otp/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  initiateTelebirrUssdPush: async (tierId, phoneNumber, verificationSessionId) => {
    const payload = {
      tier_id: tierId,
      phone_number: phoneNumber,
      ...(verificationSessionId ? { verification_session_id: verificationSessionId } : {}),
    };
    return await api.request('/api/v1/subscription/telebirr/ussd/initiate/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Competitions
  getCompetitions: () => api.request('/competitions/'),
  getActiveCompetitions: () => api.request('/competitions/?is_active=true'),

  // Winners
  getWinners: () => api.request('/winners/'),
  getLatestWinners: () => api.request('/winners/latest/'),

  // Quests
  getQuests: () => api.request('/quests/'),
  completeQuest: (questId) =>
    api.request(`/quests/${questId}/complete/`, {
      method: 'POST',
    }),

  // Reports
  createReport: (reportData) =>
    api.request('/reports/create/', {
      method: 'POST',
      body: JSON.stringify(reportData),
    }),
  getAdminReports: (status = null, type = null) => {
    let url = '/admin/reports/';
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (type) params.append('type', type);
    if (params.toString()) url += '?' + params.toString();
    return api.request(url);
  },
  getAdminReportDetail: (reportId) =>
    api.request(`/admin/reports/${reportId}/`),
  updateAdminReport: (reportId, data) =>
    api.request(`/admin/reports/${reportId}/`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getAdminReportsStats: () => api.request('/admin/reports/stats/'),

  // Trending hashtags
  getTrendingHashtags: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.request(`/explorer/trending-hashtags/${qs ? '?' + qs : ''}`);
  },

  // Search by hashtag
  searchByHashtag: (hashtag) =>
    api.request(`/reels/?hashtags__icontains=${encodeURIComponent(hashtag)}`),

  // Delete account
  deleteAccount: (payload = { confirm: true }) =>
    api.request('/auth/delete-account/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Download data
  downloadData: () => api.request('/auth/download-data/'),

};

// Initialize on load
initAuthToken().catch(err => {
  console.error('API: Failed to initialize auth token:', err);
});

export default api;

