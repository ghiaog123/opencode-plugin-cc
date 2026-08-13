---
description: Show the stored final output for a finished opencode job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" result $ARGUMENTS`

Present the full output verbatim. Preserve the job ID, status, findings, file paths, line numbers, error text, and the `opencode --session <id>` resume command.
