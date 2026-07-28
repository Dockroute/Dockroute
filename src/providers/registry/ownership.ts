import type { RecordType } from "../../core/types";

/**
 * ExternalDNS-style TXT ownership registry (provider-agnostic).
 *
 * Every data record DockRoute manages gets a companion TXT record:
 *   name:    <prefix><type-lowercase>.<hostname>   e.g. _dockroute-a.whoami.example.com
 *   content: heritage=dockroute,dockroute/owner=<ownerId>[,dockroute/resource=<resource>]
 *
 * A record is "owned" only when the companion TXT exists, carries
 * heritage=dockroute AND the matching owner id. DockRoute never modifies or
 * deletes anything it does not own.
 */

const HERITAGE = "dockroute";

export interface Ownership {
  owner: string;
  /** Informational only (e.g. container/whoami); never used for ownership checks. */
  resource?: string;
}

export function formatOwnershipContent(ownership: Ownership): string {
  const parts = [`heritage=${HERITAGE}`, `dockroute/owner=${ownership.owner}`];
  if (ownership.resource) parts.push(`dockroute/resource=${ownership.resource}`);
  return parts.join(",");
}

/** Parses TXT content; returns undefined unless heritage=dockroute. */
export function parseOwnershipContent(content: string): Ownership | undefined {
  const fields = new Map<string, string>();
  for (const part of stripQuotes(content).split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) return undefined;
    fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  if (fields.get("heritage") !== HERITAGE) return undefined;
  const owner = fields.get("dockroute/owner");
  if (owner === undefined) return undefined;
  return { owner, resource: fields.get("dockroute/resource") };
}

export function txtNameFor(hostname: string, type: RecordType, prefix: string): string {
  return `${prefix}${type.toLowerCase()}.${hostname}`;
}

export interface TxtName {
  hostname: string;
  type: RecordType;
}

/** Reverses txtNameFor; returns undefined for TXT names not in registry format. */
export function parseTxtName(name: string, prefix: string): TxtName | undefined {
  const [first, ...rest] = name.split(".");
  if (!first || rest.length === 0 || !first.startsWith(prefix)) return undefined;
  const type = first.slice(prefix.length).toUpperCase();
  if (type !== "A" && type !== "AAAA" && type !== "CNAME") return undefined;
  return { hostname: rest.join("."), type };
}

/** Providers may hand back TXT content wrapped in quotes; normalize it. */
function stripQuotes(content: string): string {
  return content.length >= 2 && content.startsWith('"') && content.endsWith('"')
    ? content.slice(1, -1)
    : content;
}
