import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ciGet, ciRefs, lastPrRef } from "./shared/ci.ts";
import { readCi } from "./server/forges.ts";
import { timelineCache } from "./server/refs.ts";

// The daemon reads the forge with its own credentials (gh's login, BITBUCKET_* env): no token reaches the client.
export default function contribute(server: PluginServerContext) {
  server.handle(ciGet, (ref) => readCi(ref));
  // The timelines are read here, next to the daemon: shipping 200 rows per agent to every web client saturated its socket.
  const prs = timelineCache((items) => lastPrRef(JSON.stringify(items)));
  server.on("agent.turn_started", ({ agent }) => prs.forget(agent.id));
  server.on("agent.turn_ended", ({ agent }) => prs.forget(agent.id));
  server.handle(ciRefs, async ({ agentIds }, { paseo }) => ({
    refs: Object.fromEntries(await Promise.all(agentIds.map(async (id) => [id, await prs.get(paseo, id)] as const))),
  }));
  return () => {};
}
