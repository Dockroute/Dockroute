import { isIP, isIPv4, isIPv6 } from "node:net";
import type { ContainerInfo, DesiredState, DnsRecord, RecordType } from "./types";

const PREFIX = "dockroute.";
const RECORD_TYPES: RecordType[] = ["A", "AAAA", "CNAME"];
const DEFAULT_TTL = 300;
const TUNNEL_SERVICE_SCHEMES = ["http:", "https:", "tcp:", "ssh:"];

/** Label keys with a fixed meaning; everything else under dockroute.* with a
 * dotted suffix (e.g. cloudflare.proxied) is passed through as a provider hint. */
const KNOWN_KEYS = new Set(["enabled", "hostname", "type", "target", "ttl", "tunnel.service"]);

export interface ParseOptions {
  defaultTarget?: string;
}

export const emptyDesiredState = (): DesiredState => ({ records: [], tunnelRoutes: [] });

/**
 * Turns a container's dockroute.* labels into its desired state (DNS records
 * or tunnel routes). Returns an empty state for containers that are not opted
 * in or are misconfigured (misconfiguration is logged, never fatal).
 */
export function desiredFromContainer(
  container: ContainerInfo,
  opts: ParseOptions = {},
): DesiredState {
  const labels = container.Labels ?? {};
  if (labels[`${PREFIX}enabled`] !== "true") return emptyDesiredState();

  const name = container.Names?.[0] ?? container.Id.slice(0, 12);

  const hostnames = (labels[`${PREFIX}hostname`] ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hostnames.length === 0) {
    console.warn(`[labels] ${name}: dockroute.enabled but no dockroute.hostname, skipping`);
    return emptyDesiredState();
  }

  const tunnelService = labels[`${PREFIX}tunnel.service`];
  if (tunnelService !== undefined) {
    return tunnelState(container, name, hostnames, tunnelService, labels);
  }
  return dnsState(container, name, hostnames, labels, opts);
}

function tunnelState(
  container: ContainerInfo,
  name: string,
  hostnames: string[],
  service: string,
  labels: Record<string, string>,
): DesiredState {
  if (labels[`${PREFIX}type`] !== undefined || labels[`${PREFIX}target`] !== undefined) {
    console.warn(
      `[labels] ${name}: dockroute.tunnel.service set, ignoring dockroute.type/dockroute.target`,
    );
  }
  if (!isValidServiceUrl(service)) {
    console.warn(
      `[labels] ${name}: invalid dockroute.tunnel.service "${service}" ` +
        `(expected ${TUNNEL_SERVICE_SCHEMES.map((s) => `${s}//`).join(", ")}), skipping`,
    );
    return emptyDesiredState();
  }

  return {
    records: [],
    tunnelRoutes: hostnames.map((hostname) => ({
      hostname,
      service,
      source: container.Id,
    })),
  };
}

function dnsState(
  container: ContainerInfo,
  name: string,
  hostnames: string[],
  labels: Record<string, string>,
  opts: ParseOptions,
): DesiredState {
  const rawType = (labels[`${PREFIX}type`] ?? "A").toUpperCase();
  if (!RECORD_TYPES.includes(rawType as RecordType)) {
    console.warn(`[labels] ${name}: unsupported record type "${rawType}", skipping`);
    return emptyDesiredState();
  }

  const target = labels[`${PREFIX}target`] ?? opts.defaultTarget;
  if (!target) {
    console.warn(`[labels] ${name}: no dockroute.target and no default target, skipping`);
    return emptyDesiredState();
  }
  const type = rawType as RecordType;
  if (!isValidTarget(type, target)) {
    console.warn(
      `[labels] ${name}: dockroute.target "${target}" is not a valid ${targetRequirement(type)}, skipping`,
    );
    return emptyDesiredState();
  }

  const rawTtl = labels[`${PREFIX}ttl`];
  const parsedTtl = Number(rawTtl ?? DEFAULT_TTL);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : DEFAULT_TTL;
  if (rawTtl !== undefined && ttl !== parsedTtl) {
    console.warn(`[labels] ${name}: invalid dockroute.ttl "${rawTtl}", using ${DEFAULT_TTL}`);
  }
  const providerSpecific = providerHints(labels);

  const records: DnsRecord[] = hostnames.map((hostname) => ({
    hostname,
    type,
    target,
    ttl,
    source: container.Id,
    ...(providerSpecific ? { providerSpecific } : {}),
  }));
  return { records, tunnelRoutes: [] };
}

function isValidTarget(type: RecordType, target: string): boolean {
  switch (type) {
    case "A":
      return isIPv4(target);
    case "AAAA":
      return isIPv6(target);
    case "CNAME":
      return target.trim().length > 0 && isIP(target.trim()) === 0;
  }
}

function targetRequirement(type: RecordType): string {
  switch (type) {
    case "A":
      return "IPv4 address for an A record";
    case "AAAA":
      return "IPv6 address for an AAAA record";
    case "CNAME":
      return "hostname for a CNAME record";
  }
}

function isValidServiceUrl(service: string): boolean {
  try {
    return TUNNEL_SERVICE_SCHEMES.includes(new URL(service).protocol);
  } catch {
    return false;
  }
}

/** Collects dockroute.<provider>.<key> labels (e.g. cloudflare.proxied). */
function providerHints(labels: Record<string, string>): Record<string, string> | undefined {
  let hints: Record<string, string> | undefined;
  for (const [key, value] of Object.entries(labels)) {
    if (!key.startsWith(PREFIX)) continue;
    const suffix = key.slice(PREFIX.length);
    if (KNOWN_KEYS.has(suffix) || !suffix.includes(".")) continue;
    hints ??= {};
    hints[suffix] = value;
  }
  return hints;
}
