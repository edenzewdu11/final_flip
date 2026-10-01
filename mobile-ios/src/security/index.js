import { canonicalJson } from './codec';
import { isEncryptedRoute } from './encryptedRoutes';
import { isEnvelope, seal, open } from './envelope';
import { CryptoErrorCode, isCryptoError } from './errors';
import { getKeyPair, getClientPublicKey, rotateKeyPair } from './keystore';
import { getServerPublicKey, refreshServerPublicKey, setServerKeyLoader } from './serverKey';

export { isCryptoError, getClientPublicKey, rotateKeyPair, isEncryptedRoute };

export function configureEncryption({ serverKeyLoader }) {
  setServerKeyLoader(serverKeyLoader);
}

export async function ensureEncryptionReady() {
  await Promise.all([getKeyPair(), getServerPublicKey()]);
}

function parseIfJson(plaintext) {
  try {
    return JSON.parse(plaintext);
  } catch (error) {
    return plaintext;
  }
}

export async function encryptRequestBody(endpoint, body) {
  if (!isEncryptedRoute(endpoint)) return null;
  if (body === undefined || body === null || body === '') return null;

  const plaintext = typeof body === 'string' ? body : canonicalJson(body);
  const [keyPair, serverPublicKey] = await Promise.all([getKeyPair(), getServerPublicKey()]);
  const envelope = await seal(plaintext, serverPublicKey, keyPair.secretKeyBytes);
  return JSON.stringify(envelope);
}

export async function decryptResponseBody(data) {
  if (!isEnvelope(data)) return data;

  const [keyPair, serverPublicKey] = await Promise.all([getKeyPair(), getServerPublicKey()]);

  try {
    return parseIfJson(await open(data, serverPublicKey, keyPair.secretKeyBytes));
  } catch (error) {
    if (!isCryptoError(error) || error.code !== CryptoErrorCode.DECRYPT_FAILED) throw error;
    const rotated = await refreshServerPublicKey();
    if (rotated === serverPublicKey) throw error;
    return parseIfJson(await open(data, rotated, keyPair.secretKeyBytes));
  }
}
