import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { fromBase64 } from './codec';
import { CryptoError, CryptoErrorCode } from './errors';

const SERVER_KEY_ITEM = 'flipstar.e2ee.serverPublicKey.v2_uat';
const KEY_LENGTH = 32;
const usesSecureStore = Platform.OS !== 'web';

let cached = null;
let inflight = null;
let loader = null;

export function setServerKeyLoader(fn) {
  loader = fn;
}

async function readPersisted() {
  if (!usesSecureStore) return null;
  try {
    const stored = await SecureStore.getItemAsync(SERVER_KEY_ITEM);
    return fromBase64(stored, KEY_LENGTH) ? stored : null;
  } catch (error) {
    return null;
  }
}

async function persist(value) {
  if (!usesSecureStore) return;
  try {
    await SecureStore.setItemAsync(SERVER_KEY_ITEM, value);
  } catch (error) {
    /* cache is an optimisation, not a requirement */
  }
}

async function fetchFromServer() {
  if (!loader) throw new CryptoError(CryptoErrorCode.NOT_CONFIGURED);

  let payload;
  try {
    payload = await loader();
  } catch (error) {
    throw new CryptoError(CryptoErrorCode.SERVER_KEY_UNAVAILABLE);
  }

  const publicKey = payload && (payload.publicKey || payload.public_key || payload.data?.publicKey || payload.data?.public_key);
  if (!publicKey || !fromBase64(publicKey, KEY_LENGTH)) {
    throw new CryptoError(CryptoErrorCode.SERVER_KEY_INVALID);
  }

  await persist(publicKey);
  return publicKey;
}

export async function getServerPublicKey() {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      cached = await fetchFromServer();
    } catch (error) {
      const persisted = await readPersisted();
      if (!persisted) throw error;
      cached = persisted;
    }
    return cached;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function refreshServerPublicKey() {
  cached = null;
  inflight = null;
  cached = await fetchFromServer();
  return cached;
}
