/** Where the Docker Engine API lives: a local unix socket or a plain-HTTP tcp listener. */
export type DockerEndpoint =
  | { kind: "unix"; socketPath: string }
  | { kind: "tcp"; baseUrl: string };

const DEFAULT_SOCKET = "/var/run/docker.sock";
const DEFAULT_TCP_PORT = "2375";

/**
 * Resolves the Docker endpoint the way the Docker CLI does: `DOCKER_HOST`
 * first, then the legacy `DOCKER_SOCK` path, then the standard socket.
 * Only `unix://` and plain `tcp://host[:port]` are supported; `tcp://` is meant
 * for a socket proxy on an internal network, so there is no TLS, and
 * credentials, query or fragment are rejected rather than silently dropped.
 * Blank values mean unset, since Portainer and Unraid submit cleared fields as
 * empty strings.
 */
export function resolveDockerEndpoint(env: Record<string, string | undefined>): DockerEndpoint {
  const host = env.DOCKER_HOST?.trim();
  if (host) return parseDockerHost(host);
  return { kind: "unix", socketPath: env.DOCKER_SOCK?.trim() || DEFAULT_SOCKET };
}

/** Renders an endpoint the way `DOCKER_HOST` spells it, for logs and errors. */
export function describeDockerEndpoint(endpoint: DockerEndpoint): string {
  return endpoint.kind === "unix"
    ? `unix://${endpoint.socketPath}`
    : endpoint.baseUrl.replace(/^http:/, "tcp:");
}

function parseDockerHost(value: string): DockerEndpoint {
  if (value.startsWith("unix://")) {
    const socketPath = value.slice("unix://".length);
    if (socketPath.startsWith("/")) return { kind: "unix", socketPath };
  } else if (value.startsWith("tcp://")) {
    const url = URL.parse(value);
    const hostOnly = url && !url.username && !url.password && !url.search && !url.hash;
    if (hostOnly && url.hostname && (url.pathname === "" || url.pathname === "/")) {
      return { kind: "tcp", baseUrl: `http://${url.hostname}:${url.port || DEFAULT_TCP_PORT}` };
    }
  }
  throw new Error(
    `Invalid DOCKER_HOST "${redactUserinfo(value)}". Expected unix:///path/to/docker.sock or tcp://host:port.`,
  );
}

/**
 * Masks everything between the scheme and the last `@`, so a rejected value
 * never leaks credentials into logs. A malformed value has no reliable end of
 * userinfo (passwords may hold `@` or `/`), so the mask errs on hiding more.
 */
function redactUserinfo(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 0) return value;
  const scheme = value.match(/^[a-z]+:\/\//i)?.[0] ?? "";
  return `${scheme}***${value.slice(at)}`;
}
