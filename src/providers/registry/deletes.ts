import { parseTxtName } from "./ownership";
import type { RegistryRecord } from "./planner";

/**
 * Ownership rule for executing deletes, provider-agnostic: an ownership TXT
 * is removed only after its data record is gone. Providers delete the data
 * records first, collect the ones whose delete failed, and then run only the
 * TXT deletes this returns.
 *
 * Withholding the TXT keeps the ownership proof for a record that still
 * exists, so the next reconcile plans (and retries) both deletes again. A TXT
 * whose data record is not in the plan at all (a dangling TXT) is still
 * returned, so dangling cleanup keeps working.
 */
export function txtDeletesSafeToRun(
  deletes: RegistryRecord[],
  failedDataDeletes: RegistryRecord[],
  txtPrefix: string,
): RegistryRecord[] {
  const failed = new Set(failedDataDeletes.map((r) => `${r.type}:${r.hostname}`));
  return deletes.filter((record) => {
    if (record.type !== "TXT") return false;
    const tracked = parseTxtName(record.hostname, txtPrefix);
    return !tracked || !failed.has(`${tracked.type}:${tracked.hostname}`);
  });
}
