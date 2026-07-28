/**
 * Thin Cloudflare v4 API client. All Cloudflare wire types live here and in
 * the sibling provider files — they must never leak into src/core/ (ACL).
 * Exported as an interface so tests inject an in-memory fake.
 */

const BASE_URL = "https://api.cloudflare.com/client/v4";
const PER_PAGE = 100;

export interface CfZone {
  id: string;
  name: string;
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
}

export type CfDnsRecordInput = Omit<CfDnsRecord, "id">;

export interface CfIngressRule {
  hostname?: string;
  service: string;
  path?: string;
  /** Cloudflare allows extra per-rule settings; preserved verbatim. */
  [key: string]: unknown;
}

/** Remotely-managed tunnel configuration. Unknown fields are preserved on PUT. */
export interface CfTunnelConfig {
  ingress?: CfIngressRule[];
  [key: string]: unknown;
}

export interface CloudflareApi {
  listZones(): Promise<CfZone[]>;
  listDnsRecords(zoneId: string): Promise<CfDnsRecord[]>;
  createDnsRecord(zoneId: string, record: CfDnsRecordInput): Promise<void>;
  updateDnsRecord(zoneId: string, recordId: string, record: CfDnsRecordInput): Promise<void>;
  deleteDnsRecord(zoneId: string, recordId: string): Promise<void>;
  getTunnelConfig(accountId: string, tunnelId: string): Promise<CfTunnelConfig | null>;
  putTunnelConfig(accountId: string, tunnelId: string, config: CfTunnelConfig): Promise<void>;
}

interface CfResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; total_pages: number };
}

export class CloudflareFetchApi implements CloudflareApi {
  constructor(private apiToken: string) {}

  async listZones(): Promise<CfZone[]> {
    return this.paginate<CfZone>("/zones");
  }

  async listDnsRecords(zoneId: string): Promise<CfDnsRecord[]> {
    return this.paginate<CfDnsRecord>(`/zones/${zoneId}/dns_records`);
  }

  async createDnsRecord(zoneId: string, record: CfDnsRecordInput): Promise<void> {
    await this.request(`/zones/${zoneId}/dns_records`, "POST", record);
  }

  async updateDnsRecord(zoneId: string, recordId: string, record: CfDnsRecordInput): Promise<void> {
    await this.request(`/zones/${zoneId}/dns_records/${recordId}`, "PUT", record);
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request(`/zones/${zoneId}/dns_records/${recordId}`, "DELETE");
  }

  async getTunnelConfig(accountId: string, tunnelId: string): Promise<CfTunnelConfig | null> {
    const result = await this.request<{ config: CfTunnelConfig | null }>(
      `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      "GET",
    );
    return result.config ?? null;
  }

  async putTunnelConfig(accountId: string, tunnelId: string, config: CfTunnelConfig): Promise<void> {
    await this.request(
      `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      "PUT",
      { config },
    );
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1, totalPages = 1; page <= totalPages; page++) {
      const res = await this.rawRequest<T[]>(`${path}?page=${page}&per_page=${PER_PAGE}`, "GET");
      items.push(...res.result);
      totalPages = res.result_info?.total_pages ?? 1;
    }
    return items;
  }

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    return (await this.rawRequest<T>(path, method, body)).result;
  }

  private async rawRequest<T>(path: string, method: string, body?: unknown): Promise<CfResponse<T>> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const payload = (await res.json().catch(() => null)) as CfResponse<T> | null;
    if (!res.ok || !payload?.success) {
      const details =
        payload?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ?? `HTTP ${res.status}`;
      throw new Error(`Cloudflare API ${method} ${path} failed — ${details}`);
    }
    return payload;
  }
}
