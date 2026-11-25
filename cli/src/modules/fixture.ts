// Loads a PLACEHOLDER fixture from fixtures/<name>.json. Demo mode and tests use it. A live run never does.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG_ROOT } from "../util.js";

export const PLACEHOLDER_SOURCE = "PLACEHOLDER data, invented to show the layout. A real run replaces it.";

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", `${name}.json`), "utf8")) as T;
}
