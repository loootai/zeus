// The Zeus mascot's clips (shell/zeus-idle.webm, shell/zeus-throw.webm). They are too big to inline, so every
// command that writes a city page also writes them into zeus/ beside it. A page without them shows his still.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MASCOT_FILES = ["zeus-idle.webm", "zeus-throw.webm"] as const;

/** Copies the mascot clips into `<dir>/zeus/`, the folder that holds a city page. Returns the files written. */
export function writeMascotFiles(dir: string): string[] {
  const out = join(dir, "zeus");
  mkdirSync(out, { recursive: true });
  return MASCOT_FILES.map((f) => {
    copyFileSync(fileURLToPath(new URL(`./shell/${f}`, import.meta.url)), join(out, f));
    return join(out, f);
  });
}
