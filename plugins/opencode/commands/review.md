---
description: Run an opencode code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--model <provider/model>] [--variant <effort>]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an opencode review through the companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only. Do not fix issues or apply patches.
- Return opencode's output verbatim.

Execution mode rules:
- If the arguments include `--wait`, run in the foreground without asking.
- If the arguments include `--background`, pass `--background` through and return immediately.
- Otherwise size the change first: `git status --short --untracked-files=all`, plus `git diff --shortstat` and `git diff --shortstat --cached` (or `git diff --shortstat <base>...HEAD` when `--base` is given).
  - Recommend waiting only when the change is clearly tiny (roughly 1-2 files).
  - In every other case, including unclear size, recommend background.
  - Only report "nothing to review" when the scope really is empty.
- Then use `AskUserQuestion` exactly once with `Wait for results` and `Run in background`, recommended option first and suffixed `(Recommended)`.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" review $ARGUMENTS
```

- The companion self-detaches on `--background` and prints the job id immediately.
- Return the command stdout verbatim. Do not summarize or add commentary.
- If it reports opencode is missing, tell the user to run `/opencode:setup`.
