import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

import { toBase64, fromBase64 } from './codec';
import { CryptoError, CryptoErrorCode } from './errors';

const PUBLIC_KEY_ITEM = 'flipstar.e2ee.publicKey.v1';
const PRIVATE_KEY_ITEM = 'flipstar.e2ee.privateKey.v1';
const KEY_LENGTH = 32;

const usesSecureStore = Platform.OS !== 'web';

let cachedKeyPair = null;
let loading = null;

nacl.setPRNG((buffer, length) => {
  const random = Crypto.getRandomBytes(length);
  for (let i = 0; i < length; i += 1) {
    buffer[i] = random[i];
  }
});

async function readItem(key) {
  if (!usesSecureStore) return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    return null;
  }
}

async function writeItem(key, value) {
  if (!usesSecureStore) return false;
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function deleteItem(key) {
  if (!usesSecureStore) return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    /* nothing recoverable */
  }
}

async function restore() {
  const [publicKey, privateKey] = await Promise.all([
    readItem(PUBLIC_KEY_ITEM),
    readItem(PRIVATE_KEY_ITEM),
  ]);
  if (!publicKey || !privateKey) return null;

  const publicBytes = fromBase64(publicKey, KEY_LENGTH);
  const secretBytes = fromBase64(privateKey, KEY_LENGTH);
  if (!publicBytes || !secretBytes) return null;

  return { publicKey, publicKeyBytes: publicBytes, secretKeyBytes: secretBytes };
}

async function create() {
  let generated;
  try {
    generated = nacl.box.keyPair();
  } catch (error) {
    throw new CryptoError(CryptoErrorCode.KEYPAIR_UNAVAILABLE);
  }
  if (!generated || generated.publicKey.length !== KEY_LENGTH) {
    throw new CryptoError(CryptoErrorCode.KEYPAIR_UNAVAILABLE);
  }

  const publicKey = toBase64(generated.publicKey);
  await Promise.all([
    writeItem(PUBLIC_KEY_ITEM, publicKey),
    writeItem(PRIVATE_KEY_ITEM, toBase64(generated.secretKey)),
  ]);

  return {
    publicKey,
    publicKeyBytes: generated.publicKey,
    secretKeyBytes: generated.secretKey,
  };
}

export async function getKeyPair() {
  if (cachedKeyPair) return cachedKeyPair;
  if (loading) return loading;

  loading = (async () => {
    const restored = await restore();
    cachedKeyPair = restored || (await create());
    return cachedKeyPair;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function getClientPublicKey() {
  const keyPair = await getKeyPair();
  return keyPair.publicKey;
}

export async function rotateKeyPair() {
  cachedKeyPair = null;
  await Promise.all([deleteItem(PUBLIC_KEY_ITEM), deleteItem(PRIVATE_KEY_ITEM)]);
  cachedKeyPair = await create();
  return cachedKeyPair.publicKey;
}
