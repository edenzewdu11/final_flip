export const CryptoErrorCode = {
  KEYPAIR_UNAVAILABLE: 'crypto/keypair-unavailable',
  SERVER_KEY_UNAVAILABLE: 'crypto/server-key-unavailable',
  SERVER_KEY_INVALID: 'crypto/server-key-invalid',
  ENCRYPT_FAILED: 'crypto/encrypt-failed',
  DECRYPT_FAILED: 'crypto/decrypt-failed',
  CHECKSUM_MISMATCH: 'crypto/checksum-mismatch',
  MALFORMED_ENVELOPE: 'crypto/malformed-envelope',
  REPLAY_REJECTED: 'crypto/replay-rejected',
  NOT_CONFIGURED: 'crypto/not-configured',
};

const SAFE_MESSAGES = {
  [CryptoErrorCode.KEYPAIR_UNAVAILABLE]: 'Secure keys are unavailable on this device.',
  [CryptoErrorCode.SERVER_KEY_UNAVAILABLE]: 'Could not establish a secure channel with the server.',
  [CryptoErrorCode.SERVER_KEY_INVALID]: 'The server presented an unusable encryption key.',
  [CryptoErrorCode.ENCRYPT_FAILED]: 'The request could not be secured.',
  [CryptoErrorCode.DECRYPT_FAILED]: 'The response could not be verified.',
  [CryptoErrorCode.CHECKSUM_MISMATCH]: 'The response failed its integrity check.',
  [CryptoErrorCode.MALFORMED_ENVELOPE]: 'The response was not in the expected secure format.',
  [CryptoErrorCode.REPLAY_REJECTED]: 'This request was already submitted. Please try again.',
  [CryptoErrorCode.NOT_CONFIGURED]: 'The secure channel has not been initialised.',
};

export class CryptoError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] || 'A security error occurred.');
    this.name = 'CryptoError';
    this.code = code;
    this.isCryptoError = true;
  }
}

export function isCryptoError(error) {
  return Boolean(error && error.isCryptoError);
}
