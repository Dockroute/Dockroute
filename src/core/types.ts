export type RecordType = "A" | "AAAA" | "CNAME";

export interface DnsRecord {
  hostname: string;
  type: RecordType;
  target: string;
  ttl: number;
  /** Container id that produced this record (ownership/debugging). */
  source: string;
  /** Opaque provider hints from dockroute.<provider>.* labels (e.g. cloudflare.proxied). */
  providerSpecific?: Record<string, string>;
}

/** A hostname published through a tunnel to an origin service inside the stack. */
export interface TunnelRoute {
  hostname: string;
  /** Origin service URL, e.g. "http://whoami:8080". */
  service: string;
  /** Container id that produced this route. */
  source: string;
}

/** The full desired state assembled from all running containers. */
export interface DesiredState {
  records: DnsRecord[];
  tunnelRoutes: TunnelRoute[];
}

/** The subset of the Docker container payload DockRoute cares about. */
export interface ContainerInfo {
  Id: string;
  Names: string[];
  Labels: Record<string, string>;
  State: string;
}
