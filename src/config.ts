export const POLICIES = ["sync", "upsert-only", "create-only"] as const;
export type Policy = (typeof POLICIES)[number];

export interface CloudflareConfig {
  apiToken?: string;
  accountId?: string;
  tunnelId?: string;
}

export interface Config {
  dockerSock: string;
  provider: string;
  defaultTarget?: string;
  resyncSeconds: number;
  ownerId: string;
  policy: Policy;
  txtPrefix: string;
  /** Optional allowlist of zones DockRoute may touch. Empty = all. */
  domainFilter: string[];
  cloudflare: CloudflareConfig;
}

export function loadConfig(env = process.env): Config {
  const policy = env.DOCKROUTE_POLICY ?? "sync";
  if (!POLICIES.includes(policy as Policy)) {
    throw new Error(
      `Invalid DOCKROUTE_POLICY "${policy}". Valid values: ${POLICIES.join(", ")}`,
    );
  }

  const provider = env.DOCKROUTE_PROVIDER ?? "log";
  const cloudflare: CloudflareConfig = {
    apiToken: env.CLOUDFLARE_API_TOKEN,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    tunnelId: env.CLOUDFLARE_TUNNEL_ID,
  };
  if (provider === "cloudflare" && !cloudflare.apiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is required when DOCKROUTE_PROVIDER=cloudflare");
  }

  return {
    dockerSock: env.DOCKER_SOCK ?? "/var/run/docker.sock",
    provider,
    defaultTarget: env.DOCKROUTE_DEFAULT_TARGET,
    resyncSeconds: Number(env.DOCKROUTE_RESYNC_SECONDS ?? 60),
    ownerId: env.DOCKROUTE_OWNER_ID ?? "default",
    policy: policy as Policy,
    txtPrefix: env.DOCKROUTE_TXT_PREFIX ?? "_dockroute-",
    domainFilter: (env.DOCKROUTE_DOMAIN_FILTER ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    cloudflare,
  };
}
