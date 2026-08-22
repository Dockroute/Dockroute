import type { Policy } from "../../config";
import type { CfIngressRule } from "./api";

/**
 * Pure merge of DockRoute-managed routes into a tunnel's ingress list.
 *
 * Cloudflare's tunnel configuration PUT replaces the WHOLE ingress list, so
 * the merge must never clobber rules DockRoute does not manage. A rule is
 * managed iff its hostname is in managedHostnames (derived from the TXT
 * ownership registry by the caller). Output order:
 *   unmanaged rules (original order) + managed rules (sorted) + catch-all.
 * Unmanaged rules keep their original position first so a pre-existing rule
 * never starts being shadowed by ours.
 */

export interface DesiredIngressRoute {
  hostname: string;
  service: string;
}

export interface MergeIngressInput {
  current: CfIngressRule[];
  desired: DesiredIngressRoute[];
  managedHostnames: Set<string>;
  /**
   * Managed hostnames that are no longer desired but whose DNS deletion is
   * still serving its grace window. Their rule is kept verbatim so a restart
   * never leaves the tunnel and the zone disagreeing about a hostname.
   */
  retainHostnames?: Set<string>;
  policy: Policy;
}

export interface MergeIngressResult {
  ingress: CfIngressRule[];
  changed: boolean;
  /** Hostnames whose desired route was skipped because an unmanaged rule claims them. */
  conflicts: string[];
}

const CATCH_ALL: CfIngressRule = { service: "http_status:404" };

export function mergeIngress({
  current,
  desired,
  managedHostnames,
  retainHostnames = new Set(),
  policy,
}: MergeIngressInput): MergeIngressResult {
  const last = current[current.length - 1];
  const catchAll = last && last.hostname === undefined ? last : CATCH_ALL;
  const rules = last && last.hostname === undefined ? current.slice(0, -1) : current;

  const unmanaged = rules.filter(
    (r) => r.hostname === undefined || !managedHostnames.has(r.hostname),
  );
  const existingManaged = rules.filter(
    (r) => r.hostname !== undefined && managedHostnames.has(r.hostname),
  );
  const unmanagedHostnames = new Set(
    unmanaged.map((r) => r.hostname).filter((h) => h !== undefined),
  );

  const conflicts = desired
    .filter((d) => unmanagedHostnames.has(d.hostname))
    .map((d) => d.hostname);
  const wanted = desired.filter((d) => !unmanagedHostnames.has(d.hostname));

  const managed = mergeManaged(existingManaged, wanted, policy, retainHostnames);
  managed.sort((a, b) => (a.hostname ?? "").localeCompare(b.hostname ?? ""));

  if (existingManaged.length === 0 && managed.length === 0) {
    // Nothing of ours in the tunnel and nothing to add — leave it untouched
    // (avoids writing a catch-all into a tunnel we have no business with).
    return { ingress: current, changed: false, conflicts };
  }

  const ingress = [...unmanaged, ...managed, catchAll];
  return {
    ingress,
    changed: JSON.stringify(ingress) !== JSON.stringify(current),
    conflicts,
  };
}

function mergeManaged(
  existing: CfIngressRule[],
  wanted: DesiredIngressRoute[],
  policy: Policy,
  retainHostnames: Set<string>,
): CfIngressRule[] {
  const existingByHostname = new Map(existing.map((r) => [r.hostname, r]));
  // Preserve extra per-rule settings (e.g. originRequest) when updating our rules.
  const updated = wanted.map((d) => ({
    ...existingByHostname.get(d.hostname),
    hostname: d.hostname,
    service: d.service,
  }));
  const wantedHostnames = new Set(wanted.map((d) => d.hostname));
  const orphans = existing.filter((r) => !wantedHostnames.has(r.hostname as string));

  switch (policy) {
    case "sync":
      return [...updated, ...orphans.filter((r) => retainHostnames.has(r.hostname as string))];
    case "upsert-only":
      return [...updated, ...orphans];
    case "create-only":
      return [...existing, ...updated.filter((r) => !existingByHostname.has(r.hostname))];
  }
}
