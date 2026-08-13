#!/usr/bin/env node
// Optional Stop hook: run a quick opencode review of the working tree before Claude stops.
// Enabled with `/opencode:setup --enable-review-gate`. Exit 2 + stderr blocks the stop.

import { spawnSync } from "node:child_process";

import { loadState } from "./opencode-companion.mjs";

const payload = await new Promise((resolve) => {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    try {
      resolve(JSON.parse(raw));
    } catch {
      resolve({});
    }
  });
  process.stdin.on("error", () => resolve({}));
});

const cwd = process.cwd();
if (!loadState(cwd).config.stopReviewGate || payload.stop_hook_active) process.exit(0);

const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8" });
if (!dirty.stdout?.trim()) process.exit(0);

const review = spawnSync(
  process.execPath,
  [new URL("opencode-companion.mjs", import.meta.url).pathname, "review"],
  { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);
const output = review.stdout ?? "";

if (!/FIX FIRST/i.test(output)) process.exit(0);

process.stderr.write(
  `opencode review gate found blocking issues. Address them before stopping:\n\n${output}\n`
);
process.exit(2);
