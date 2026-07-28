import { loadConfig } from "./config";
import { Reconciler } from "./core/reconciler";
import { DockerClient } from "./docker/client";
import { Watcher } from "./docker/watcher";
import { createProvider } from "./providers/provider";
import "./providers/log";
import "./providers/cloudflare/cloudflare";

const config = loadConfig();
console.log(`dockroute starting (provider=${config.provider}, sock=${config.dockerSock})`);

const docker = new DockerClient(config.dockerSock);
const provider = createProvider(config.provider, config);
const reconciler = new Reconciler(docker, provider, { defaultTarget: config.defaultTarget });

const watcher = new Watcher(docker, reconciler, config.resyncSeconds);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, shutting down`);
    watcher.stop();
    process.exit(0);
  });
}

await watcher.start();
