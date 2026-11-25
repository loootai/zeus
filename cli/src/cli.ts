#!/usr/bin/env node
// looot-zeus. One domain in, a GTM dossier out.
//   looot-zeus run <domain> [--cap N] [--yes] [--no-open]   one command: free site read, quote, a yes, then the run
//   looot-zeus init <domain> [--direct]
//   looot-zeus quote [--config gtm/config.yaml] [--depth sample|full] [--phones] [--no-phones] [--cap 10] [--offline]
//   looot-zeus run --cap 10 [--depth sample|full] [--phones] [--public] [--only a,b]
//   looot-zeus demo [--public]
//   looot-zeus watch --cap 5 [--yes] [--demo]
//   looot-zeus export --public
//   looot-zeus export --crm [--format <crm>] [--contact-details]
//   looot-zeus learn [--results file.csv] [--demo]
//   looot-zeus log --campaign <name> --angle <text> --file gtm/exports/instantly.csv
//   looot-zeus more <accounts|committee|ads|social|seo> [--count N] [--cap N] [--yes]
//   looot-zeus skill
//   looot-zeus open
//   looot-zeus serve [--port 4317] [--dir city]
//   looot-zeus delete [--yes] [--keep-public]
//   looot-zeus pending | approve <id|all> | reject <id> | done <id>

import { parseArgs } from "node:util";
import { join } from "node:path";
import { CliExit, type Args, cmdDelete, cmdDemo, cmdExport, cmdFixtures, cmdImportSupabase, cmdInit, cmdPrepare, cmdLearn, cmdLog, cmdMore, cmdOpen, cmdQuote, cmdRun, cmdRunDomain, cmdServe, cmdPending, cmdSetStatus, cmdSkill, cmdWatch } from "./commands.js";
import { ConfigError } from "./config.js";
import { CRM_FORMATS } from "./crm.js";

