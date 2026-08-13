---
description: Show active and recent opencode jobs for this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" status $ARGUMENTS`

Without a job ID: render the output as a single compact Markdown table, no extra prose.
With a job ID: present the full output as-is. Do not summarize.
