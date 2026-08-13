# opencode-plugin-cc

**Run [opencode](https://opencode.ai) as a subagent inside [Claude Code](https://claude.com/claude-code).**

Get a second opinion on your diff, or hand off a long task to a different model — without leaving Claude Code.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](#license)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen.svg)](#requirements)

> A community port of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) that drives your local `opencode` CLI instead of Codex. Not affiliated with OpenAI, Anthropic, or the opencode project.

---

## Why

Claude Code is good at writing code, and less good at grading its own homework. This plugin puts a second, independent model in the loop:

- **Review** — a fresh agent reads your diff with no memory of why you wrote it that way.
- **Delegate** — long or grindy tasks run in the background on a cheaper model while Claude stays responsive.
- **Second opinion** — different provider, different failure modes. Any provider `opencode` supports works, including the OpenCode Go plan (`opencode-go/*`).

## Features

| Command | What it does |
| --- | --- |
| `/opencode:review` | Read-only review of your working tree or branch diff |
| `/opencode:adversarial-review` | Same, but the prompt attacks the design: tradeoffs, assumptions, failure modes |
| `/opencode:rescue` | Hand a task to opencode (write-capable by default) |
| `/opencode:status` | List background jobs |
| `/opencode:result` | Print a finished job's output |
| `/opencode:cancel` | Kill a running job |
| `/opencode:setup` | Readiness check + toggle the optional stop-time review gate |

Plus the `opencode-rescue` subagent, so plain English works too: *"Ask opencode to redesign the DB connection to be more resilient."*

## Requirements

- [Claude Code](https://claude.com/claude-code)
- [`opencode`](https://opencode.ai) CLI on `PATH`, signed in (`opencode providers login`)
- Node.js ≥ 18.18

No other dependencies. The plugin is ~400 lines of Node stdlib.

## Install

From this marketplace:

```bash
/plugin marketplace add hieuvu7/opencode-plugin-cc
```

```bash
/plugin install opencode@opencode-cc
```

```bash
/reload-plugins
```

Then verify your setup:

```bash
/opencode:setup
```

Or from a local clone — point the marketplace at the checkout, and edits to the plugin apply without reinstalling:

```bash
git clone https://github.com/hieuvu7/opencode-plugin-cc.git
```

```bash
/plugin marketplace add /absolute/path/to/opencode-plugin-cc
```

## Usage

### Reviews

```bash
/opencode:review                    # uncommitted working tree
/opencode:review --base main        # everything on this branch
/opencode:review --background       # returns a job id immediately
```

opencode's read-only `plan` agent inspects the diff with git itself, so nothing gets edited. Multi-file reviews take a while — prefer `--background`, then `/opencode:status` and `/opencode:result`.

Adversarial mode takes optional focus text after the flags:

```bash
/opencode:adversarial-review --base main challenge the caching and retry design
/opencode:adversarial-review --background look for race conditions
```

### Delegating work

```bash
/opencode:rescue investigate why the tests started failing
/opencode:rescue --read-only dig into the regression
/opencode:rescue --model opencode-go/kimi-k3 --variant high fix the flaky integration test
/opencode:rescue --resume apply the top fix from the last run
```

- write-capable by default (opencode `build` agent); `--read-only` for investigation only
- omit `--model` / `--variant` and your own opencode config defaults apply
- models are `provider/model` — run `opencode models` to list them
- `--resume` continues the newest opencode thread from this repo; `--fresh` forces a new one

### Managing jobs

```bash
/opencode:status
/opencode:result task-abc123
/opencode:cancel
```

`/opencode:result` prints the stored output plus an `opencode --session <id>` command, so you can pick up the same thread in the opencode TUI.

### The review gate (optional)

```bash
/opencode:setup --enable-review-gate
/opencode:setup --disable-review-gate
```

With the gate on, a `Stop` hook runs a working-tree review whenever Claude tries to finish. A verdict of `FIX FIRST` blocks the stop and feeds the findings back so Claude addresses them.

> [!WARNING]
> The gate can create a long Claude↔opencode loop and burn quota. Only enable it while you are watching the session. It is off by default.

## How it works

```
Claude Code
  └─ commands / opencode-rescue subagent
       └─ scripts/opencode-companion.mjs
            └─ opencode run --format json --auto --agent <plan|build> …
```

The companion spawns the CLI, folds its NDJSON event stream into a single result, and stores jobs (id, status, session id, output) under a per-workspace state directory. `--background` re-execs the companion detached and returns a job id right away. Your own `opencode.json` and agent config are used as-is.

Two details that matter for headless opencode, learned the hard way:

- **stdin is closed** — `opencode run` hangs forever on an inherited non-TTY stdin.
- **`--auto` is passed** — otherwise permission prompts block a run with nobody there to answer.

## Differences from the Codex plugin

- No `/transfer` equivalent — opencode's `import` consumes its own export format, not Claude's `.jsonl`.
- One companion script over the plain CLI, instead of the Codex app-server JSON-RPC broker (~400 lines vs ~6k).

## Development

```bash
npm test
```

Pure `node:test`, no framework. Contributions welcome — issues and PRs are the right place for bugs, new commands, and provider quirks. Keep the dependency count at zero.

Layout:

```
.claude-plugin/marketplace.json
plugins/opencode/
  .claude-plugin/plugin.json
  commands/       # 7 slash commands
  agents/         # opencode-rescue subagent
  hooks/          # optional Stop review gate
  scripts/        # opencode-companion.mjs + hook
tests/
```

## License

Apache-2.0.
