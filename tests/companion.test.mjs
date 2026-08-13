import assert from "node:assert/strict";
import test from "node:test";

import { foldEvents, parseArgs, renderJob, reviewPrompt } from "../plugins/opencode/scripts/opencode-companion.mjs";

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
