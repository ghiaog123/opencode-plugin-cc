#!/usr/bin/env node
// Optional Stop hook: run a quick opencode review of the working tree before Claude stops.
// Enabled with `/opencode:setup --enable-review-gate`. Exit 2 + stderr blocks the stop.

import { spawnSync } from "node:child_process";

import { filterJobsForSession, loadState, SESSION_ID_ENV } from "./opencode-companion.mjs";

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
const state = loadState(cwd);

const sessionId = payload.session_id || process.env[SESSION_ID_ENV] || null;
const runningJob = filterJobsForSession(state.jobs, sessionId).find(
  (job) => job.status === "queued" || job.status === "running"
);
if (runningJob) {
  process.stderr.write(
    `opencode job \`${runningJob.id}\` is still running. Check \`/opencode:status\` and use \`/opencode:cancel ${runningJob.id}\` if you want to stop it before ending the session.\n`
  );
}

if (!state.config.stopReviewGate || payload.stop_hook_active) process.exit(0);

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
