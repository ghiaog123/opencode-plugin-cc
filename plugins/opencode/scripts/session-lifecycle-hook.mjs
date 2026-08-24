#!/usr/bin/env node
// SessionStart: export this Claude session's id so opencode-companion.mjs can tag jobs with it.
// SessionEnd: kill and drop any opencode jobs still tied to this session.

import fs from "node:fs";

import { removeSessionJobs, SESSION_ID_ENV } from "./opencode-companion.mjs";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function handleSessionStart(input) {
  if (!process.env.CLAUDE_ENV_FILE || !input.session_id) return;
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${SESSION_ID_ENV}=${shellEscape(input.session_id)}\n`, "utf8");
}

function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  removeSessionJobs(cwd, input.session_id || process.env[SESSION_ID_ENV]);
}

function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";
  if (eventName === "SessionStart") return handleSessionStart(input);
  if (eventName === "SessionEnd") return handleSessionEnd(input);
}

main();
