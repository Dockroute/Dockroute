import type { Config } from "../config";
import type { DesiredState } from "../core/types";

/**
 * A DNS provider receives the FULL desired state on every reconcile and owns
 * the diff against its actual state (create / update / delete). Providers
 * without tunnel support must warn and skip tunnelRoutes, never throw.
 */
export interface Provider {
  readonly name: string;
  sync(desired: DesiredState): Promise<void>;
}

type ProviderFactory = (config: Config) => Provider;

const registry = new Map<string, ProviderFactory>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  registry.set(name, factory);
}

export function createProvider(name: string, config: Config): Provider {
  const factory = registry.get(name);
  if (!factory) {
    const known = [...registry.keys()].join(", ");
    throw new Error(`Unknown provider "${name}". Available: ${known}`);
  }
  return factory(config);
}
