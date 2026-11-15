import { test } from "node:test";
import assert from "node:assert/strict";
import { registerCiPills, type CiPillClient } from "../client/pills.ts";

test("registerCiPills: one ci.refs for every agent, no timeline download", async () => {
  const calls: Array<{ name: string; input: any }> = [];
  const pills: string[] = [];
  const agent = (id: string) => ({ agent: { id, status: "idle", workspaceId: "w" } });
  const client = {
    addComposerPill: (c: any) => (pills.push(`${c.agentId} ${c.button.label}`), { update() {}, remove() {} }),
    rpc: async (contract: any, input: any) => {
      calls.push({ name: contract.name, input });
      if (contract.name === "ci.refs") return { refs: { a: { ref: { forge: "github", repo: "o/r", number: 7 }, strong: true }, b: null } };
      return { title: "", url: "", prState: "OPEN", branch: "", state: "pending", checks: [], error: null };
    },
    paseo: {
      agents: {
        list: async () => ({
          entries: [agent("a"), agent("b")],
          subscription: { subscribe: () => () => {}, release: async () => {} },
        }),
        ref: () => ({
          timeline: {
            refetch: () => assert.fail("the client must not download timelines"),
            subscribe: () => ({ ready: Promise.resolve(), release: async () => {} }),
          },
        }),
      },
    },
  } as unknown as CiPillClient;
  const stop = registerCiPills(client, () => null, () => ({ name: "x" }) as never);
  await new Promise((r) => setTimeout(r, 10));
  stop();
  assert.deepEqual(calls.filter((c) => c.name === "ci.refs").map((c) => c.input), [{ agentIds: ["a", "b"] }]);
  assert.deepEqual(pills, ["a #7"]);
});

test("registerCiPills: a merged PR is read once and not polled again", async () => {
  let gets = 0;
  const client = {
    addComposerPill: () => ({ update() {}, remove() {} }),
    rpc: async (contract: any) => {
      if (contract.name === "ci.refs") return { refs: { a: { ref: { forge: "github", repo: "o/r", number: 7 }, strong: true } } };
      gets++;
      return { title: "", url: "", prState: "MERGED", branch: "", state: "success", checks: [], error: null };
    },
    paseo: {
      agents: {
        list: async () => ({
          entries: [{ agent: { id: "a", status: "idle", workspaceId: "w" } }],
          subscription: { subscribe: () => () => {}, release: async () => {} },
        }),
        ref: () => ({ timeline: { subscribe: () => ({ ready: Promise.resolve(), release: async () => {} }) } }),
      },
    },
  } as unknown as CiPillClient;
  const realSetTimeout = globalThis.setTimeout;
  const timers: number[] = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => (timers.push(ms ?? 0), realSetTimeout(fn, 0))) as typeof setTimeout;
  try {
    const stop = registerCiPills(client, () => null, () => ({ name: "x" }) as never);
    await new Promise((r) => realSetTimeout(r, 20));
    stop();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(gets, 1);
  assert.ok(!timers.some((ms) => ms >= 20_000), `polls scheduled: ${timers}`);
});
