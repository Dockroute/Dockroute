import type { Config } from "../config";
import type { Provider } from "../core/ports";

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
