import { describe, expect, it } from 'vitest';
import {
  decryptString,
  deriveCodeChallenge,
  encryptString,
  generateCodeVerifier,
  generateState,
  timingSafeEqual,
} from '../src/crypto.js';

/** A valid AES-256 key: 32 bytes, base64-encoded. */
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));

describe('encryptString / decryptString', () => {
  it('round-trips a plaintext', async () => {
    const encrypted = await encryptString('super-secret-token', KEY);
    expect(encrypted).not.toContain('super-secret-token');
    expect(await decryptString(encrypted, KEY)).toBe('super-secret-token');
  });

  it('produces a different ciphertext each time (random IV)', async () => {
    const a = await encryptString('same input', KEY);
    const b = await encryptString('same input', KEY);
    expect(a).not.toBe(b);
    expect(await decryptString(a, KEY)).toBe(await decryptString(b, KEY));
  });

  it('rejects a key that is not 32 bytes', async () => {
    const shortKey = btoa('too-short');
    await expect(encryptString('data', shortKey)).rejects.toThrow(/32 bytes/);
  });

  it('rejects a malformed payload', async () => {
    await expect(decryptString('no-separator', KEY)).rejects.toThrow(/Malformed/);
  });

  it('fails to decrypt with the wrong key', async () => {
    const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    const encrypted = await encryptString('data', KEY);
    await expect(decryptString(encrypted, otherKey)).rejects.toThrow();
  });
});

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('PKCE helpers', () => {
  it('generates a verifier within the RFC 7636 length bounds', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('derives a stable, URL-safe S256 challenge', async () => {
    const challenge = await deriveCodeChallenge('test-verifier');
    expect(challenge).toBe(await deriveCodeChallenge('test-verifier'));
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('derives different challenges for different verifiers', async () => {
    expect(await deriveCodeChallenge('a')).not.toBe(await deriveCodeChallenge('b'));
  });

  it('generates unique URL-safe state values', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
