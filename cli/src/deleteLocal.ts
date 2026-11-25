// `looot-zeus delete`: removes the local private output that may hold contacts.
// Retention: local contacts stay only until you run delete; we recommend deleting after 30 days.

import { existsSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve } from "node:path";

/** The Zeus output names inside the output folder that delete removes. Nothing else there is touched. */
export const OUTPUT_NAMES = [
  "people.csv", "accounts.csv", "committee.csv", "results.csv", "state.json", "snapshot.json", "signals.json", "social.json", "ads.json",
  "competitors.json", "candidates.json", "receipt.json", "receipt.md", "dossier.html", "dossier.md", "plays.md", "changes.md", "next-run.md",
  "learnings.json", "learnings.md", "exports", "city", "assets", "intake", "outreach", "learn-demo", "public",
] as const;

/** Thrown when the output folder is not a folder inside the project. */
export class UnsafeDeleteError extends Error {}

/** Checks the output folder is strictly inside the project folder, not the project, a parent, outside it or the root. */
export function checkOutDir(outDir: string, projectDir: string): string {
  const p = resolve(projectDir);
  const out = resolve(p, outDir);
  const rel = relative(p, out);
  if (out === parse(out).root || !rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new UnsafeDeleteError(`Refusing to delete from ${out}: the output folder must be a folder inside ${p}, not the project itself, a parent, the root or anything outside it.`);
  }
  return out;
}

/** Lists every known Zeus output path that delete would remove, absolute, existing ones only. */
export function privatePaths(o: { outDir: string; projectDir: string; keepPublic?: boolean }): string[] {
  const out = checkOutDir(o.outDir, o.projectDir);
  const found: string[] = [];
  for (const name of OUTPUT_NAMES) {
    if (name === "public" && o.keepPublic) continue;
    if (existsSync(join(out, name))) found.push(join(out, name));
  }
  const p = resolve(o.projectDir);
  for (const rel of [".looot-zeus", join("city", "img", "people")]) if (existsSync(join(p, rel))) found.push(join(p, rel));
  const data = join(p, "city", "data");
  if (existsSync(data)) for (const name of readdirSync(data)) if (/^contacts.*\.json$/i.test(name)) found.push(join(data, name));
  return found;
}

/** Removes the given paths recursively and returns them. */
export function removePaths(paths: string[]): string[] {
  for (const f of paths) rmSync(f, { recursive: true, force: true });
  return paths;
}
