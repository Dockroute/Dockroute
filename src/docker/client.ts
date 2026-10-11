import type { ContainerInfo } from "../core/types";
import type { DockerEndpoint } from "./endpoint";

/**
 * Minimal, read-only Docker Engine API client. It only ever issues `GET`
 * requests to `/_ping`, `/containers/json` and `/events`, so a socket proxy
 * can allow exactly those. Bun's fetch supports unix sockets natively via the
 * `unix` option; tcp endpoints are plain HTTP.
 */
export class DockerClient {
  constructor(private endpoint: DockerEndpoint) {}

  private async get(path: string, signal?: AbortSignal): Promise<Response> {
    const res =
      this.endpoint.kind === "unix"
        ? await fetch(`http://docker${path}`, { unix: this.endpoint.socketPath, signal })
        : await fetch(`${this.endpoint.baseUrl}${path}`, { signal });
    if (!res.ok) throw new Error(await describeFailure(res));
    return res;
  }

  /** Cheap connectivity check against the Engine's /_ping endpoint. */
  async ping(): Promise<void> {
    await this.get("/_ping");
  }

  async listRunningContainers(): Promise<ContainerInfo[]> {
    const res = await this.get("/containers/json");
    return (await res.json()) as ContainerInfo[];
  }

  /**
   * Streams container lifecycle events. Yields once per relevant event;
   * callers only use it as a reconcile trigger, so the payload is discarded.
   */
  async *containerEvents(signal?: AbortSignal): AsyncGenerator<void> {
    const filters = JSON.stringify({
      type: ["container"],
      event: ["start", "die", "stop", "destroy"],
    });
    const res = await this.get(`/events?filters=${encodeURIComponent(filters)}`, signal);
    if (!res.body) throw new Error("Docker events API returned no body");
    for await (const _chunk of res.body) {
      yield;
    }
  }
}

async function describeFailure(res: Response): Promise<string> {
  const message = `Docker API ${res.status}: ${await res.text()}`;
  if (res.status !== 403) return message;
  return (
    `${message}. If DOCKER_HOST points at a socket proxy, make sure it allows ` +
    `GET /_ping, /containers/json and /events.`
  );
}
