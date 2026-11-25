import assert from "node:assert/strict";
import { test } from "node:test";
import { competitorsFrom, deriveConfig, markdownOf, pickUrls, resolveCompetitor } from "../src/modules/intake.js";

const home = `Title: Acme CRM | Sales pipeline software

# The sales CRM for small teams
Acme CRM helps small sales teams track every deal and close more of them each month.
[Pricing](/pricing) [Customers](https://acme.example/customers) [Acme vs Bigco](/vs/bigco)
sales pipeline tool, sales pipeline tool, deal tracking, deal tracking for agencies and software teams.`;

test("picks the intake URLs from the home page links", () => {
  const u = pickUrls("acme.example", home);
  assert.equal(u.pricing, "https://acme.example/pricing");
  assert.equal(u.customers, "https://acme.example/customers");
  assert.equal(u.alternatives, "https://acme.example/vs/bigco");
});

test("reads competitors from vs links and text", () => {
  const md = "[vs Bigco](/vs/bigco) [Compare](/compare/megacrm-alternative) Looking for Zenhub alternatives?";
  assert.deepEqual(competitorsFrom(md, "acme.example", "https://acme.example/"), ["bigco.com", "megacrm.com", "zenhub.com"]);
});

test("derives a config draft from four pages", () => {
  const pages = [
    { kind: "home" as const, url: "https://acme.example/", ok: true, chars: home.length, markdown: home },
    { kind: "pricing" as const, url: "https://acme.example/pricing", ok: true, chars: 10, markdown: "Enterprise plan on request" },
    { kind: "customers" as const, url: "https://acme.example/customers", ok: true, chars: 10, markdown: "[Northwind](https://northwind.example) [Contoso](https://contoso.example/story) [LinkedIn](https://linkedin.com/x)" },
    { kind: "alternatives" as const, url: "https://acme.example/vs/bigco", ok: true, chars: 10, markdown: "[vs Bigco](/vs/bigco)" },
  ];
  const { config } = deriveConfig("acme.example", pages);
  assert.equal(config.brand, "Acme CRM");
  assert.match(config.offer, /sales CRM for small teams/);
  assert.deepEqual(config.seeds, ["northwind.example", "contoso.example"]);
  // "Bigco" is only a word and a /vs/ slug here, never written as a domain: it is not turned into bigco.com.
  assert.deepEqual(config.competitors, []);
  assert.equal(config.icp.sizeBand, "51-1000");
  assert.ok(config.keywords.includes("sales pipeline"));
  assert.equal(config.questions.length > 0, true);
});

test("finds page text whatever the provider called the field", () => {
  assert.equal(markdownOf({ markdown: "a" }), "a");
  assert.equal(markdownOf({ data: { content: "b" } }), "b");
  assert.equal(markdownOf({ fields: { text: "c" } }), "c");
  assert.equal(markdownOf("d"), "d");
});

test("resolves a competitor name to the domain the site text uses", () => {
  const text = "Compare us with Hunter (hunter.io) and [Bigco](https://bigco.ai/pricing). Hunter alternatives";
  assert.deepEqual(resolveCompetitor("hunter", text, "https://acme.example/"), { domain: "hunter.io", guessed: false });
  assert.deepEqual(resolveCompetitor("bigco", text, "https://acme.example/"), { domain: "bigco.ai", guessed: false });
  assert.deepEqual(resolveCompetitor("zenhub", text, "https://acme.example/"), { domain: "zenhub.com", guessed: true });
  // a longer host that only starts with the name does not count
  assert.equal(resolveCompetitor("hunter", "see notahunter.io", "https://acme.example/").domain, "hunter.com");
});

test("deriveConfig uses the written domain and drops .com guesses", () => {
  const alt = "Looking for Hunter alternatives? Hunter.io charges per seat. Looking for Zenhub alternatives?";
  const pages = [
    { kind: "home" as const, url: "https://acme.example/", ok: true, chars: home.length, markdown: home },
    { kind: "alternatives" as const, url: "https://acme.example/alternatives", ok: true, chars: alt.length, markdown: alt },
  ];
  const { config, guessed } = deriveConfig("acme.example", pages);
  assert.ok(config.competitors.includes("hunter.io"));
  assert.ok(!config.competitors.includes("hunter.com"));
  // Zenhub is never written as a domain, so no zenhub.com guess is kept.
  assert.ok(!config.competitors.includes("zenhub.com"));
  assert.ok(!guessed.includes("competitor domains"));
});

test("a software site with a top-up checkout and a quoted ad is not a store", () => {
  const pages = [
    { kind: "home" as const, url: "https://acme.example/", ok: true, chars: home.length, markdown: home + "\nGRAFFEO.COM Shop now\nSponsored" },
    { kind: "pricing" as const, url: "https://acme.example/pricing", ok: true, chars: 60, markdown: "You top up before your first run (the minimum shows at checkout)." },
  ];
  assert.equal(deriveConfig("acme.example", pages).config.commerce.mode, "off");
});
