// Guards the CLI's own direct fetches (the free site read, logos and ad creatives) so a domain
// argument, a provider URL or a redirect cannot make the CLI read the local network or a cloud
// metadata address. Only http(s) on ports 80 and 443, only public addresses, every redirect hop
// checked again.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Returns every address a hostname resolves to. Tests pass a fake. */
export type Resolver = (hostname: string) => Promise<string[]>;

/** Resolves a hostname to all of its IPv4 and IPv6 addresses with the system resolver. */
export const lookupAll: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
}

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4ToInt(base) / 2 ** (32 - bits)));
}

/** Expands an IPv6 address to 8 numbers, with a trailing dotted IPv4 turned into 2 groups. */
function v6Groups(ip: string): number[] {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = s.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

/** True for loopback, private, CGNAT, link-local, metadata, multicast and reserved addresses, v4 or v6. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/%.*$/, ""));
  if (kind === 4) return isBlockedV4(ip);
  if (kind !== 6) return true;
  const g = v6Groups(ip);
  const v4 = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and the old IPv4-compatible form
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedV4(v4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedV4(v4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedV4(v4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local, includes fd00:ec2::254
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/**
 * Throws when the URL is not one the CLI may fetch: not http(s), a port other than 80 or 443,
 * credentials in the URL, or a host that is or resolves to a non-public address. With no resolver
 * only IP literals and localhost names are checked.
 */
export async function assertPublicUrl(raw: string, resolve?: Resolver): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`refused ${raw}: not a URL`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`refused ${u.protocol} URL: only http and https`);
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error(`refused port ${u.port}: only 80 and 443`);
  if (u.username || u.password) throw new Error("refused a URL with a user name or password");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new Error("refused a URL with no host");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`refused ${host}: not a public address`);
    return u;
  }
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) throw new Error(`refused ${host}: not a public host name`);
  if (resolve) {
    let addrs: string[];
    try {
      addrs = await resolve(host);
    } catch (e) {
      throw new Error(`could not resolve ${host}: ${(e as Error).message}`);
    }
    if (!addrs.length) throw new Error(`could not resolve ${host}`);
    const bad = addrs.find(isPrivateAddress);
    if (bad) throw new Error(`refused ${host}: it resolves to ${bad}, not a public address`);
  }
  return u;
}

/**
 * fetch with the URL guard on the first request and on every redirect hop (redirects are followed
 * by hand, at most 5). Throws on a refused URL or too many redirects.
 */
export async function guardedFetch(url: string, init: RequestInit, o: { fetch: typeof fetch; resolve?: Resolver; maxRedirects?: number }): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const u = await assertPublicUrl(current, o.resolve);
    const res = await o.fetch(u.toString(), { ...init, redirect: "manual" });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) return res;
    if (hop >= (o.maxRedirects ?? 5)) throw new Error("too many redirects");
    current = new URL(loc, u).toString();
  }
}

/** The resolver to use with an injected fetch: real DNS for the global fetch, none for a test fake. */
export function defaultResolver(f: typeof fetch): Resolver | undefined {
  return f === globalThis.fetch ? lookupAll : undefined;
}
