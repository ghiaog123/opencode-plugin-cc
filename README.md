# opencode plugin for Claude Code

Use [opencode](https://opencode.ai) from inside Claude Code for code reviews or to delegate tasks —
a port of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) that drives your local
`opencode` CLI instead of Codex.

## What You Get

- `/opencode:review` — normal read-only opencode review
- `/opencode:adversarial-review` — steerable challenge review
- `/opencode:rescue` — delegate work to opencode through the `opencode:opencode-rescue` subagent
- `/opencode:status`, `/opencode:result`, `/opencode:cancel` — manage background jobs
- `/opencode:setup` — readiness check and the optional stop-time review gate

## Requirements

- `opencode` CLI on `PATH`, signed in (`opencode providers login`). Any provider works — including the
  OpenCode Go plan (`opencode-go/*` models).
- Node.js 18.18+

## Install

```bash
/plugin marketplace add /Users/hieuvu7/myproject/opencod-plugin-cc
```

```bash
/plugin install opencode@opencode-cc
```

```bash
/reload-plugins
```

Then:

```bash
/opencode:setup
```

## Usage

### `/opencode:review`

Read-only review of your current work. Runs opencode's `plan` agent, which inspects the diff with git itself.

```bash
/opencode:review
/opencode:review --base main
/opencode:review --background
```

Multi-file reviews take a while — prefer `--background`, then `/opencode:status` and `/opencode:result`.

### `/opencode:adversarial-review`

Same target selection, but the prompt challenges the approach: design choices, tradeoffs, hidden
assumptions, failure modes. Accepts extra focus text after the flags.

```bash
/opencode:adversarial-review --base main challenge the caching and retry design
/opencode:adversarial-review --background look for race conditions
```

### `/opencode:rescue`

Hands a task to opencode via the rescue subagent. Write-capable by default (opencode `build` agent);
add `--read-only` for investigation only.

```bash
/opencode:rescue investigate why the tests started failing
/opencode:rescue --model opencode-go/kimi-k3 --variant high fix the flaky integration test
/opencode:rescue --resume apply the top fix from the last run
/opencode:rescue --background --read-only dig into the regression
```

Or just ask: `Ask opencode to redesign the DB connection to be more resilient.`

Notes:

- omit `--model` / `--variant` and opencode uses your own config defaults
- models are `provider/model` (`opencode models` lists them)
- `--resume` continues the newest opencode thread from this repo; `--fresh` forces a new one

### `/opencode:status`, `/opencode:result`, `/opencode:cancel`

```bash
/opencode:status
/opencode:result task-abc123
/opencode:cancel
```

`/opencode:result` prints the stored output plus `opencode --session <id>` so you can continue the same
thread in the opencode TUI.

### `/opencode:setup`

Checks the CLI and credentials, and toggles the optional review gate:

```bash
/opencode:setup --enable-review-gate
/opencode:setup --disable-review-gate
```

With the gate enabled, a `Stop` hook runs a working-tree review when Claude tries to finish. A verdict of
`FIX FIRST` blocks the stop so Claude addresses the findings.

> [!WARNING]
> The gate can create a long Claude/opencode loop and burn quota. Only enable it while watching the session.

## How It Works

`plugins/opencode/scripts/opencode-companion.mjs` shells out to:

```bash
opencode run --format json --auto --agent <plan|build> [--model ...] [--variant ...] [--session ...] "<prompt>"
```

It folds the NDJSON event stream into a result, and stores jobs (id, status, session id, output) under
`$CLAUDE_PLUGIN_DATA/state/<repo>-<hash>/`. `--background` re-execs the companion detached and returns a
job id immediately.

Two details that matter for headless opencode:

- stdin is closed — `opencode run` hangs forever on an inherited non-TTY stdin
- `--auto` is passed so permission prompts never block a headless run

Your own `opencode.json` / agent config is used as-is.

## Differences from the Codex plugin

- no `/codex:transfer` equivalent — opencode's `import` takes its own export format, not Claude's `.jsonl`
- one companion script over the plain CLI instead of the Codex app-server JSON-RPC broker

## Test

```bash
npm test
```
