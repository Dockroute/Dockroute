import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

/**
 * Diagnoses why the Docker socket at `sockPath` is unusable and returns an
 * actionable message, or null when the socket looks fine (so a connection
 * failure must have another cause). Bun's fetch collapses every unix-socket
 * connect error into one generic code, hence the filesystem-level diagnosis.
 */
export async function diagnoseSocketAccess(sockPath: string): Promise<string | null> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(sockPath);
  } catch {
    return (
      `Docker socket not found at ${sockPath}. ` +
      `Mount it into the container: -v /var/run/docker.sock:/var/run/docker.sock:ro ` +
      `(or point DOCKER_SOCK at its path).`
    );
  }

  if (!info.isSocket()) {
    return (
      `${sockPath} exists but is not a unix socket. ` +
      `This usually means the bind mount source was missing on the host, ` +
      `so Docker created an empty directory in its place.`
    );
  }

  try {
    await access(sockPath, constants.R_OK | constants.W_OK);
  } catch {
    return (
      `Permission denied reading the Docker socket at ${sockPath} ` +
      `(owned by gid ${info.gid}). Run the container without a user override ` +
      `so the entrypoint can drop privileges itself, or add that group ` +
      `explicitly: group_add: ["${info.gid}"].`
    );
  }

  return null;
}
