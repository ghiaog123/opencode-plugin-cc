---
description: Run an opencode review that challenges the implementation approach and design choices
argument-hint: '[--wait|--background] [--base <ref>] [--model <provider/model>] [focus ...]'
allowed-tools: Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial opencode review: it questions the chosen implementation, design, tradeoffs, and assumptions, not just defects.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- Review-only. Do not fix issues or apply patches.
- Do not weaken the adversarial framing or rewrite the user's focus text.
- Return opencode's output verbatim.

Execution mode rules: same as `/opencode:review` — honor `--wait` / `--background`, otherwise size the diff and ask once with `AskUserQuestion` (`Wait for results` / `Run in background`, recommended first).

Any text after the flags is passed through as extra focus for the review.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" adversarial-review $ARGUMENTS
```

Return the command stdout verbatim.
