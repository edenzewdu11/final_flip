// Offline self-test for the E2E encryption layer.
// Simulates both sides of the handshake locally (no network / no real
// server needed) using the exact same seal()/open() code paths used in
// production. Useful for verifying the crypto works BEFORE the staging
// server's TLS certificate issue is fixed.
//
// Usage (temporary, e.g. from App.js or a debug screen):
//   import { runCryptoSelfTest } from './src/security/selfTest';
//   runCryptoSelfTest().then((result) => console.log('Crypto self-test:', result));

import nacl from 'tweetnacl';
import { seal, open } from './envelope';
import { canonicalJson, toBase64 } from './codec';

export async function runCryptoSelfTest() {
  const results = [];
  let allPassed = true;

  const record = (name, passed, detail) => {
    results.push({ name, passed, detail });
    if (!passed) allPassed = false;
  };

  try {
    // 1. Generate two keypairs locally: pretend one is "client" (this app)
    //    and one is "server" (normally fetched from /crypto/public-key/).
    const clientKeyPair = nacl.box.keyPair();
    const serverKeyPair = nacl.box.keyPair();

    const clientPublicB64 = toBase64(clientKeyPair.publicKey);
    const serverPublicB64 = toBase64(serverKeyPair.publicKey);

    record('Keypair generation', clientKeyPair.publicKey.length === 32 && serverKeyPair.publicKey.length === 32);

    // 2. Client seals a request body "to" the server, using the server's
    //    public key + the client's own secret key (this mirrors
    //    encryptRequestBody in security/index.js).
    const payload = { phone: '0975979406', password: 'test-password-123' };
    const plaintext = canonicalJson(payload);

    const envelope = await seal(plaintext, serverPublicB64, clientKeyPair.secretKey);
    record(
      'Seal (encrypt) produces a valid envelope',
      typeof envelope.encrypted === 'string' && typeof envelope.nonce === 'string' && typeof envelope.checksum === 'string'
    );

    // 3. "Server" opens what the client sent, using the client's public key
    //    + the server's own secret key. This is the same nacl.box math the
    //    real backend performs.
    const decryptedByServer = await open(envelope, clientPublicB64, serverKeyPair.secretKey);
    record('Server-side open() recovers original plaintext', decryptedByServer === plaintext, {
      expected: plaintext,
      got: decryptedByServer,
    });

    // 4. Round trip the other way: "server" seals a response back to the
    //    client, client opens it (mirrors decryptResponseBody).
    const responsePlaintext = canonicalJson({ token: 'fake-token', user: { id: 1 } });
    const responseEnvelope = await seal(responsePlaintext, clientPublicB64, serverKeyPair.secretKey);
    const decryptedByClient = await open(responseEnvelope, serverPublicB64, clientKeyPair.secretKey);
    record('Client-side open() recovers server response', decryptedByClient === responsePlaintext);

    // 5. Tamper detection: flipping a byte in the ciphertext must fail to
    //    decrypt (proves authentication, not just encryption, is enforced).
    let tamperDetected = false;
    try {
      const tampered = { ...envelope, encrypted: envelope.encrypted.slice(0, -4) + 'AAAA' };
      await open(tampered, clientPublicB64, serverKeyPair.secretKey);
    } catch (error) {
      tamperDetected = Boolean(error && error.isCryptoError);
    }
    record('Tampered ciphertext is rejected', tamperDetected);

    // 6. Wrong-key detection: opening with an unrelated keypair must fail.
    let wrongKeyRejected = false;
    try {
      const strangerKeyPair = nacl.box.keyPair();
      const strangerPublicB64 = toBase64(strangerKeyPair.publicKey);
      await open(envelope, strangerPublicB64, serverKeyPair.secretKey);
    } catch (error) {
      wrongKeyRejected = Boolean(error && error.isCryptoError);
    }
    record('Envelope opened with wrong key pair is rejected', wrongKeyRejected);
  } catch (error) {
    record('Unexpected error during self-test', false, error && error.message);
  }

  return { passed: allPassed, results };
}
