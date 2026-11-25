// Runs the test suite with TMPDIR set to one fresh folder and removes that folder afterwards,
// pass or fail, so every mkdtemp a test (or a CLI it spawns) makes is cleaned up with it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "looot-zeus-test-"));
let status = 1;
try {
  const files = readdirSync("dist/test").filter((f) => f.endsWith(".test.js")).map((f) => join("dist/test", f));
  const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit", env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root, LOOOT_ZEUS_NO_SAVED_LOGIN: "1" } });
  status = r.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(status);
