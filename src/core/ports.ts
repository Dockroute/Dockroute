import type { ContainerInfo } from "./types";

/**
 * Where the core reads running containers from. Implemented by the Docker
 * adapter (`src/docker/client.ts`), so the core never depends on it directly.
 */
export interface ContainerSource {
  listRunningContainers(): Promise<ContainerInfo[]>;
}
