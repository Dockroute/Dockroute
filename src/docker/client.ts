import type { ContainerInfo } from "../core/types";

/**
 * Minimal Docker Engine API client over the unix socket.
 * Bun's fetch supports unix sockets natively via the `unix` option.
 */
export class DockerClient {
  constructor(private sockPath: string) {}

  private fetch(path: string): Promise<Response> {
    return fetch(`http://docker${path}`, { unix: this.sockPath });
  }

  /** Cheap connectivity check against the Engine's /_ping endpoint. */
  async ping(): Promise<void> {
    const res = await this.fetch("/_ping");
    if (!res.ok) throw new Error(`Docker API ${res.status}: ${await res.text()}`);
  }

  async listRunningContainers(): Promise<ContainerInfo[]> {
    const res = await this.fetch("/containers/json");
    if (!res.ok) throw new Error(`Docker API ${res.status}: ${await res.text()}`);
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
    const res = await fetch(`http://docker/events?filters=${encodeURIComponent(filters)}`, {
      unix: this.sockPath,
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Docker events API ${res.status}`);
    }
    for await (const _chunk of res.body) {
      yield;
    }
  }
}
