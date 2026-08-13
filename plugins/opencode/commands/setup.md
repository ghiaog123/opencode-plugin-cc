---
description: Check whether the local opencode CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/opencode-companion.mjs" setup --json $ARGUMENTS
```

Output rules:
- Present the setup output to the user.
- If `installed` is false, tell them to install opencode: `curl -fsSL https://opencode.ai/install | bash` (or `npm i -g opencode-ai`). Do not install it for them without asking.
- If `authenticated` is false, tell them to run `!opencode providers login`.
- If the review gate was toggled, say so and warn that the gate can create a long Claude/opencode loop and should only be enabled while actively watching the session.
