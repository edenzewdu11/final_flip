import nacl from 'tweetnacl';

import { toBase64, fromBase64, toBytes, toText, sha256Hex } from './codec';
import { CryptoError, CryptoErrorCode } from './errors';

const KEY_LENGTH = 32;
const NONCE_LENGTH = nacl.box.nonceLength;
const ENVELOPE_FIELDS = ['encrypted', 'nonce', 'checksum'];

export function isEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== ENVELOPE_FIELDS.length) return false;
  return ENVELOPE_FIELDS.every((field) => typeof value[field] === 'string' && value[field].length > 0);
}

export async function seal(plaintext, serverPublicKeyB64, secretKeyBytes) {
  const serverKeyBytes = fromBase64(serverPublicKeyB64, KEY_LENGTH);
  if (!serverKeyBytes) throw new CryptoError(CryptoErrorCode.SERVER_KEY_INVALID);

  let ciphertext;
  let nonce;
  try {
    nonce = nacl.randomBytes(NONCE_LENGTH);
    ciphertext = nacl.box(toBytes(plaintext), nonce, serverKeyBytes, secretKeyBytes);
  } catch (error) {
    throw new CryptoError(CryptoErrorCode.ENCRYPT_FAILED);
  }
  if (!ciphertext) throw new CryptoError(CryptoErrorCode.ENCRYPT_FAILED);

  return {
    encrypted: toBase64(ciphertext),
    nonce: toBase64(nonce),
    checksum: await sha256Hex(plaintext),
  };
}

export async function open(envelope, serverPublicKeyB64, secretKeyBytes) {
  if (!isEnvelope(envelope)) throw new CryptoError(CryptoErrorCode.MALFORMED_ENVELOPE);

  const serverKeyBytes = fromBase64(serverPublicKeyB64, KEY_LENGTH);
  if (!serverKeyBytes) throw new CryptoError(CryptoErrorCode.SERVER_KEY_INVALID);

  const ciphertext = fromBase64(envelope.encrypted);
  const nonce = fromBase64(envelope.nonce, NONCE_LENGTH);
  if (!ciphertext || !nonce) throw new CryptoError(CryptoErrorCode.MALFORMED_ENVELOPE);

  let opened;
  try {
    opened = nacl.box.open(ciphertext, nonce, serverKeyBytes, secretKeyBytes);
  } catch (error) {
    throw new CryptoError(CryptoErrorCode.DECRYPT_FAILED);
  }
  if (!opened) throw new CryptoError(CryptoErrorCode.DECRYPT_FAILED);

  let plaintext;
  try {
    plaintext = toText(opened);
  } catch (error) {
    throw new CryptoError(CryptoErrorCode.DECRYPT_FAILED);
  }

  const checksum = await sha256Hex(plaintext);
  if (checksum !== envelope.checksum) throw new CryptoError(CryptoErrorCode.CHECKSUM_MISMATCH);

  return plaintext;
}
