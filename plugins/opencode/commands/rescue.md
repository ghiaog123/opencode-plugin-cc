---
description: Delegate investigation, a fix, or follow-up work to opencode
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <provider/model>] [--variant <effort>] [--read-only] [what opencode should do]"
allowed-tools: Bash(node:*), AskUserQuestion
---

Run the task with one `Bash` call and return its stdout verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" task [flags] "<task text>"
```

Do not route this through the `opencode-rescue` subagent. The companion already returns a compact
report, so a subagent hop isolates nothing and costs ~10k tokens per call. The subagent exists only
for the unprompted path ("ask opencode to …"), where no command was invoked.

Raw user request:
$ARGUMENTS

Building the command:
- `--model`, `--variant`, `--read-only` are runtime flags: pass them through, do not treat them as task text.
- Strip the routing flags (`--background`, `--wait`, `--resume`, `--fresh`) from the task text.
- Tasks are write-capable by default (opencode `build` agent). Add `--read-only` when the user only
  wants investigation, diagnosis, or research.
- Leave `--model` and `--variant` unset unless the user asked for a specific model or effort.
- Preserve the rest of the user's wording as-is.

Execution mode:
- `--background` → add `--background`; the companion detaches and returns a job id immediately.
- `--wait` or neither → foreground.
- Prefer `--background` on your own for open-ended, multi-step, or long-running work.

Session choice:
- `--resume` → add `--resume-last`. `--fresh` → do not. Either flag present means the user already
  chose; do not ask.
- Otherwise check for a resumable thread:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" task-resume-candidate
```

- If it reports `available: true`, use `AskUserQuestion` exactly once with `Continue current opencode thread`
  and `Start a new opencode thread`. Put continue first with `(Recommended)` when the user is clearly
  following up ("continue", "keep going", "apply the top fix", "dig deeper"); otherwise put new first.
- If `available: false`, do not ask.

Operating rules:
- Return the companion's stdout as-is. Do not paraphrase, summarize, or add commentary.
- Do not inspect files, grep, poll status, or fetch results yourself — that is opencode's job.
- If the companion reports opencode is missing, stop and tell the user to run `/opencode:setup`.
- If no request text was given, ask what opencode should investigate or fix.
