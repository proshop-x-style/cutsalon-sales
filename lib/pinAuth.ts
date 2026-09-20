export const PIN_HASH_KEY = 'salon-ledger-shared-pin-hash';
export const PIN_SESSION_KEY = 'salon-ledger-pin-session';
export const PIN_FAILURE_KEY = 'salon-ledger-pin-failures';
export const PIN_LOCKED_KEY = 'salon-ledger-pin-locked';
export const DEFAULT_SHARED_PIN = '1214';
export const MAX_PIN_FAILURES = 10;

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const toFallbackHash = (input: string) => {
  // Fallback for browsers/environments where SubtleCrypto is unavailable.
  const bytes = new TextEncoder().encode(input);
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const hasSubtleCrypto = () => {
  return typeof globalThis !== 'undefined' && !!globalThis.crypto && !!globalThis.crypto.subtle;
};

export async function hashPin(pin: string) {
  const normalized = pin.trim();
  if (!normalized) {
    throw new Error('PIN is required');
  }

  if (!hasSubtleCrypto()) {
    return toFallbackHash(normalized);
  }

  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return toFallbackHash(normalized);
  }
}

export async function getExpectedPinHash() {
  if (typeof window !== 'undefined') {
    const storedHash = window.localStorage.getItem(PIN_HASH_KEY);
    if (storedHash) {
      return storedHash;
    }
  }

  const configuredPin = (process.env.NEXT_PUBLIC_APP_PIN ?? DEFAULT_SHARED_PIN).trim();
  return hashPin(configuredPin);
}

export async function saveSharedPin(pin: string) {
  const normalized = pin.trim();
  if (!normalized) {
    throw new Error('PIN is required');
  }

  const hash = await hashPin(normalized);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PIN_HASH_KEY, hash);
  }
  return hash;
}

export async function verifySharedPin(pin: string) {
  const expected = await getExpectedPinHash();
  const actual = await hashPin(pin);
  return expected === actual;
}

export function getPinFailureCount() {
  if (typeof window === 'undefined') {
    return 0;
  }

  const raw = window.localStorage.getItem(PIN_FAILURE_KEY);
  if (!raw) {
    return 0;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function incrementPinFailureCount() {
  if (typeof window === 'undefined') {
    return 0;
  }

  const next = getPinFailureCount() + 1;
  window.localStorage.setItem(PIN_FAILURE_KEY, String(next));
  return next;
}

export function resetPinFailureCount() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(PIN_FAILURE_KEY);
}

export function isPinLocked() {
  if (typeof window === 'undefined') {
    return false;
  }

  const raw = window.localStorage.getItem(PIN_LOCKED_KEY);
  if (!raw) {
    return false;
  }

  try {
    const payload = JSON.parse(raw) as { lockedUntil?: number };
    if (!payload.lockedUntil) {
      return false;
    }

    if (payload.lockedUntil <= Date.now()) {
      window.localStorage.removeItem(PIN_LOCKED_KEY);
      return false;
    }

    return true;
  } catch {
    window.localStorage.removeItem(PIN_LOCKED_KEY);
    return false;
  }
}

export function lockPin() {
  if (typeof window === 'undefined') {
    return;
  }

  const lockedUntil = Date.now() + DEFAULT_SESSION_TTL_MS;
  window.localStorage.setItem(PIN_LOCKED_KEY, JSON.stringify({ lockedUntil }));
}

export function isPinSessionAlive() {
  if (typeof window === 'undefined') {
    return false;
  }

  const raw = window.localStorage.getItem(PIN_SESSION_KEY);
  if (!raw) {
    return false;
  }

  try {
    const payload = JSON.parse(raw) as { expiresAt?: number };
    if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
      window.localStorage.removeItem(PIN_SESSION_KEY);
      return false;
    }

    return true;
  } catch {
    window.localStorage.removeItem(PIN_SESSION_KEY);
    return false;
  }
}

export function storePinSession() {
  if (typeof window === 'undefined') {
    return;
  }

  const expiresAt = Date.now() + DEFAULT_SESSION_TTL_MS;
  window.localStorage.setItem(PIN_SESSION_KEY, JSON.stringify({ expiresAt }));
}

export function clearPinSession() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(PIN_SESSION_KEY);
}
