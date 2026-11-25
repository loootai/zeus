# Zeus

Zeus is the free first run of [looot](https://looot.ai). Give it your domain. It reads your site for free, shows the price of every step, and after your yes it spends at most your cap on real data runs. You get one dossier and one page that shows your market as a city.

Tell your agent (Claude Code, Cursor, Codex):

```
run zeus.looot.ai for mycompany.com
```

For developers:

```bash
export LOOOT_TOKEN=...          # looot.ai, Settings, Agent tokens
npx looot-zeus run yourdomain.com
```

In Claude Code, Cursor or Codex, install the `/gtm` skill and type `/gtm yourdomain.com`:

```bash
npx skills add loootai/gtm-skills
```

## What a run does

- The default run is company-level only: target accounts scored A to D, rivals, their ads and social posts, Google ranks and AI answers, agent readiness and domain records. It collects no people.
- Section caps keep the worst case of a default run under the USD 2 of free credit a new looot account gets once. The quote shows each section's cap and the worst case under all caps before anything is spent.
- People data (names, work emails, buying committees) comes only on a paid run with `--people`. Phones only with `--people --phones`.
- LinkedIn steps are on by default. A workspace guardrail on looot that blocks LinkedIn refuses those steps; the run skips them and says so.
- Every call is written to a receipt with what it cost. Model tokens of your agent are not included.

See [cli/README.md](cli/README.md) for every command, option and module, and [cli/SKILL.md](cli/SKILL.md) for the agent flow.

## Host it on your own Vercel and Supabase

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Floootai%2Fzeus&project-name=zeus&repository-name=zeus&integration-ids=oac_VqOgBHqhEoFTPzGkPd7L0iH6&env=LOOOT_TOKEN&envDescription=Your%20looot%20API%20key%20from%20looot.ai.%20You%20paste%20it%20here%3B%20it%20is%20never%20in%20this%20link.&envLink=https%3A%2F%2Flooot.ai%2Fskill.md)

The button clones this repo and adds the Supabase integration, which creates your Supabase project and sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the Vercel project. You paste `LOOOT_TOKEN` in the form; the link carries env names only.

1. Apply `supabase/migrations/20261125120000_zeus.sql` (`supabase db push`, or the SQL editor): tables `runs`, `accounts`, `committees`, `people`, `plays`, `rivals`, RLS on with no public access.
2. `npx looot-zeus import-supabase --dry-run` shows what would be written.
3. `npx looot-zeus import-supabase` with both env vars set upserts your results by domain. The key is never printed.

Details in [cli/README.md](cli/README.md#host-it-on-your-own-vercel-and-supabase).

## Personal data

Shared and served pages also name no target account or rival: they show Account A, B, C and Rival 1, 2, 3 with sector, size and score, and the run refuses to write a shared page that still names one.

Only your own local output folder (`gtm/`) can hold contacts, and only after a run with `--people`. Shared and served pages (`--public`, `export --public`, `serve`) show people as a role with an invented name, no email, phone or profile link. `npx looot-zeus delete` removes the local contacts; we suggest doing that within 30 days. `npm test` fails on a real email, phone number or person photo in any tracked file.

## Licence

MIT, see [LICENSE](LICENSE).
