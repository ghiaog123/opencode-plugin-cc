---
description: Cancel an active background opencode job in this repository
argument-hint: '[job-id]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" cancel $ARGUMENTS`
