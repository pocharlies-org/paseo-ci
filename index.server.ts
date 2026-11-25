import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ciGet, ciRefs, esperaGithub, lastPrRef } from "./shared/ci.ts";
import { readCi } from "./server/forges.ts";
import { timelineCache } from "./server/refs.ts";

// The daemon reads the forge with its own credentials (gh's login, BITBUCKET_* env): no token reaches the client.
export default function contribute(server: PluginServerContext) {
  server.handle(ciGet, (ref) => readCi(ref));
  // The timelines are read here, next to the daemon: shipping 200 rows per agent to every web client saturated its socket.
  const prs = timelineCache((items) => ({ ref: lastPrRef(JSON.stringify(items)), waiting: esperaGithub(items) }));
  server.on("agent.turn_started", ({ agent }) => prs.forget(agent.id));
  server.on("agent.turn_ended", ({ agent }) => prs.forget(agent.id));
  server.handle(ciRefs, async ({ agentIds }, { paseo }) => {
    const found = await Promise.all(agentIds.map((id) => prs.get(paseo, id)));
    return {
      refs: Object.fromEntries(agentIds.map((id, i) => [id, found[i]?.ref ?? null] as const)),
      esperas: Object.fromEntries(agentIds.map((id, i) => [id, found[i]?.waiting ?? false] as const)),
    };
  });
  return () => {};
}
