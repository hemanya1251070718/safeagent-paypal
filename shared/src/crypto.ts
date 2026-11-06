import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Deterministic JSON serialization: sorts all object keys recursively.
 * Guarantees byte-for-byte identity across browser and Node.js.
 */
export function canonicalJsonStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }

  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map(key => {
    return JSON.stringify(key) + ':' + canonicalJsonStringify(obj[key]);
  });

  return '{' + parts.join(',') + '}';
}

/**
 * Convert Uint8Array to Hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert Hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * SHA-256 digest computation using pure @noble/hashes (works in browser and Node)
 */
export function sha256Hex(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBytes = sha256(bytes);
  return bytesToHex(hashBytes);
}
