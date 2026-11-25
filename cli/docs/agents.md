# looot-zeus in your coding agent

The `/gtm` skill lets your agent run `looot-zeus` for you. You type `/gtm yourdomain.com`. The agent shows you the price, waits for your yes, runs it and gives you the dossier. The skill text is `SKILL.md` in this package. `npx looot-zeus skill` prints it.

You need Node 22.12 or later and a looot agent token. Create the token at looot.ai, Settings, Agent tokens. Set it in your shell before you start the agent.

```bash
export LOOOT_TOKEN=...
```

## Claude Code

Claude Code reads skills from `~/.claude/skills/<name>/SKILL.md`.

```bash
mkdir -p ~/.claude/skills/gtm
npx looot-zeus skill > ~/.claude/skills/gtm/SKILL.md
```

Start a new Claude Code session and type `/gtm yourdomain.com`. For one project only, use `.claude/skills/gtm/SKILL.md` inside that project.

## Codex

Codex reads `AGENTS.md` in your project. Add the skill to it.

```bash
npx looot-zeus skill >> AGENTS.md
```

Then ask Codex "/gtm yourdomain.com" or "run gtm on yourdomain.com".

## Cursor

Cursor reads custom commands from `.cursor/commands/` in your project.

```bash
mkdir -p .cursor/commands
npx looot-zeus skill > .cursor/commands/gtm.md
```

Type `/gtm yourdomain.com` in the Cursor agent chat.

## What the agent does

1. It runs `npx looot-zeus run yourdomain.com`. The free site read and the quote run. No paid call.
2. It shows you the calls, the expected cost, the worst case and the suggested cap.
3. It asks "Run it with a cap of $X?" and waits.
4. After your yes, it runs `npx looot-zeus run yourdomain.com --cap X --yes`.
5. It tells you the result and where the dossier is.

If a command fails twice, the agent stops and shows you the error.

## Every run after the first

If `gtm/next-run.md` exists, the agent reads it first and tells you what the next run would change. It asks before it uses the learnings. With your yes it adds `--apply-learnings` to the run.

To give Zeus the replies, ask the agent to run `npx looot-zeus learn` with the replies file from your outreach tool or CRM. Run learn after the campaign reply window has closed. Zeus never sends anything. Your outreach tool does the sending.
