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
        `(expected ${TUNNEL_SERVICE_SCHEMES.map((s) => s + "//").join(", ")}), skipping`,
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

  const ttl = Number(labels[`${PREFIX}ttl`] ?? DEFAULT_TTL);
  const providerSpecific = providerHints(labels);

  const records: DnsRecord[] = hostnames.map((hostname) => ({
    hostname,
    type: rawType as RecordType,
    target,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL,
    source: container.Id,
    ...(providerSpecific ? { providerSpecific } : {}),
  }));
  return { records, tunnelRoutes: [] };
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
    (hints ??= {})[suffix] = value;
  }
  return hints;
}
