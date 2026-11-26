// "Do this first.": Zeus points at the "Make it yours, tell your agent" pill (shell/dofirst.*, David 26 Nov 2026).
// The same three files go into the demo page through build/dofirst.py.
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`./shell/${f}`, import.meta.url), "utf8").trim();

export const DO_FIRST_HTML = read("dofirst.html");
export const DO_FIRST_CSS = read("dofirst.css");
export const DO_FIRST_JS = read("dofirst.js");
