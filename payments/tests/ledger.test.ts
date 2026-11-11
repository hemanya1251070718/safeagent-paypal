import { describe, expect, it } from 'vitest';
import { computeMerkleRoot, ImmutableLedger } from '../src/ledger.js';

describe('ImmutableLedger & Merkle root', () => {
  it('detects ledger tampering when an event payload is modified', () => {
    const testLedger = new ImmutableLedger();
    testLedger.append('MANDATE_CREATED', { mandateId: 'm1', maxSpend: 5000 }, 'm1');
    testLedger.append('PAYPAL_ORDER_CREATED', { intentId: 'int_1', total: 1200 }, 'm1', 'int_1');
    testLedger.append('PAYPAL_CAPTURE_COMPLETED', { intentId: 'int_1', amount: 1200 }, 'm1', 'int_1');

    expect(testLedger.verifyIntegrity()).toBe(true);
    const before = testLedger.getVerificationStatus();
    expect(before.valid).toBe(true);
    expect(before.eventCount).toBe(3);

    // Tamper with an earlier event's data payload
    const events = testLedger.getAll();
    events[1].data.total = 999999;

    expect(testLedger.verifyIntegrity()).toBe(false);
    expect(testLedger.getVerificationStatus().valid).toBe(false);
  });

  it('computes deterministic SHA-256 Merkle roots and duplicates the last node on odd counts', () => {
    const h1 = 'a'.repeat(64);
    const h2 = 'b'.repeat(64);
    const h3 = 'c'.repeat(64);
    const h4 = 'd'.repeat(64);

    // Deterministic across repeated calls
    const rootOdd1 = computeMerkleRoot([h1, h2, h3]);
    const rootOdd2 = computeMerkleRoot([h1, h2, h3]);
    expect(rootOdd1).toMatch(/^[0-9a-f]{64}$/);
    expect(rootOdd1).toBe(rootOdd2);

    // Odd count duplicates the last node before hashing
    const rootExplicitDup = computeMerkleRoot([h1, h2, h3, h3]);
    expect(rootOdd1).toBe(rootExplicitDup);

    // Different input or order yields a different Merkle root
    expect(computeMerkleRoot([h1, h2, h3, h4])).not.toBe(rootOdd1);
    expect(computeMerkleRoot([h2, h1, h3])).not.toBe(rootOdd1);
  });
});
