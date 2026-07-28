import type { Policy } from "../../config";
import type { RecordType } from "../../core/types";
import {
  formatOwnershipContent,
  parseOwnershipContent,
  parseTxtName,
  txtNameFor,
} from "./ownership";

/**
 * Pure, provider-agnostic reconciliation planner. Providers map their wire
 * records into RegistryRecords, run planChanges(), and execute the plan.
 * All ownership and policy rules live here so every provider behaves the same.
 */

export type RegistryRecordType = RecordType | "TXT";

export interface RegistryRecord {
  hostname: string;
  type: RegistryRecordType;
  /** Record value: target for data records, ownership payload for TXT. */
  content: string;
  ttl: number;
  /** Normalized provider hints; compared as part of "did the record change". */
  providerSpecific?: Record<string, string>;
  /** Informational resource written into the ownership TXT (desired only). */
  resource?: string;
}

export interface Conflict {
  hostname: string;
  type: RegistryRecordType;
  reason: string;
}

export interface Plan {
  creates: RegistryRecord[];
  /** New desired values; the provider matches the existing record by hostname+type. */
  updates: RegistryRecord[];
  /** Actual records to remove. */
  deletes: RegistryRecord[];
  conflicts: Conflict[];
}

export interface PlanInput {
  /** Desired data records (no TXT), already deduped by hostname+type. */
  desired: RegistryRecord[];
  /** Actual records at the provider, including TXT. */
  actual: RegistryRecord[];
  ownerId: string;
  txtPrefix: string;
  policy: Policy;
}

export function planChanges({ desired, actual, ownerId, txtPrefix, policy }: PlanInput): Plan {
  const plan: Plan = { creates: [], updates: [], deletes: [], conflicts: [] };

  const dataByKey = new Map<string, RegistryRecord>();
  const ownershipByKey = new Map<string, { owner: string; txt: RegistryRecord }>();

  for (const record of actual) {
    if (record.type === "TXT") {
      const txtName = parseTxtName(record.hostname, txtPrefix);
      const ownership = txtName && parseOwnershipContent(record.content);
      if (txtName && ownership) {
        ownershipByKey.set(key(txtName.type, txtName.hostname), { owner: ownership.owner, txt: record });
      }
    } else if (!dataByKey.has(key(record.type, record.hostname))) {
      dataByKey.set(key(record.type, record.hostname), record);
    }
  }

  const desiredKeys = new Set<string>();
  for (const want of desired) {
    if (want.type === "TXT") continue; // registry TXTs are planner-internal
    const k = key(want.type, want.hostname);
    desiredKeys.add(k);
    const existing = dataByKey.get(k);
    const ownership = ownershipByKey.get(k);

    if (existing) {
      if (!ownership) {
        conflict(plan, want, `record exists but has no ownership TXT — not managed by dockroute`);
      } else if (ownership.owner !== ownerId) {
        conflict(plan, want, `record is owned by "${ownership.owner}", not "${ownerId}"`);
      } else if (policy !== "create-only" && differs(existing, want)) {
        plan.updates.push(want);
      }
      continue;
    }

    if (ownership && ownership.owner !== ownerId) {
      conflict(plan, want, `hostname is claimed by owner "${ownership.owner}" (dangling ownership TXT)`);
      continue;
    }

    plan.creates.push(want);
    if (!ownership) {
      plan.creates.push({
        hostname: txtNameFor(want.hostname, want.type, txtPrefix),
        type: "TXT",
        content: formatOwnershipContent({ owner: ownerId, resource: want.resource }),
        ttl: want.ttl,
      });
    }
  }

  if (policy === "sync") {
    for (const [k, { owner, txt }] of ownershipByKey) {
      if (owner !== ownerId || desiredKeys.has(k)) continue;
      const orphan = dataByKey.get(k);
      if (orphan) plan.deletes.push(orphan);
      plan.deletes.push(txt);
    }
  }

  return plan;
}

function key(type: RegistryRecordType, hostname: string): string {
  return `${type}:${hostname}`;
}

function conflict(plan: Plan, record: RegistryRecord, reason: string): void {
  plan.conflicts.push({ hostname: record.hostname, type: record.type, reason });
}

function differs(existing: RegistryRecord, want: RegistryRecord): boolean {
  return (
    existing.content !== want.content ||
    existing.ttl !== want.ttl ||
    !shallowEqual(existing.providerSpecific ?? {}, want.providerSpecific ?? {})
  );
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((k) => a[k] === b[k]);
}
