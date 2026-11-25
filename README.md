# Zeus

Zeus is the free first run of [looot](https://looot.ai). Give it your domain. It reads your site for free, shows the price of every step, and after your yes it spends at most your cap on real data runs. You get one dossier and one page that shows your market as a city.

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

## Personal data

Only your own local output folder (`gtm/`) can hold contacts, and only after a run with `--people`. Shared and served pages (`--public`, `export --public`, `serve`) show people as a role with an invented name, no email, phone or profile link. `npx looot-zeus delete` removes the local contacts; we suggest doing that within 30 days. `npm test` fails on a real email, phone number or person photo in any tracked file.

## Licence

MIT, see [LICENSE](LICENSE).
