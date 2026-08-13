---
description: Delegate investigation, a fix, or follow-up work to the opencode rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <provider/model>] [--variant <effort>] [--read-only] [what opencode should do]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `opencode:opencode-rescue` subagent via the `Agent` tool (`subagent_type: "opencode:opencode-rescue"`), forwarding the raw user request as the prompt.
It is a subagent, not a skill — do not call it with `Skill(...)`.
The final user-visible response must be opencode's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:
- `--background` → run the subagent in the background. `--wait` → foreground. Neither → foreground.
- `--model`, `--variant`, `--read-only` are runtime flags: preserve them for the forwarded `task` call, but do not treat them as task text.
- If `--resume` or `--fresh` is present, do not ask; the user already chose.
- Otherwise check for a resumable opencode thread:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" task-resume-candidate
```

- If it reports `available: true`, use `AskUserQuestion` exactly once with `Continue current opencode thread` and `Start a new opencode thread`.
  - Put continue first with `(Recommended)` when the user is clearly following up ("continue", "keep going", "apply the top fix", "dig deeper"); otherwise put new-thread first.
  - Continue → add `--resume` before routing. New → add `--fresh`.
- If `available: false`, do not ask.

Operating rules:
- The subagent is a thin forwarder: one `Bash` call to the companion `task` command, stdout returned as-is.
- Do not paraphrase, summarize, or add commentary.
- Do not ask the subagent to inspect files, poll status, fetch results, or do follow-up work.
- If the companion reports opencode is missing, stop and tell the user to run `/opencode:setup`.
- If no request text was given, ask what opencode should investigate or fix.
