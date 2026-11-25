# looot-zeus

one command. one key. one cap.

You give it your domain. It reads your site, writes a short brief and asks you to check it. Then it finds the companies that fit your best customers, the people to talk to and their verified work emails. It also reads your competitors, their ads, your search ranks, what AI answers say about you, your App Store and Google Maps reviews and recent mentions. Everything lands in one dossier with CSV files you can load into Instantly, HubSpot or Attio. Your own agent reads the dossier and drafts the next step. You check and send. You see the price before anything runs. One cap limits the whole run. A list of every paid call shows its provider and its charge.

It runs on [looot](https://looot.ai). You need one looot key (`LOOOT_TOKEN`) for a real run. The demo needs no key.

## Install

```bash
npx looot-zeus run yourdomain.com      # no install needed
npm install -g looot-zeus              # or install the looot-zeus command
looot-zeus --help
```

Needs Node 22.12 or newer. These commands work once `looot-zeus` is published to npm; until then run it from a checkout (`cd cli && npm ci && npm run build && node dist/src/cli.js --help`) or from a packed tarball (`npm pack`, then `npm i -g ./looot-zeus-*.tgz`).

## Quickstart

One command.

```bash
export LOOOT_TOKEN=...            # an agent token from looot.ai, Settings, Agent tokens
npx looot-zeus run yourdomain.com
```

You see the price and confirm before any paid call. Here is what the command does.

1. It reads 4 pages of your site with a plain web request. No looot call and no charge. It writes the brief to `gtm/config.yaml`.
2. It prints the quote. You see the calls, the expected cost, the worst case and a suggested cap. Nothing paid has run yet.
3. It asks `Run it with a cap of $X? [y/N]`. Only a `y` starts the paid run. Any other answer stops it and nothing is spent.
4. It runs inside that cap and writes `gtm/dossier.html` and the list of what each call cost.

Add `--cap 5` to set your own cap. Add `--yes` to skip the question, for example in a script. Without a terminal and without `--yes`, the command stops after the quote, spends nothing and prints the command to run next. If you want to fix the brief first, answer no, edit `gtm/config.yaml` and run the same command again. It keeps your edits.

### In your coding agent

Install the `/gtm` skill for Claude Code with one line.

```bash
mkdir -p ~/.claude/skills/gtm && npx looot-zeus skill > ~/.claude/skills/gtm/SKILL.md
```

Then type `/gtm yourdomain.com`. The agent shows you the price and waits for your yes. Codex and Cursor setup is in [docs/agents.md](docs/agents.md).

### Or step by step

```bash
npm install -g looot-zeus          # or use npx looot-zeus
export LOOOT_TOKEN=...

looot-zeus init yourdomain.com     # shows the price, asks, reads 4 pages, writes gtm/config.yaml
looot-zeus quote                   # prices the run per module, makes no paid call
looot-zeus run --cap 10            # shows the quote, asks, runs every module inside a 10 USD cap
looot-zeus open                    # opens gtm/dossier.html
looot-zeus open city               # opens gtm/city/index.html, the city page
```

Every command that spends money shows the price first and asks `[y/N]`. Only a `y` goes on. `--yes` skips the question. Without a terminal and without `--yes` it stops, spends nothing and prints the command to run next. `quote` and `demo` never spend. `watch` is the same run again, with the price and the question first.

1. `init` shows the price of the 4 page reads (about $0.001) and asks. Then it reads your home, pricing, customers and comparison pages. It drafts your offer, your ideal customer, 5 seed customers, 3 competitors, 10 keywords and 10 buyer questions. Open `gtm/config.yaml`, fix anything that is wrong, then go on.
2. `quote` shows each module with its calls, the expected cost and the worst case. It suggests a cap.
3. `run` shows the quote and asks. It starts only after your yes and only when the expected cost fits under your cap.

To see it first, run `looot-zeus demo`. It writes a full dossier from made up data. No key, no network, no charge.

`init --direct` reads your pages with a plain web request instead of looot. No key and no charge. The one command always reads them this way.

### Options

| Option | What it does |
|---|---|
| `--cap <usd>` | The most the run may spend. Default 10 for `run`. For `run yourdomain.com` the default is the suggested cap. |
| `--yes` | Skips the `[y/N]` question before a paid call in `init`, `run` and `run yourdomain.com`. Needed when there is no terminal to answer in. |
| `--depth sample` or `full` | 25 accounts (default) or 100 accounts. |
| `--people` | Paid runs only. Adds people data: buyers per account, work emails and buying committees with emails for the top 10 accounts (sections 03 and 03B). Off by default: the free run is company-level except the buying committee for the top 5 accounts, names and roles only, shown only to you (never on a shared or served page). |
| `--phones` | Opt-in, needs `--people`. Phone numbers for the buying committees and every enriched person, plus the deepest phone step (Limadata, $0.20 only when it finds one). Costs more. |
| `--no-phones` | Skip every phone lookup, even when `gtm/config.yaml` asks for phones. |
| `--public` | Safe demo output (see Safe demo mode below), skips the outreach CSVs and writes the public copy to `gtm/public/`. |
| `--safe-demo` | Forces safe demo output for any command (`run`, `demo`, `more`, `watch`, `serve`), without writing `gtm/public/`. |
| `--private` | `serve` only. Serves your real contacts, with a warning. |
| `--only <ids>` | Runs only these modules and the ones they need. |
| `--offline` | Quotes from the dated price table in the package, with no network call. |
| `--out <dir>` | Output folder. Default `gtm`. |

## Modules

The core modules.

| # | Module | What you get | looot jobs |
|---|---|---|---|
| 01 | icp | Your ideal customer profile and 25 lookalike companies from your seed customers | company.enrich, company.similar, company.technographics |
| 02 | accounts | Companies that fit, scored A to D, each with its reasons | company.search, company.enrich |
| 03 | people and enrich (`--people` only) | 2 buyers per account and their work emails, checked by a verifier | people.search, people.email.find, people.email.verify, people.phone.find with `--phones` |
| 03B | committee | Free run: names and roles for the top 5 accounts, one people.search each, no emails or phones. With `--people`: a buying committee for the top 10 A and B accounts. Up to 4 people each (economic buyer, champion, technical or ops lead, user lead) with email and LinkedIn (phone with `--phones`), each marked found or not found. Phones run cheapest first and stop at the first hit, each labelled Mobile, Direct or Company line. Each account also gets its main line from a tel: link on its site. People found before are reused | people.search, people.email.find, people.phone.find, people.phone.find.mobile (first two people), web.scrape.markdown |
| 04 | signals | Hiring, funding and news per account, with dates and a hot, warm or cold score | jobs.search, company.funding, news.search |
| 05 | competitors | A rival card per competitor. Every claim has its source and date | web.scrape.markdown, company.technographics, news.search, linkedin.company.posts |
| 06 | ads | The ads you and your competitors run, their angles and offers | ads.meta.search, ads.linkedin.search, ads.google.search |
| 06B | social | What you and each rival post on LinkedIn and X, with links, engagement and topics | linkedin.company.posts, x.post.search |
| 07 | seo | Keyword gaps, Google ranks and how often AI answers name you | keywords.domain.overview, domain intersection, google.serp.organic, google.serp.ai-mode, chatgpt.search.answer |
| 08 | reviews | Review themes and competitor weak spots from the App Store and Google Maps | reviews.appstore.reviews, maps.place.reviews |
| 09 | mentions | Posts from the last 7 days and the ones that show buying intent | reddit.post.search, x.post.search, news.search |

Three more run when they fit.

| # | Module | When it runs | looot jobs |
|---|---|---|---|
| 10 | market | Always. Traffic, funding, hiring and news for you and each competitor | company.traffic, company.funding, jobs.search, news.search |
| 10 | local | When your business has places people visit. Your rank and rating in local search | maps.local.search |
| 10 | commerce | When you sell on Amazon. Price, rating and reviews per listing | amazon.product.get |

Two steps sit around them. `intake` builds the brief at `init`. `synthesis` writes the summary at the end. It names your hot accounts and the ad angles your rivals use that you do not. It also lists their weak spots. Your own agent reads the dossier and drafts the emails, ads or pages you ask for. You check and send.

A module that has nothing to work on skips itself and says why. Reviews skip when you list no app or place. Commerce skips when the site is not a store. A skip costs nothing.

### Competitor ids for reviews and commerce

Your own ids go at the top level. A competitor's ids go under its domain.

```yaml
reviews:
  appStoreIds: ["1234567890"]
  mapsPlaces: []
  competitors:
    rival-a.com: { appStoreIds: ["2345678901"], mapsPlaces: [] }
commerce:
  mode: on
  asins: ["B0ABC12345"]
  competitors:
    rival-a.com: ["B0XYZ98765"]
```

`init` fills your own App Store ids, the local flag, the store flag and your Amazon ASINs when your pages link to them.

## Outputs

Everything goes to `gtm/`.

| File | What it is |
|---|---|
| `dossier.html` | The dossier. One page with a view per topic, in this order. Overview, Accounts and buyers (with a buying committee per top account), Rivals, Ads, Social, SEO and AI answers, Reviews and mentions, Signals, Market, then Plays, Brief and How much this cost, which lists what each call cost. Every number shows its provider and date. Buttons on the page copy a `looot-zeus more` command that fetches more, with its price. |
| `city/index.html` | The city page: an isometric map of the run with views for target accounts, influencers, SEO, GEO, competitive analysis, formats, calendar and the run log. One file, inline CSS and JS, works from disk. Built from the same data as the dossier by the CLI (`src/city/`), so `build/make_hf.py` at the repo root is superseded. With `--public` or `--safe-demo` people are reduced to a role and an invented name here too. A view with no data says so. The menu ends with "What a paid run adds": the commands that fetch more with more credit. The run log view has the quoted and spent table per section. Open it with `looot-zeus open city`. |
| `committee.csv` | Buying committees for the top A and B accounts. Role, name, title, email, LinkedIn, phone, phone type (Mobile, Direct or Company line), the provider and the account's company line, each marked found or not found. |
| `social.json` | Recent LinkedIn and X posts from you and each rival, with topics. |
| `state.json` | What `looot-zeus more` reads to add more to this folder. |
| `dossier.md` | The same dossier as Markdown, for your agent to read. |
| `accounts.csv` | Scored accounts with grades and reasons. |
| `people.csv` | People with titles, emails and email status. |
| `exports/instantly.csv` | Ready to import into Instantly. Verified emails only. |
| `exports/hubspot.csv` | Ready to import into HubSpot. Verified emails only. |
| `exports/attio.csv` | Ready to import into Attio. Verified emails only. |
| `competitors.json` | The rival cards. |
| `ads.json` | The ad board. |
| `signals.json` | The dated signals per account. |
| `plays.md` | The next steps the data points to. Your agent can add more from the dossier. |
| `receipt.json` and `receipt.md` | Every paid call of the run. |
| `config.yaml` | The brief the run used. |
| `snapshot.json` | A short copy of what this run found. The next run compares itself with it. |
| `changes.md` | What changed since the last run. Written from the second run on. |
| `history/<date>/` | The last run's snapshot, `receipt.json` and dossier.md, kept next to this week's. |
| `learnings.json` | One line per run (spend, grades, valid emails per industry and size, providers per job) plus what `learn` found. Schema in `schema/learnings.schema.json`. |
| `learnings.md` | The same in words. |
| `learnings/changelog.md` | Every weight `learn` moved, with the date, the signal, the sample size, old and new value and the reason. |
| `next-run.md` | What the next run would change, in 3 to 5 lines, plus a suggested cap. Written by `learn`. |
| `config.next.yaml` | Your config with industries and titles in the learned order. Written by `learn`. Your `config.yaml` is never changed. |
| `outreach/<date>-<campaign>.json` | Who was sent which angle. Written by `looot-zeus log`. |

With `--public` the dossier is in safe demo mode and the outreach CSVs are not written.

### Safe demo mode

Safe output is company-level data only. Each person shows as their role and title with an invented name (Alex Rivera, Jordan Nguyen, ...), the same name for the same person in every file. There are no emails, phones, LinkedIn or other profile links and no photos. Free text has emails, phones and profile links removed.

| Output | Safe? |
| --- | --- |
| `export --public`: `gtm/public/` (dossier, markdown and the city page) | always |
| `serve` | by default. `--private` serves your real contacts and prints a warning. Never host a `--private` page. |
| `run --public`, `demo --public` | always |
| `--safe-demo` on any command | forced, wins over `--private` |
| `gtm/dossier.html`, `gtm/city/index.html`, `people.csv`, `exports/*.csv` from a normal run | no, they hold your contacts for your outreach. They stay on your machine |

`export --public` and `serve` rebuild their pages from the saved run (`gtm/state.json`), never from the private pages. `gtm/state.json` itself holds the contacts, so do not publish the `gtm/` folder, only `gtm/public/`.

### A copy you can show anyone

```bash
looot-zeus export --public
```

It writes `gtm/public/` with `receipt.json`, `dossier.html`, `dossier.md` and `city/index.html`, in safe demo mode. Your domain and brand become `yourdomain.com` and `yourbrand`. Your competitors become Rival A, Rival B and Rival C (`rival-a.com` and so on). People become Person 1, Person 2 with `example.com` emails. Then it searches the four files for every original string. If one is left, it deletes the copy and tells you which string.

Target accounts keep their names unless you add `--mask-accounts`. Then accounts and lookalikes become Account 1, Account 2 on `account-1.example`, their industry shows as Business and your seed customers become `customer-1.example`. Use it when the target list is your own pipeline.

## Learn from every run

Zeus never sends anything. Your outreach tool sends. Zeus reads what happened and uses it in the next run.

```bash
npx looot-zeus log --campaign "Week 45" --angle "pipeline review in 15 minutes" --file gtm/exports/instantly.csv
# send the campaign from your outreach tool, wait for replies, export them as CSV
npx looot-zeus learn --results replies.csv
npx looot-zeus run --apply-learnings
```

Run learn after the campaign reply window has closed. A send with no reply yet counts as no reply.

1. Every run adds one line to `gtm/learnings.json`. Which grades it found, how many valid emails per industry and size, which provider answered on each job.
2. `log` notes who your outreach tool will email and with which angle.
3. `learn` reads the replies file from any outreach tool or CRM. It needs an email column and one of replied, bounced, meeting, interested or status. Column names are matched loosely. Without `--results` it looks for `gtm/results.csv`. With `INSTANTLY_API_KEY` set it also reads replies from Instantly with one read only request (`GET /api/v2/emails`, received emails, auto replies skipped). HubSpot and Attio go through the CSV for now.
4. `learn` writes `gtm/next-run.md` and `gtm/config.next.yaml`. It never changes `gtm/config.yaml`.
5. `run --apply-learnings` uses the learned weights. The run prints `using learnings from <date>, N changes`. Without the flag the run scores as before and says learnings are there.

The rules.

- Each industry, size band, country and title has a weight from 0.5 to 1.5. 1 is neutral. The weight multiplies that part of the account score. The title weight sets the title order for people search.
- A weight moves toward the group's reply rate divided by the average reply rate. It moves at most 25 percent per learn.
- Nothing moves on a group under 30 sends.
- An angle ranks only with 30 sends and 3 replies.
- An industry with under 40 percent valid emails on 30 or more lookups loses 10 percent, once it also has 30 sends in the results. Under 30 sends the cut is held and learn says so. The next run's lookups count again.
- A title from a provider counts for the ICP title it matches. "Head of Sales EMEA" counts for Head of Sales.
- A provider is noted after 20 calls on a job when its hit rate leads the next one by 15 points. looot records the provider result. Provider selection stays unchanged.
- Bounced addresses are left out of the next exports.
- The same results file never moves a weight twice.
- Every change is written to `gtm/learnings/changelog.md` with the reason.
- To undo a change, delete that weight's line in `gtm/learnings.json` or run without `--apply-learnings`. The changelog shows the old value.

`npx looot-zeus learn --demo` shows it on made up data with no key. It writes to `gtm/learn-demo/`.

## Get more

Each view of the dossier has a button that copies a command to fetch more of that thing into the same folder. The command shows the price and asks before it spends, like `run`.

```bash
npx looot-zeus more accounts --count 25   # more accounts, with their people and emails
npx looot-zeus more committee --count 10  # buying committees for the next A and B accounts
npx looot-zeus more ads                   # the next page of ads for you and each rival
npx looot-zeus more social                # the next page of LinkedIn and X posts
npx looot-zeus more seo --count 10        # rankings for more of the keyword gaps
```

It reads `gtm/state.json`, adds the new rows and writes the dossier again. In a demo folder it adds placeholder rows for free.

## Requests from the page

Every engine on the page has a "Do more with your agent" button. The loop:

1. Run `npx looot-zeus serve` in your project. It serves the page on http://127.0.0.1:4317 (a safe demo copy built from the saved run, no contacts; it refuses when there is no saved run; `--port` sets the port; `--dir` only accepts the run folder, its `city/` or `gtm/public/`; `--private` serves any folder as it is, real contacts included).
2. Click a button on the page. The request lands in `.looot-zeus/requests.json` as a structured entry: its section, a known action (`more-accounts`, `more-committee`, `more-ads`, `more-social`, `more-seo` or `rerun`), a count, the estimated cost and `status: "pending"`. No free text is stored.
3. Your agent sees it, lists what is pending with the cost and asks you to approve.
4. You approve. The agent runs `npx looot-zeus approve <id>`, runs the one fixed `looot-zeus` command it prints (which shows the price and asks again), marks it with `npx looot-zeus done <id>` and rebuilds the page.

Without `serve` the button copies the prompt to the clipboard, so you can paste it into any agent. A page can't write a local file on its own, which is why `serve` is there.

`serve` is locked to your own page. It listens on 127.0.0.1 only, sends no CORS headers and answers 403 to any `Host` other than `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding). Any request whose `Origin` is not the server's own (`http://127.0.0.1:<port>` or `http://localhost:<port>`) gets 403, preflights included, so another website open in your browser can't add requests. Each start makes a new random token and puts it in the served page as `<meta name="looot-zeus-token">`. `POST /zeus/next` needs it in the `X-Looot-Zeus-Token` header. A page opened from disk or hosted elsewhere has no token, so its buttons copy the prompt instead.

```bash
npx looot-zeus pending            # list pending requests with their estimated cost
npx looot-zeus approve <id|all>   # mark approved and print the fixed command to run
npx looot-zeus reject <id>
npx looot-zeus done <id>
```

`.looot-zeus/requests.json` is the one contract, a plain file any agent can read. Which agents pick it up and how:

| Agent | How it knows |
|---|---|
| Claude Code | the `/gtm` skill in SKILL.md (`npx looot-zeus skill`) |
| Codex, Gemini CLI, Windsurf, VS Code with Copilot | `AGENTS.md` in the project. `run <domain>`, `prepare` and `serve` add a marked block to it and never replace your own text |
| Cursor | `.cursor/rules/zeus.md`, written once by the same commands |

Any other agent works if you tell it to read `.looot-zeus/requests.json`.

## Delete your local data

```bash
npx looot-zeus delete               # lists what it removes, asks [y/N]
npx looot-zeus delete --yes         # no question
npx looot-zeus delete --keep-public # keeps gtm/public/
```

It removes the known Zeus output in the output folder that may hold contacts (`people.csv`, `accounts.csv`, `committee.csv`, `exports/`, `state.json`, the private dossier and city page, `gtm/public/` unless `--keep-public`), the `.looot-zeus/` caches and requests, `city/data/contacts*.json` plus `city/img/people/`. It prints each path it removed. It keeps `config.yaml` and any other file of yours. It refuses an output folder that is the project itself, a parent, outside the project or `/`.

Retention: local contacts stay on your machine only until you run `delete`. We recommend deleting them after 30 days. Hosted pages hold only the safe public copy (no contacts); they live 30 days, then are removed. To take one down sooner, write to privacy@looot.ai.

## The cap

You set one cap in USD for the whole run.

1. Before the run, the quote gives an expected cost and a worst case. If the expected cost is above your cap, the run does not start.
2. Each module gets a share of the cap, sized by its worst case. When a module finishes, what it did not spend goes back into a pool the other modules can use.
3. Before every paid call, the most that call can cost is held. If that could take the run past the cap, the call is not made.
4. When the run reaches the cap, it stops and writes a partial dossier. When one module uses up its share, that module stops early and the rest of the run goes on. The last line of the run tells you which one it was.

It stops before any call that could take it past your cap.

## What each call cost

`receipt.json` lists every paid call. `receipt.md` shows the same as tables. The schema is in [`schema/receipt.schema.json`](schema/receipt.schema.json).

Each call row has the module, the job, the provider that answered and the outcome. The outcome is `hit`, `miss`, `fail` or `fallback`. A fallback means a later provider answered after the first one missed. `fallbackFrom` names the first one. The row also has the quoted price, the charged amount, the time and `singleProvider`. When `singleProvider` is true, the job has only one provider, so a miss had no second provider to try.

A miss is a normal answer and stays in the dossier as a row. A miss can still be charged, because some providers bill a "not found". `receipt.md` shows the real charge on every row. Calls charged above their quote are counted and listed.

## Example figures

Real run for higgsfield.ai on 23 Nov 2026, from the Zeus v1 page in this repo (`../city/data/runlog.json`).

| | Real run value |
|---|---|
| Domain | higgsfield.ai |
| Date | 23 Nov 2026 |
| looot runs | 45 |
| Charged | $0.97 |
| Free credit | $2 |
| Misses charged | 4 email finder misses at $0.0048 each |

The quote for `examples/yourdomain.yaml` with the dated price table is real. It is 291 calls, about $1.67 expected and $6.55 worst case, with a suggested cap of 7 USD. Run `looot-zeus quote --config examples/yourdomain.yaml --offline` to see it.

## Limits

- B2B review sites have no looot job yet, so reviews cover the App Store and Google Maps only.
- Commerce covers Amazon listings only.
- Some jobs have one provider only. The quote, the dossier and `receipt.md` mark them.
- No job returns a market size. The market section uses traffic, funding, hiring and news.
- `looot-zeus watch` is the same run again under a spending limit you set (`--cap`, default 5 USD). It shows the price and asks first. Every run compares itself with the last one and writes `gtm/changes.md` (new accounts, rival changes, rank moves, new signals and mentions, ad changes). Last week's files go to `gtm/history/`. To run it every Monday, copy [`examples/gtm-watch.yml`](examples/gtm-watch.yml) into `.github/workflows/` in your repo and set the cap in it. It runs `looot-zeus learn` first, then the run. Commit `gtm/results.csv` after the campaign reply window has closed. With no results file and no Instantly key, learn does nothing. `looot-zeus watch --demo` shows an example on made up data.

## Licence

MIT
