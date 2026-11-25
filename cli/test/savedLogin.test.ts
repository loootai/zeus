import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientFromEnv, readSavedLogin, savedLoginPath } from "../src/client.js";

function home(config?: unknown): string {
  const h = mkdtempSync(join(tmpdir(), "zeus-login-"));
  if (config !== undefined) {
    mkdirSync(join(h, ".config", "looot"), { recursive: true });
    writeFileSync(join(h, ".config", "looot", "config.json"), typeof config === "string" ? config : JSON.stringify(config));
  }
  return h;
}

test("no LOOOT_TOKEN and no saved login: no client", () => {
  assert.equal(clientFromEnv({ HOME: home() }), null);
});

test("the login `looot login` saved is used when LOOOT_TOKEN is not set", () => {
  const h = home({ token: "cs_ms_saved", apiUrl: "https://api.looot.ai/" });
  assert.deepEqual(readSavedLogin({ HOME: h }), { token: "cs_ms_saved", apiUrl: "https://api.looot.ai/" });
  assert.ok(clientFromEnv({ HOME: h }));
});

test("XDG_CONFIG_HOME wins over HOME, like the looot CLI", () => {
  assert.equal(savedLoginPath({ HOME: "/h", XDG_CONFIG_HOME: "/x" }), join("/x", "looot", "config.json"));
});

test("a non-https saved apiUrl is ignored, a broken file reads as signed out", () => {
  assert.deepEqual(readSavedLogin({ HOME: home({ token: "t", apiUrl: "http://evil.example" }) }), { token: "t", apiUrl: undefined });
  assert.equal(readSavedLogin({ HOME: home("{not json") }), null);
  assert.equal(readSavedLogin({ HOME: home({ token: 5 }) }), null);
});

test("LOOOT_ZEUS_NO_SAVED_LOGIN=1 turns the saved login off (npm test sets it)", () => {
  const h = home({ token: "cs_ms_saved" });
  assert.equal(readSavedLogin({ HOME: h, LOOOT_ZEUS_NO_SAVED_LOGIN: "1" }), null);
  assert.equal(clientFromEnv({ HOME: h, LOOOT_ZEUS_NO_SAVED_LOGIN: "1" }), null);
});
