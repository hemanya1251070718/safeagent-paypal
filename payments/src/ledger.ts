import { createHash } from 'node:crypto';
import { LedgerEvent, LedgerEventType } from '../../shared/dist/index.js';

/**
 * Computes a deterministic SHA-256 Merkle root over an array of hex hashes.
 * When the node count at any tree level is odd, the last node is duplicated.
 */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return createHash('sha256').update('').digest('hex');
  }

  let level = [...hashes];
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(level[level.length - 1]);
    }
    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const combined = `${level[i]}${level[i + 1]}`;
      nextLevel.push(createHash('sha256').update(combined).digest('hex'));
    }
    level = nextLevel;
  }

  return level[0];
}

export class ImmutableLedger {
  private events: LedgerEvent[] = [];
  private genesisHash = "0000000000000000000000000000000000000000000000000000000000000000";

  public append(type: LedgerEventType, data: Record<string, any>, mandateId?: string, intentId?: string): LedgerEvent {
    const previousHash = this.events.length > 0
      ? this.events[this.events.length - 1].hash
      : this.genesisHash;

    const index = this.events.length;
    const timestamp = new Date().toISOString();
    const eventId = `evt_${Date.now()}_${index}`;

    // Hash = SHA256(previousHash + timestamp + type + data)
    const contentToHash = `${previousHash}|${timestamp}|${type}|${JSON.stringify(data)}`;
    const hash = createHash('sha256').update(contentToHash).digest('hex');

    const event: LedgerEvent = {
      eventId,
      index,
      timestamp,
      previousHash,
      hash,
      type,
      mandateId,
      intentId,
      data
    };

    this.events.push(event);
    return event;
  }

  public getAll(): LedgerEvent[] {
    return [...this.events];
  }

  public getByIntent(intentId: string): LedgerEvent[] {
    return this.events.filter(e => e.intentId === intentId);
  }

  public getHeadHash(): string {
    return this.events.length > 0
      ? this.events[this.events.length - 1].hash
      : this.genesisHash;
  }

  public verifyIntegrity(): boolean {
    let prev = this.genesisHash;
    for (const evt of this.events) {
      if (evt.previousHash !== prev) return false;
      const contentToHash = `${evt.previousHash}|${evt.timestamp}|${evt.type}|${JSON.stringify(evt.data)}`;
      const expectedHash = createHash('sha256').update(contentToHash).digest('hex');
      if (evt.hash !== expectedHash) return false;
      prev = evt.hash;
    }
    return true;
  }

  public getVerificationStatus(): { valid: boolean; eventCount: number; headHash: string } {
    return {
      valid: this.verifyIntegrity(),
      eventCount: this.events.length,
      headHash: this.getHeadHash()
    };
  }
}

export const ledger = new ImmutableLedger();

