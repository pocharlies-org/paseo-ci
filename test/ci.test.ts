import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPrRef, overall, pillLabel } from "../shared/ci.ts";
import { ghCheck } from "../server/forges.ts";

test("lastPrRef: every form, the last one wins", () => {
  assert.deepEqual(lastPrRef("ver https://github.com/pocharlies-org/dgx-infra/pull/1821 ya"), {
    forge: "github", repo: "pocharlies-org/dgx-infra", number: 1821,
  });
  assert.deepEqual(lastPrRef("ESPERA: ci pocharlies-org/dgx-infra#1821 → con el gate"), {
    forge: "github", repo: "pocharlies-org/dgx-infra", number: 1821,
  });
  assert.deepEqual(lastPrRef("gh pr merge 1821 -R pocharlies-org/dgx-infra --squash"), {
    forge: "github", repo: "pocharlies-org/dgx-infra", number: 1821,
  });
  assert.deepEqual(lastPrRef("a/b#1 y luego https://bitbucket.org/ws/repo/pull-requests/7"), {
    forge: "bitbucket", repo: "ws/repo", number: 7,
  });
  assert.equal(lastPrRef("k8s-paseo-pocharlies#7 y issue #12"), null); // no owner: not a reference we can read
  assert.equal(lastPrRef("https://github.com/o/r/issues/3"), null);
});

test("overall and label", () => {
  const ref = { forge: "github" as const, repo: "o/r", number: 9 };
  const ci = (states: Array<"pending" | "success" | "failure">) => ({
    title: "t", url: "", prState: "OPEN", branch: "b", error: null,
    state: overall(states.map((state) => ({ state }))),
    checks: states.map((state) => ({ name: "n", workflow: "", state, detail: "", url: "", startedAt: null, completedAt: null })),
  });
  assert.equal(pillLabel(ref, ci(["success", "pending", "pending"])), "#9 ◐ 1/3");
  assert.equal(pillLabel(ref, ci(["success", "failure", "pending"])), "#9 ✗ 1");
  assert.equal(pillLabel(ref, ci(["success"])), "#9 ✓");
  assert.equal(overall([]), "none");
  assert.equal(pillLabel(ref, null), "#9");
});

test("ghCheck: CheckRun and StatusContext", () => {
  assert.equal(ghCheck({ __typename: "CheckRun", name: "a", status: "IN_PROGRESS", conclusion: "" }).state, "pending");
  assert.equal(ghCheck({ __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "SKIPPED" }).state, "success");
  assert.equal(ghCheck({ __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "TIMED_OUT" }).state, "failure");
  const s = ghCheck({ __typename: "StatusContext", context: "argo", state: "PENDING", targetUrl: "u", startedAt: "0001-01-01T00:00:00Z" });
  assert.deepEqual([s.name, s.state, s.url, s.startedAt], ["argo", "pending", "u", null]);
});
