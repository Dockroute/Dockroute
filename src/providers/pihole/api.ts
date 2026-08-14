/**
 * Thin Pi-hole v6 REST API client (the v5 legacy API is not supported).
 * All Pi-hole wire shapes live here and in the sibling provider file — they
 * must never leak into src/core/ (ACL). Exported as an interface so tests
 * inject an in-memory fake.
 *
 * Local A/AAAA records are `"IP hostname"` entries in the `dns.hosts` config
 * array; CNAMEs are `"source,target[,ttl]"` entries in `dns.cnameRecords`.
 * Entries are added/removed one at a time via the item endpoints.
 */

export interface PiholeApi {
  getHosts(): Promise<string[]>;
  addHost(entry: string): Promise<void>;
  deleteHost(entry: string): Promise<void>;
  getCnameRecords(): Promise<string[]>;
  addCnameRecord(entry: string): Promise<void>;
  deleteCnameRecord(entry: string): Promise<void>;
}

interface PiholeAuthResponse {
  session?: { valid?: boolean; sid?: string | null };
}

interface PiholeConfigResponse {
  config?: { dns?: { hosts?: string[]; cnameRecords?: string[] } };
}

interface PiholeErrorResponse {
  error?: { key?: string; message?: string; hint?: string | null };
}

export class PiholeFetchApi implements PiholeApi {
  private baseUrl: string;
  private sid: string | null = null;

  constructor(
    url: string,
    private password: string,
  ) {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  async getHosts(): Promise<string[]> {
    const res = await this.request<PiholeConfigResponse>("/api/config/dns/hosts", "GET");
    return res.config?.dns?.hosts ?? [];
  }

  async addHost(entry: string): Promise<void> {
    await this.request(`/api/config/dns/hosts/${encodeURIComponent(entry)}`, "PUT");
  }

  async deleteHost(entry: string): Promise<void> {
    await this.request(`/api/config/dns/hosts/${encodeURIComponent(entry)}`, "DELETE");
  }

  async getCnameRecords(): Promise<string[]> {
    const res = await this.request<PiholeConfigResponse>("/api/config/dns/cnameRecords", "GET");
    return res.config?.dns?.cnameRecords ?? [];
  }

  async addCnameRecord(entry: string): Promise<void> {
    await this.request(`/api/config/dns/cnameRecords/${encodeURIComponent(entry)}`, "PUT");
  }

  async deleteCnameRecord(entry: string): Promise<void> {
    await this.request(`/api/config/dns/cnameRecords/${encodeURIComponent(entry)}`, "DELETE");
  }

  private async request<T>(path: string, method: string): Promise<T> {
    if (!this.sid) await this.authenticate();
    let res = await this.rawRequest(path, method);
    if (res.status === 401) {
      // Session expired — re-authenticate once and retry.
      await this.authenticate();
      res = await this.rawRequest(path, method);
    }
    if (!res.ok) throw await this.toError(path, method, res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async rawRequest(path: string, method: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "X-FTL-SID": this.sid ?? "" },
    });
  }

  private async authenticate(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: this.password }),
    });
    const payload = (await res.json().catch(() => null)) as PiholeAuthResponse | null;
    const sid = payload?.session?.valid ? payload.session.sid : null;
    if (!res.ok || !sid) {
      throw new Error(`Pi-hole authentication failed (HTTP ${res.status}) — check PIHOLE_PASSWORD`);
    }
    this.sid = sid;
  }

  private async toError(path: string, method: string, res: Response): Promise<Error> {
    const payload = (await res.json().catch(() => null)) as PiholeErrorResponse | null;
    const details = payload?.error?.message ?? `HTTP ${res.status}`;
    return new Error(`Pi-hole API ${method} ${path} failed — ${details}`);
  }
}
