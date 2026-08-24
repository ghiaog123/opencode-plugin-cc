import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { foldEvents, logFile, parseArgs, prune, renderJob, reviewPrompt } from "../plugins/opencode/scripts/opencode-companion.mjs";

test("parseArgs splits flags, values, and free text", () => {
  const opts = parseArgs(["--background", "--base", "main", "-m", "opencode-go/kimi-k3", "look", "for", "races"]);
  assert.equal(opts.flags.background, true);
  assert.equal(opts.flags.base, "main");
  assert.equal(opts.flags.model, "opencode-go/kimi-k3");
  assert.equal(opts.prompt, "look for races");
});

test("parseArgs maps --effort onto opencode's --variant", () => {
  assert.equal(parseArgs(["--effort", "high"]).flags.variant, "high");
});

test("foldEvents keeps the latest text per part and reports errors", () => {
  const ndjson = [
    JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { id: "p0" } }),
    JSON.stringify({ type: "text", sessionID: "ses_1", part: { id: "p1", text: "partial" } }),
    JSON.stringify({ type: "text", sessionID: "ses_1", part: { id: "p1", text: "PONG" } }),
    JSON.stringify({ type: "step_finish", sessionID: "ses_1", part: { tokens: { total: 42 } } }),
    "not json"
  ].join("\n");
  const folded = foldEvents(ndjson);
  assert.equal(folded.text, "PONG");
  assert.equal(folded.sessionId, "ses_1");
  assert.equal(folded.tokens, 42);
  assert.equal(folded.error, null);
});

test("foldEvents surfaces API errors", () => {
  const folded = foldEvents(
    JSON.stringify({ type: "error", sessionID: "ses_2", error: { name: "APIError", data: { message: "boom" } } })
  );
  assert.equal(folded.error, "boom");
  assert.equal(folded.text, "");
});

test("reviewPrompt targets branch diff only when a base is given", () => {
  assert.match(reviewPrompt("main", "", false), /git diff main\.\.\.HEAD/);
  assert.match(reviewPrompt(null, "", false), /uncommitted working tree/);
  assert.match(reviewPrompt(null, "auth", true), /ADVERSARIAL[\s\S]*focus from the user: auth/);
});

test("logFile rejects job ids that could escape the jobs directory", () => {
  assert.throws(() => logFile("/tmp", "../escape"), /Invalid job id/);
  assert.throws(() => logFile("/tmp", "a/b"), /Invalid job id/);
  assert.throws(() => logFile("/tmp", "x".repeat(65)), /Invalid job id/);
  assert.doesNotThrow(() => logFile("/tmp", "review-abc_123.4"));
});

test("prune drops finished jobs older than the retention window", () => {
  const now = Date.parse("2026-01-15T00:00:00Z");
  const fresh = {
    id: "fresh-1", status: "completed",
    createdAt: "2026-01-14T00:00:00Z", updatedAt: "2026-01-14T00:00:00Z", finishedAt: "2026-01-14T00:00:00Z"
  };
  const stale = {
    id: "stale-1", status: "failed",
    createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:00:00Z"
  };
  assert.deepEqual(prune("/tmp", [fresh, stale], now).map((job) => job.id), ["fresh-1"]);
});

test("prune keeps running jobs regardless of age", () => {
  const now = Date.parse("2026-01-15T00:00:00Z");
  const running = {
    id: "run-1", status: "running", pid: 123,
    createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z"
  };
  assert.deepEqual(prune("/tmp", [running], now).map((job) => job.id), ["run-1"]);
});

test("prune caps retained finished jobs, keeping the newest", () => {
  const now = Date.parse("2026-01-15T00:00:00Z");
  const jobs = Array.from({ length: 60 }, (_, i) => {
    const t = new Date(now - (59 - i) * 1000).toISOString();
    return { id: `job-${i}`, status: "completed", createdAt: t, updatedAt: t, finishedAt: t };
  });
  const ids = prune("/tmp", jobs, now).map((job) => job.id);
  assert.equal(ids.length, 50);
  assert.ok(ids.includes("job-59"));
  assert.ok(ids.includes("job-10"));
  assert.ok(!ids.includes("job-9"));
});

test("prune deletes log files for dropped jobs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "companion-"));
  try {
    const now = Date.parse("2026-01-15T00:00:00Z");
    const stale = {
      id: "stale-1", status: "completed",
      createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:00:00Z"
    };
    const keep = {
      id: "keep-1", status: "completed",
      createdAt: "2026-01-14T00:00:00Z", updatedAt: "2026-01-14T00:00:00Z", finishedAt: "2026-01-14T00:00:00Z"
    };
    for (const job of [stale, keep]) {
      const f = logFile(tmp, job.id);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, "log");
    }
    assert.deepEqual(prune(tmp, [stale, keep], now).map((job) => job.id), ["keep-1"]);
    assert.equal(fs.existsSync(logFile(tmp, "stale-1")), false);
    assert.equal(fs.existsSync(logFile(tmp, "keep-1")), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("renderJob shows the resume hint for completed jobs", () => {
  const rendered = renderJob({
    id: "review-1",
    kind: "review",
    status: "completed",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sessionId: "ses_9",
    result: "SHIP"
  });
  assert.match(rendered, /opencode --session ses_9/);
  assert.match(rendered, /SHIP/);
});
