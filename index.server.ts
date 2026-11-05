import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ciGet } from "./shared/ci.ts";
import { readCi } from "./server/forges.ts";

// The daemon reads the forge with its own credentials (gh's login, BITBUCKET_* env): no token reaches the client.
export default function contribute(server: PluginServerContext) {
  server.handle(ciGet, (ref) => readCi(ref));
  return () => {};
}
