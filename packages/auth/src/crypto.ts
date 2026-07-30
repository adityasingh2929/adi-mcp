const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
  }
  return crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['encrypt', 'decrypt']);
}

/** Encrypts a UTF-8 string with AES-256-GCM. Output is `base64(iv) + "." + base64(ciphertext)`. */
export async function encryptString(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

/** Reverses {@link encryptString}. Throws if the payload is malformed or the key is wrong. */
export async function decryptString(payload: string, base64Key: string): Promise<string> {
  const [ivPart, ciphertextPart] = payload.split('.');
  if (!ivPart || !ciphertextPart) {
    throw new Error('Malformed encrypted payload.');
  }
  const key = await importKey(base64Key);
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: fromBase64(ivPart) },
    key,
    fromBase64(ciphertextPart),
  );
  return new TextDecoder().decode(plaintext);
}

/** Constant-time string comparison, used for bearer-token checks to avoid timing leaks. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Generates a PKCE `code_verifier` (RFC 7636 §4.1): 43-128 chars of unreserved ASCII. */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

/** Derives the S256 `code_challenge` for a PKCE verifier (RFC 7636 §4.2). */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/** Cryptographically random, URL-safe value for OAuth `state`. */
export function generateState(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
