import type { ContainerInfo, DesiredState } from "./types";

/**
 * Where the core reads running containers from. Implemented by the Docker
 * adapter (`src/docker/client.ts`), so the core never depends on it directly.
 */
export interface ContainerSource {
  listRunningContainers(): Promise<ContainerInfo[]>;
}

/**
 * A DNS provider receives the FULL desired state on every reconcile and owns
 * the diff against its actual state (create / update / delete). Providers
 * without tunnel support must warn and skip tunnelRoutes, never throw.
 */
export interface Provider {
  readonly name: string;
  sync(desired: DesiredState): Promise<void>;
}
