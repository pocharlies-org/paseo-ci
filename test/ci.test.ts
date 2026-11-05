import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPrRef, overall, pillLabel, tone } from "../shared/ci.ts";
import { ghCheck } from "../server/forges.ts";

test("lastPrRef: every form, the last one wins", () => {
  const ref = (text: string) => lastPrRef(text)?.ref ?? null;
  const pr1821 = { forge: "github", repo: "pocharlies-org/dgx-infra", number: 1821 };
  assert.deepEqual(ref("ver https://github.com/pocharlies-org/dgx-infra/pull/1821 ya"), pr1821);
  assert.deepEqual(ref("la CI de pocharlies-org/dgx-infra#1821 → con el gate"), pr1821);
  assert.deepEqual(ref("gh pr view 1821 -R pocharlies-org/dgx-infra --json state"), pr1821);
  assert.deepEqual(ref("a/b#1 y luego https://bitbucket.org/ws/repo/pull-requests/7"), { forge: "bitbucket", repo: "ws/repo", number: 7 });
  assert.equal(lastPrRef("k8s-paseo-pocharlies#7 y issue #12"), null); // no owner: not a reference we can read
  assert.equal(lastPrRef("https://github.com/o/r/issues/3"), null);
});

test("lastPrRef: the agent's own PR beats a later mention", () => {
  // the session of the screenshot: it waits on #1821 and then cites #1822, already merged, as the cause of a failure
  const text = "ESPERA: ci pocharlies-org/dgx-infra#1821 → fusiono. INFRA-1186 (https://github.com/pocharlies-org/dgx-infra/pull/1822)";
  assert.deepEqual(lastPrRef(text), { ref: { forge: "github", repo: "pocharlies-org/dgx-infra", number: 1821 }, strong: true });
  assert.equal(lastPrRef("gh pr merge 9 -R o/r --squash")?.strong, true);
  assert.deepEqual(lastPrRef('{"command":"gh pr create --fill","output":"https://github.com/o/r/pull/12"}'), {
    ref: { forge: "github", repo: "o/r", number: 12 }, strong: true,
  });
  assert.equal(lastPrRef("gh pr view 1822 -R o/r")?.strong, false);
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

test("tone: yellow running, red failed, green green or merged", () => {
  const ci = (prState: string, state: "pending" | "success" | "failure" | "none", error: string | null = null) =>
    ({ title: "", url: "", prState, branch: "", state, checks: [], error });
  assert.equal(tone(ci("OPEN", "pending")), "pending");
  assert.equal(tone(ci("OPEN", "failure")), "failure");
  assert.equal(tone(ci("OPEN", "success")), "success");
  assert.equal(tone(ci("MERGED", "failure")), "success"); // merged wins: the PR is done
  assert.equal(tone(ci("OPEN", "none")), null);
  assert.equal(tone(ci("OPEN", "pending", "gh: 404")), null);
  assert.equal(tone(null), null);
});
