import * as Crypto from 'expo-crypto';
import naclUtil from 'tweetnacl-util';

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function toBase64(bytes) {
  return naclUtil.encodeBase64(bytes);
}

export function fromBase64(value, expectedLength) {
  if (typeof value !== 'string' || value.length === 0 || !BASE64_PATTERN.test(value)) {
    return null;
  }
  let bytes;
  try {
    bytes = naclUtil.decodeBase64(value);
  } catch (error) {
    return null;
  }
  if (typeof expectedLength === 'number' && bytes.length !== expectedLength) {
    return null;
  }
  return bytes;
}

export function toBytes(text) {
  return naclUtil.decodeUTF8(text);
}

export function toText(bytes) {
  return naclUtil.encodeUTF8(bytes);
}

export async function sha256Hex(text) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}
