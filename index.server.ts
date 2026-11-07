import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ciGet, ciRefs, lastPrRef } from "./shared/ci.ts";
import { readCi } from "./server/forges.ts";

// The daemon reads the forge with its own credentials (gh's login, BITBUCKET_* env): no token reaches the client.
export default function contribute(server: PluginServerContext) {
  server.handle(ciGet, (ref) => readCi(ref));
  // The timelines are read here, next to the daemon: shipping 200 rows per agent to every web client saturated its socket.
  server.handle(ciRefs, async ({ agentIds }, { paseo }) => ({
    refs: Object.fromEntries(
      await Promise.all(
        agentIds.map(async (id) => {
          const page = await paseo.agents.ref(id).timeline.refetch({ direction: "before", limit: 200, projection: "projected" }).catch(() => null);
          return [id, page ? lastPrRef(JSON.stringify(page.entries.map((row) => row.item))) : null] as const;
        }),
      ),
    ),
  }));
  return () => {};
}
