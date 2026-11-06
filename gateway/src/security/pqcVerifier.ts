import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { canonicalJsonStringify, hexToBytes } from '../../../shared/dist/index.js';

export interface PqcVerificationResult {
  valid: boolean;
  algorithm: string;
  error?: string;
}

export function verifyMandateSignature(
  mandate: any,
  publicKeyHex: string,
  signatureHex: string
): PqcVerificationResult {
  try {
    const canonicalJson = canonicalJsonStringify(mandate);
    const messageBytes = new TextEncoder().encode(canonicalJson);
    const publicKeyBytes = hexToBytes(publicKeyHex);
    const signatureBytes = hexToBytes(signatureHex);

    // NIST FIPS 204 ML-DSA verification
    const isValid = ml_dsa65.verify(publicKeyBytes, messageBytes, signatureBytes);

    return {
      valid: isValid,
      algorithm: "NIST-FIPS-204-ML-DSA-65"
    };
  } catch (err: any) {
    return {
      valid: false,
      algorithm: "NIST-FIPS-204-ML-DSA-65",
      error: err.message
    };
  }
}

