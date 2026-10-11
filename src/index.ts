import { loadConfig } from "./config";
import { Reconciler } from "./core/reconciler";
import { DockerClient } from "./docker/client";
import { describeDockerEndpoint } from "./docker/endpoint";
import { diagnoseSocketAccess } from "./docker/preflight";
import { Watcher } from "./docker/watcher";
import { touchHeartbeat } from "./health";
import { createProvider } from "./providers/provider";
import "./providers/log";
import "./providers/cloudflare/cloudflare";

const config = loadConfig();
const dockerHost = describeDockerEndpoint(config.docker);
console.log(`dockroute starting (provider=${config.provider}, docker=${dockerHost})`);

const docker = new DockerClient(config.docker);

try {
  await docker.ping();
} catch (err) {
  const diagnosis =
    config.docker.kind === "unix" ? await diagnoseSocketAccess(config.docker.socketPath) : null;
  console.error(
    `[docker] ${diagnosis ?? `Cannot reach the Docker Engine at ${dockerHost}: ${err}`}`,
  );
  process.exit(1);
}
const provider = createProvider(config.provider, config);
const reconciler = new Reconciler(docker, provider, { defaultTarget: config.defaultTarget }, () =>
  touchHeartbeat(),
);

const watcher = new Watcher(docker, reconciler, config.resyncSeconds);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, shutting down`);
    watcher.stop();
    process.exit(0);
  });
}

await watcher.start();