const HELP = `looot-zeus, one domain in, a GTM dossier out.

  run <domain>       One command. Reads up to 7 pages of the site for free, shows the price, asks
                     "run it with a cap of $X?" and only then runs and writes the dossier.
                     --yes skips the question, --cap <usd> sets the cap (default the suggested cap).
                     Before the run, a quoted rival check reads each candidate's home page and
                     keeps 3 to 5 real rivals, with their logos and social pages.
                     Opens the dossier at the end, --no-open skips it.

Step by step
  prepare <domain>   For your agent. Reads the site for free, then a quoted rival check (a few
                     cents) writes gtm/candidates.json: rival candidates with why each was kept
                     or dropped, who the site is for, named customers, review snippets. Your agent
                     picks rivals, ICP and category words in gtm/config.yaml, then runs.
  init <domain>      Read up to 7 pages of the site and write gtm/config.yaml. Shows the price (about
                     $0.001 on looot) and asks [y/N] first. --direct reads them without looot, free.
  quote              Price the run per module. Makes no paid call.
  run --cap <usd>    Shows the quote, asks [y/N], then runs every module inside one cap and writes
                     gtm/dossier.html.
  demo               Full dossier from placeholder fixtures. No key, no network.
  watch --cap <usd>  The same run again (default cap 5), with the price and the question first.
                     Writes gtm/changes.md, what changed since the last run. --demo shows an example.
  learn              Reads what happened after the last runs and says what the next run would
                     change. Takes the replies file from your outreach tool or CRM (--results
                     <file>, default gtm/results.csv) and replies from Instantly when
                     INSTANTLY_API_KEY is set. Writes gtm/next-run.md and gtm/config.next.yaml.
                     Never changes config.yaml and never sends anything. --demo needs no key.
  more <what>        Fetch more into the folder you already have, then write the dossier again.
                     accounts (with people and emails), committee (buying committees for the next
                     A and B accounts), ads (the next page of ads), social (the next page of
                     LinkedIn and X posts), seo (rankings for more keyword gaps). --count sets
                     how many. Shows the price and asks [y/N] first. In a demo folder it adds
                     placeholder rows for free.
  log                Notes who your outreach tool will email and with which angle, so learn can
                     match replies. --campaign <name> --angle <text> --file gtm/exports/instantly.csv
  export --public    A copy of the dossier to show anyone, in gtm/public/. Your domain, brand,
                     rivals and people are swapped for yourdomain.com, Rival A and Person 1.
                     --mask-accounts also turns target accounts into Account 1 on account-1.example.
                     The copy has the dossier and the city page, company-level data only.
  export --crm       CSV files your CRM imports, in gtm/crm/<format>/: companies.csv (target
                     accounts), contacts.csv (only when the run had people, a paid --people run;
                     never with --public or --safe-demo) and receipt.txt (the looot jobs behind it).
                     --format ${CRM_FORMATS.join(", ")} (default generic). Emails and phones
                     only with --contact-details. UTF-8 with BOM, formula cells escaped.
  import-supabase    Upsert the run's accounts, committees, people, plays and rivals into your own
                     Supabase project, deduped by domain (tables: supabase/migrations in the repo).
                     Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env (never printed).
                     --dry-run prints the counts and writes nothing. Emails and phones only with
                     --contact-details on a paid, non-safe run.
  open               Open gtm/dossier.html.
  serve              Serve the page (city/ when there is one, else the output folder) on
                     http://127.0.0.1:4317. Buttons on the page add requests to
                     .looot-zeus/requests.json. Nothing runs until you approve. --port, --dir.
                     The page is the safe demo copy (no contacts). --private serves your real
                     contacts, with a warning. Never host a --private page.
  pending            List the requests from the page with their estimated cost.
  approve <id|all>   Mark requests approved and print the prompt for your agent to run.
  reject <id>        Drop a request.
  done <id>          Mark an approved request as run.
  delete             Remove the local files that may hold contacts: the output folder (people and
                     account CSVs, exports, state.json, the private pages), .looot-zeus/ caches,
                     city/data/contacts*.json and city/img/people/. Keeps config.yaml. Asks [y/N]
                     unless --yes. --keep-public keeps gtm/public/. Local contacts stay only until
                     you run delete; we recommend deleting after 30 days.
  skill              Print SKILL.md, the /gtm skill for Claude Code, Codex and Cursor.

Options
  --out <dir>        Output folder. Default gtm
  --config <file>    Config file. Default <out>/config.yaml
  --cap <usd>        Most the run may spend. Default 10 for run, the suggested cap for run <domain>, 5 for watch
  --count <n>        How many accounts, committees or keywords more fetches
  --depth <d>        sample (25 accounts) or full (100 accounts)
  --people           Paid runs only. Add people data: work emails, buyers per account and committees
                     for 10 accounts. Off by default: the free run has names and roles for 5 committees
  --phones           Opt-in, needs --people. Phone numbers for the buying committees and every
                     enriched person, plus the deepest phone step (Limadata, $0.20 only on a hit)
  --max-runs <n>     Stop the whole run after n paid calls. Per-section limits go in gtm/config.yaml
                     under caps: (total_usd, total_runs, sections.<module>.usd / .runs).
  --no-linkedin      Skip every LinkedIn step: LinkedIn ads, company posts and the LinkedIn page search.
                     Same as linkedin: false in gtm/config.yaml.
  --no-phones        Skip every phone lookup, even when gtm/config.yaml asks for phones
  --public           Mask people in the dossier (j***@domain), skip the outreach exports and write
                     the public copy to gtm/public/
  --safe-demo        Force safe demo output on any command: people are a role with an invented name,
                     no emails, phones, profile links or photos. Already on for --public, export
                     --public and serve
  --private          serve only. Show your real contacts. Prints a warning
  --only <ids>       Run only these modules (and what they need), comma separated
  --offline          Quote from the dated price table, no network
  --demo             watch or learn with placeholder data
  --apply-learnings  Use the weights learn wrote in gtm/learnings.json for this run
  --results <file>   The replies CSV for learn
  --campaign-id <id> Only this Instantly campaign, for learn
  --yes, -y          Skip the [y/N] question before a paid call. Needed when there is no terminal
  --no-open          run <domain> opens gtm/dossier.html at the end in a terminal. This skips it

Needs LOOOT_TOKEN for init (without --direct), run and more. quote, demo, learn and log need no looot key.`;

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string", default: "gtm" },
        config: { type: "string" },
        cap: { type: "string" },
        count: { type: "string" },
        depth: { type: "string" },
        phones: { type: "boolean" },
        people: { type: "boolean" },
        "no-phones": { type: "boolean" },
        "max-runs": { type: "string" },
        "no-linkedin": { type: "boolean" },
        public: { type: "boolean" },
        "safe-demo": { type: "boolean" },
        private: { type: "boolean" },
        only: { type: "string" },
        offline: { type: "boolean" },
        direct: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        "no-open": { type: "boolean" },
        demo: { type: "boolean" },
        "mask-accounts": { type: "boolean" },
        crm: { type: "boolean" },
        "dry-run": { type: "boolean" },
        format: { type: "string" },
        "contact-details": { type: "boolean" },
        "keep-public": { type: "boolean" },
        "apply-learnings": { type: "boolean" },
        results: { type: "string" },
        campaign: { type: "string" },
        "campaign-id": { type: "string" },
        angle: { type: "string" },
        file: { type: "string" },
        port: { type: "string" },
        dir: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    fail(`${(e as Error).message}\n\n${HELP}`, 2);
  }
  const a = parsed.values as Args;
  const [cmd, arg] = parsed.positionals;
  if (a.help || !cmd) return console.log(HELP);
  const outDir = String(a.out);
  const configPath = (a.config as string | undefined) ?? join(outDir, "config.yaml");
  try {
    switch (cmd) {
      case "init":
        await cmdInit(arg, a, outDir);
        return;
      case "prepare":
        await cmdPrepare(arg, a, configPath, outDir);
        return;
      case "quote":
        return await cmdQuote(a, configPath);
      case "run":
        // With a domain, run is the one command: free read, quote, a yes, then the run.
        // Without one, it runs the brief in the config, as before.
        if (arg) {
          await cmdRunDomain(arg, a, configPath, outDir);
          return;
        }
        await cmdRun(a, configPath, outDir);
        return;
      case "demo":
        return await cmdDemo(a, outDir);
      case "watch":
        await cmdWatch(a, configPath, outDir);
        return;
      case "learn":
        await cmdLearn(a, configPath, outDir);
        return;
      case "more":
        await cmdMore(arg, a, outDir);
        return;
      case "log":
        cmdLog(a, outDir);
        return;
      case "export":
        return cmdExport(a, outDir);
      case "import-supabase":
        await cmdImportSupabase(a, outDir);
        return;
      case "serve":
        await cmdServe(a, outDir);
        return;
      case "delete":
        await cmdDelete(a, outDir);
        return;
      case "pending":
        return cmdPending();
      case "approve":
      case "reject":
      case "done":
        return cmdSetStatus(cmd, arg);
      case "skill":
        return cmdSkill();
      case "open":
        return cmdOpen(outDir, arg);
      case "fixtures":
        return await cmdFixtures();
      default:
        fail(`Unknown command ${cmd}.\n\n${HELP}`, 2);
    }
  } catch (e) {
    if (e instanceof CliExit) fail(e.message, e.code);
    if (e instanceof ConfigError) fail(`Config problem, ${e.message}.`, 2);
    throw e;
  }
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
