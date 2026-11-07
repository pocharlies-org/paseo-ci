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
