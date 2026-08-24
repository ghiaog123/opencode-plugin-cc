#!/usr/bin/env node
// Companion runtime for the opencode Claude Code plugin.
// Wraps the local `opencode` CLI (`opencode run --format json`) as a job runner.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RETENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FINISHED_JOBS = 50;
const FINISHED_STATUSES = new Set(["completed", "failed", "cancelled"]);

// ---------------------------------------------------------------- state

export function resolveStateDir(cwd) {
  let real = cwd;
  try {
    real = fs.realpathSync.native(cwd);
  } catch {}
  const slug = (path.basename(real) || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const hash = createHash("sha256").update(real).digest("hex").slice(0, 16);
  const root = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, "state")
    : path.join(os.homedir(), ".opencode-companion");
  return path.join(root, `${slug}-${hash}`);
}

function stateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

const JOB_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function logFile(cwd, jobId) {
  if (!JOB_ID_RE.test(jobId)) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  return path.join(resolveStateDir(cwd), "jobs", `${jobId}.log`);
}

function loadState(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(cwd), "utf8"));
    return { config: {}, jobs: [], ...parsed };
  } catch {
    return { config: { stopReviewGate: false }, jobs: [] };
  }
}

function finishedTime(job) {
  const ms = Date.parse(job.finishedAt ?? job.updatedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

export function prune(cwd, jobs, now = Date.now()) {
  const active = jobs.filter((job) => !FINISHED_STATUSES.has(job.status));
  const finished = jobs
    .filter((job) => FINISHED_STATUSES.has(job.status))
    .sort((a, b) => finishedTime(b) - finishedTime(a));
  const cutoff = now - RETENTION_WINDOW_MS;
  const kept = [];
  for (const job of finished) {
    if (kept.length >= MAX_FINISHED_JOBS || finishedTime(job) < cutoff) {
      try {
        fs.unlinkSync(logFile(cwd, job.id));
      } catch {}
    } else {
      kept.push(job);
    }
  }
  return [...active, ...kept];
}

function saveState(cwd, state) {
  fs.mkdirSync(path.join(resolveStateDir(cwd), "jobs"), { recursive: true, mode: 0o700 });
  state.jobs = prune(cwd, state.jobs);
  fs.writeFileSync(stateFile(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

function upsertJob(cwd, patch) {
  const state = loadState(cwd);
  const now = new Date().toISOString();
  const i = state.jobs.findIndex((job) => job.id === patch.id);
  if (i === -1) state.jobs.unshift({ createdAt: now, updatedAt: now, ...patch });
  else state.jobs[i] = { ...state.jobs[i], ...patch, updatedAt: now };
  return saveState(cwd, state);
}

// ---------------------------------------------------------------- args

export function parseArgs(argv) {
  const opts = { text: [], flags: {} };
  const takesValue = new Set([
    "--base",
    "--model",
    "-m",
    "--agent",
    "--variant",
    "--effort",
    "--job-id",
    "--scope",
    "--timeout-ms"
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (takesValue.has(arg)) {
      const key = (arg === "-m" ? "--model" : arg).replace(/^--/, "");
      opts.flags[key === "effort" ? "variant" : key] = argv[++i];
    } else if (arg.startsWith("--")) {
      opts.flags[arg.slice(2)] = true;
    } else if (arg.trim()) {
      opts.text.push(arg);
    }
  }
  opts.prompt = opts.text.join(" ").trim();
  return opts;
}

// ---------------------------------------------------------------- opencode ndjson

// Fold an `opencode run --format json` NDJSON stream into a result summary.
export function foldEvents(ndjson) {
  const parts = new Map();
  const out = { sessionId: null, text: "", error: null, tokens: 0, lastEvent: null, tools: [] };
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    out.sessionId = event.sessionID ?? out.sessionId;
    out.lastEvent = event.type ?? out.lastEvent;
    const part = event.part ?? {};
    if (event.type === "text" && part.id) parts.set(part.id, part.text ?? "");
    if (event.type === "tool" && part.tool) out.tools.push(part.tool);
    if (event.type === "step_finish") out.tokens += part.tokens?.total ?? 0;
    if (event.type === "error") {
      out.error = event.error?.data?.message ?? event.error?.name ?? "unknown opencode error";
    }
  }
  out.text = [...parts.values()].join("\n").trim();
  return out;
}

function opencodeBin() {
  return process.env.OPENCODE_BIN || "opencode";
}

function checkOpencode() {
  const probe = spawnSync(opencodeBin(), ["--version"], { encoding: "utf8" });
  if (probe.error) return { installed: false };
  return { installed: probe.status === 0, version: (probe.stdout || "").trim() };
}

function checkAuth() {
  const probe = spawnSync(opencodeBin(), ["providers", "list"], { encoding: "utf8" });
  const text = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  return { authenticated: /credential/i.test(text) && !/0 credentials/.test(text), detail: text.trim() };
}

// ---------------------------------------------------------------- run

function buildRunArgs({ prompt, agent, model, variant, sessionId, resume }) {
  const args = ["run", "--format", "json", "--auto", "--agent", agent];
  if (model) args.push("--model", model);
  if (variant) args.push("--variant", variant);
  if (sessionId) args.push("--session", sessionId);
  else if (resume) args.push("--continue");
  args.push(prompt);
  return args;
}

async function runJob(cwd, job) {
  const target = logFile(cwd, job.id);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const stream = fs.createWriteStream(target);
  const child = spawn(opencodeBin(), buildRunArgs(job), {
    cwd,
    // stdin must be closed: `opencode run` blocks forever waiting on a piped stdin.
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(stream);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk.toString().slice(0, 4000)));
  upsertJob(cwd, { ...job, status: "running", pid: child.pid, logFile: target });

  const code = await new Promise((resolve) => child.on("close", resolve));
  const stored = loadState(cwd).jobs.find((candidate) => candidate.id === job.id);
  if (stored?.status === "cancelled") return stored;
  const folded = foldEvents(fs.readFileSync(target, "utf8"));
  const failed = code !== 0 || Boolean(folded.error) || !folded.text;
  const finished = {
    ...job,
    status: failed ? "failed" : "completed",
    pid: null,
    logFile: target,
    sessionId: folded.sessionId,
    tokens: folded.tokens,
    result: folded.text,
    error: folded.error ?? (failed ? stderr.trim() || `opencode exited with code ${code}` : null),
    finishedAt: new Date().toISOString()
  };
  upsertJob(cwd, finished);
  return finished;
}

// ---------------------------------------------------------------- render

function elapsed(job) {
  const start = Date.parse(job.createdAt);
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  return `${Math.max(0, Math.round((end - start) / 1000))}s`;
}

export function renderJob(job) {
  const head = [
    `## opencode ${job.kind} — ${job.id}`,
    `status: ${job.status} · ${elapsed(job)}${job.model ? ` · ${job.model}` : ""}${
      job.sessionId ? ` · session ${job.sessionId}` : ""
    }`
  ];
  const body = job.status === "completed" ? job.result : job.error || "(no output)";
  const footer = job.sessionId
    ? `\n---\nContinue this thread in opencode: \`opencode --session ${job.sessionId}\``
    : "";
  return `${head.join("\n")}\n\n${body}${footer}\n`;
}

function renderStatus(cwd, jobs) {
  if (!jobs.length) return "No opencode jobs for this repository yet.\n";
  const rows = jobs.map((job) => {
    const summary = (job.status === "completed" ? job.result : job.error || "")
      .split("\n")
      .find((line) => line.trim()) ?? "";
    return `| ${job.id} | ${job.kind} | ${live(job)} | ${elapsed(job)} | ${summary.slice(0, 70).replace(/\|/g, "/")} |`;
  });
  return [
    "| job | kind | status | elapsed | summary |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "`/opencode:result <job>` for full output · `/opencode:cancel <job>` to stop a running job."
  ].join("\n");
}

function live(job) {
  if (job.status !== "running") return job.status;
  try {
    process.kill(job.pid, 0);
    return "running";
  } catch {
    return "stale";
  }
}

// ---------------------------------------------------------------- prompts

const REVIEW_RULES = `You are reviewing code. You are read-only: do not edit, create, or delete files.
Inspect the diff yourself with git (e.g. \`git status --short\`, \`git diff\`, \`git diff --stat\`).
Report only real, evidence-backed problems. For each finding give: file:line, severity (blocker/major/minor), what breaks, and the concrete fix.
End with a one-line verdict: SHIP or FIX FIRST.`;

function reviewPrompt(base, focus, adversarial) {
  const target = base
    ? `Review the branch diff: \`git diff ${base}...HEAD\` (base ref: ${base}).`
    : "Review the uncommitted working tree, including untracked files.";
  const framing = adversarial
    ? `This is an ADVERSARIAL review. Challenge the approach itself, not just defects: question the design choices,
tradeoffs, hidden assumptions, failure modes under real load, and whether a simpler or safer approach existed.
Say plainly if the direction is wrong.`
    : "";
  return [REVIEW_RULES, target, framing, focus ? `Extra focus from the user: ${focus}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------- commands

function jobId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function detach(argv, id) {
  const child = spawn(process.execPath, [process.argv[1], ...argv, "--job-id", id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function start(kind, opts, prompt) {
  const cwd = process.cwd();
  const ready = checkOpencode();
  if (!ready.installed) {
    return "opencode CLI not found. Run `/opencode:setup`.\n";
  }
  const id = opts.flags["job-id"] || jobId(kind === "task" ? "task" : "review");
  const job = {
    id,
    kind,
    prompt,
    agent: opts.flags.agent || (kind === "task" && !opts.flags["read-only"] ? "build" : "plan"),
    model: opts.flags.model || null,
    variant: opts.flags.variant || null,
    resume: Boolean(opts.flags["resume-last"]),
    sessionId: opts.flags["resume-last"] ? latestSession(cwd) : null,
    status: "queued",
    createdAt: new Date().toISOString(),
    claudeSessionId: process.env.CLAUDE_SESSION_ID ?? null
  };

  if (opts.flags.background && !opts.flags["job-id"]) {
    upsertJob(cwd, job);
    detach(process.argv.slice(2).filter((arg) => arg !== "--background"), id);
    return `Started ${kind} in the background as \`${id}\`.\nCheck \`/opencode:status\` for progress, \`/opencode:result ${id}\` when done.\n`;
  }
  return renderJob(await runJob(cwd, job));
}

function latestSession(cwd) {
  const job = loadState(cwd).jobs.find((candidate) => candidate.kind === "task" && candidate.sessionId);
  return job?.sessionId ?? null;
}

function pickJob(cwd, id) {
  const jobs = loadState(cwd).jobs;
  if (id) return jobs.find((job) => job.id === id);
  return jobs.find((job) => job.status === "completed" || job.status === "failed") ?? jobs[0];
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const cwd = process.cwd();

  switch (command) {
    case "review":
      return process.stdout.write(
        await start("review", opts, reviewPrompt(opts.flags.base, opts.prompt, false))
      );
    case "adversarial-review":
      return process.stdout.write(
        await start("adversarial-review", opts, reviewPrompt(opts.flags.base, opts.prompt, true))
      );
    case "task": {
      if (!opts.prompt) return process.stdout.write("No task text given.\n");
      return process.stdout.write(await start("task", opts, opts.prompt));
    }
    case "status": {
      const id = opts.text[0];
      const jobs = loadState(cwd).jobs;
      if (id) {
        const job = jobs.find((candidate) => candidate.id === id);
        return process.stdout.write(job ? renderJob(job) : `No job \`${id}\`.\n`);
      }
      return process.stdout.write(`${renderStatus(cwd, jobs)}\n`);
    }
    case "result": {
      const job = pickJob(cwd, opts.text[0]);
      return process.stdout.write(job ? renderJob(job) : "No opencode jobs yet.\n");
    }
    case "cancel": {
      const job = loadState(cwd).jobs.find(
        (candidate) => (opts.text[0] ? candidate.id === opts.text[0] : candidate.status === "running")
      );
      if (!job?.pid) return process.stdout.write("No running opencode job to cancel.\n");
      try {
        process.kill(job.pid);
      } catch {}
      upsertJob(cwd, { id: job.id, status: "cancelled", pid: null });
      return process.stdout.write(`Cancelled \`${job.id}\`.\n`);
    }
    case "task-resume-candidate": {
      const sessionId = latestSession(cwd);
      return process.stdout.write(`${JSON.stringify({ available: Boolean(sessionId), sessionId })}\n`);
    }
    case "setup": {
      const state = loadState(cwd);
      if (opts.flags["enable-review-gate"]) state.config.stopReviewGate = true;
      if (opts.flags["disable-review-gate"]) state.config.stopReviewGate = false;
      saveState(cwd, state);
      const cli = checkOpencode();
      const auth = cli.installed ? checkAuth() : { authenticated: false };
      const report = {
        installed: cli.installed,
        version: cli.version ?? null,
        authenticated: auth.authenticated,
        reviewGate: state.config.stopReviewGate,
        stateDir: resolveStateDir(cwd)
      };
      if (opts.flags.json) return process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return process.stdout.write(
        [
          `opencode CLI: ${cli.installed ? `ready (${cli.version})` : "NOT FOUND"}`,
          `auth: ${auth.authenticated ? "signed in" : "no credentials — run `!opencode providers login`"}`,
          `stop review gate: ${state.config.stopReviewGate ? "enabled" : "disabled"}`,
          ""
        ].join("\n")
      );
    }
    default:
      return process.stdout.write(
        "usage: opencode-companion.mjs <review|adversarial-review|task|status|result|cancel|setup|task-resume-candidate> [args]\n"
      );
  }
}

export { loadState, runJob, reviewPrompt };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
