import { type DockerEndpoint, resolveDockerEndpoint } from "./docker/endpoint";
import { nonBlank } from "./env";

export const POLICIES = ["sync", "upsert-only", "create-only"] as const;
export type Policy = (typeof POLICIES)[number];

const DEFAULT_RESYNC_SECONDS = 60;
const DEFAULT_DELETE_GRACE_SECONDS = 60;

export interface CloudflareConfig {
  apiToken?: string;
  accountId?: string;
  tunnelId?: string;
}

export interface Config {
  docker: DockerEndpoint;
  provider: string;
  defaultTarget?: string;
  resyncSeconds: number;
  ownerId: string;
  policy: Policy;
  /**
   * How long a record must be continuously absent from the desired state
   * before its deletion is executed. Protects against container restarts,
   * where deleting the record costs far more than the outage itself.
   * `0` deletes as soon as the container leaves the running set.
   */
  deleteGraceSeconds: number;
  txtPrefix: string;
  /** Optional allowlist of zones DockRoute may touch. Empty = all. */
  domainFilter: string[];
  cloudflare: CloudflareConfig;
}

export function loadConfig(env = process.env): Config {
  const policy = nonBlank(env.DOCKROUTE_POLICY) ?? "sync";
  if (!POLICIES.includes(policy as Policy)) {
    throw new Error(`Invalid DOCKROUTE_POLICY "${policy}". Valid values: ${POLICIES.join(", ")}`);
  }

  const provider = nonBlank(env.DOCKROUTE_PROVIDER) ?? "log";
  const cloudflare: CloudflareConfig = {
    apiToken: nonBlank(env.CLOUDFLARE_API_TOKEN),
    accountId: nonBlank(env.CLOUDFLARE_ACCOUNT_ID),
    tunnelId: nonBlank(env.CLOUDFLARE_TUNNEL_ID),
  };
  if (provider === "cloudflare" && !cloudflare.apiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is required when DOCKROUTE_PROVIDER=cloudflare");
  }

  return {
    docker: resolveDockerEndpoint(env),
    provider,
    defaultTarget: nonBlank(env.DOCKROUTE_DEFAULT_TARGET),
    resyncSeconds: secondsFromEnv(
      "DOCKROUTE_RESYNC_SECONDS",
      env.DOCKROUTE_RESYNC_SECONDS,
      DEFAULT_RESYNC_SECONDS,
      1,
    ),
    ownerId: ownerIdFromEnv(env.DOCKROUTE_OWNER_ID),
    policy: policy as Policy,
    deleteGraceSeconds: secondsFromEnv(
      "DOCKROUTE_DELETE_GRACE_SECONDS",
      env.DOCKROUTE_DELETE_GRACE_SECONDS,
      DEFAULT_DELETE_GRACE_SECONDS,
      0,
    ),
    txtPrefix: txtPrefixFromEnv(env.DOCKROUTE_TXT_PREFIX),
    domainFilter: (env.DOCKROUTE_DOMAIN_FILTER ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    cloudflare,
  };
}

/**
 * The owner id is written into every ownership TXT and must parse back
 * unchanged, or DockRoute treats its own records as foreign. Surrounding
 * whitespace is trimmed (the parser trims it anyway); a comma splits the TXT
 * payload, so it is rejected. Nothing else is rewritten: the owner id is an
 * identity, and changing it would orphan existing records.
 */
function ownerIdFromEnv(raw: string | undefined): string {
  const ownerId = nonBlank(raw)?.trim() ?? "default";
  if (ownerId.includes(",")) {
    throw new Error(`Invalid DOCKROUTE_OWNER_ID "${ownerId}". It must not contain a comma (",").`);
  }
  return ownerId;
}

/**
 * The TXT prefix becomes the start of the first DNS label of every ownership
 * TXT name, and providers return names in lower case. Anything other than one
 * lower-case label fragment cannot be parsed back.
 */
function txtPrefixFromEnv(raw: string | undefined): string {
  const prefix = nonBlank(raw)?.trim() ?? "_dockroute-";
  if (!/^[a-z0-9_-]+$/.test(prefix)) {
    throw new Error(
      `Invalid DOCKROUTE_TXT_PREFIX "${prefix}". Allowed characters: a-z, 0-9, "_" and "-" (lower case, no dots).`,
    );
  }
  return prefix;
}

/**
 * Reads a numeric env var. A blank value means "not set": Portainer and Unraid
 * submit a cleared optional field as an empty string, and that has to mean the
 * default, never a fatal error. `min` is inclusive.
 */
function secondsFromEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Invalid ${name} "${raw}". Expected a number of seconds >= ${min}.`);
  }
  return value;
}
