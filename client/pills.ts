import type {
  PluginButtonContentProps,
  PluginButtonIcon,
  PluginButtonRegistration,
  PluginComposerPillContribution,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { ciGet, lastPrRef, pillLabel, sameRef, tone, type CiStatus, type PrRef, type Tone } from "../shared/ci.ts";

// The slice of the host this module uses: index.client.tsx hands in the plugin context, the tests a fake.
export interface CiPillClient {
  addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration;
  paseo: Pick<PluginClientContext["paseo"], "agents">;
  rpc: PluginClientContext["rpc"];
}

type PaseoAgent = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>["entries"][number]["agent"];

const POLL_RUNNING_MS = 20_000;
const POLL_SETTLED_MS = 120_000; // a settled run still changes on a new push or a re-run

/** What each agent's pill shows, shared with the popover so both read one fetch. */
export interface CiEntry {
  ref: PrRef;
  strong: boolean; // the agent's own PR (see lastPrRef): a later mere mention does not replace it
  ci: CiStatus | null;
}
const entries = new Map<string, CiEntry>();
const listeners = new Set<() => void>();
export const ciEntry = (agentId: string) => entries.get(agentId) ?? null;
export function subscribeCi(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

interface Live {
  workspaceId: string;
  release: () => Promise<void>;
  reg: PluginButtonRegistration | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * One composer pill per agent that names a pull request (URL, `owner/repo#N`, `gh pr … N -R owner/repo`): the logo of
 * its forge, tinted by the state of its CI, and that state; the popover lists every check. The agent's own PR wins (see
 * lastPrRef).
 * shortcut: one PR per agent (the last named), upgrade if agents juggling several PRs need a list.
 */
export function registerCiPills(
  client: CiPillClient,
  Content: ComponentType<PluginButtonContentProps>,
  icon: (forge: PrRef["forge"], tone: Tone) => PluginButtonIcon,
): () => void {
  const live = new Map<string, Live>();
  const lifetime = new AbortController();
  let stopped = false;
  let stopAgents: (() => void) | undefined;
  let agentsSub: { release(): Promise<void> } | undefined;

  const drop = (agentId: string) => {
    const l = live.get(agentId);
    if (!l) return;
    live.delete(agentId);
    if (l.timer) clearTimeout(l.timer);
    l.reg?.remove();
    entries.delete(agentId);
    emit();
    void l.release().catch(() => {}); // a subscription that never established rejects on release: expected
  };

  const upsert = (agent: PaseoAgent) => {
    if (stopped || agent.status === "closed" || !agent.workspaceId) return drop(agent.id);
    const existing = live.get(agent.id);
    if (existing) {
      if (existing.workspaceId === agent.workspaceId) return;
      drop(agent.id); // moved workspace: the pill is registered under the old one
    }
    const workspaceId = agent.workspaceId;
    const handle = client.paseo.agents.ref(agent.id);
    const entry: Live = { workspaceId, release: () => Promise.resolve(), reg: null, timer: null };
    live.set(agent.id, entry);
    const current = () => live.get(agent.id) === entry;

    const poll = async () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      const e = entries.get(agent.id);
      if (!e || !current()) return;
      const ci = await client.rpc(ciGet, e.ref).catch((err: Error) => ({ ...noCi, error: String(err.message) }));
      if (!current() || entries.get(agent.id) !== e) return; // dropped, or a newer PR replaced it meanwhile
      e.ci = ci;
      entry.reg?.update({ label: pillLabel(e.ref, ci), icon: icon(e.ref.forge, tone(ci)) });
      emit();
      entry.timer = setTimeout(() => void poll(), ci.state === "pending" || ci.error ? POLL_RUNNING_MS : POLL_SETTLED_MS);
    };

    const see = (item: unknown) => {
      const found = lastPrRef(JSON.stringify(item));
      const had = entries.get(agent.id);
      if (!found || !current() || (had?.strong && !found.strong)) return;
      if (had && sameRef(found.ref, had.ref)) {
        had.strong ||= found.strong;
        return;
      }
      const ref = found.ref;
      entries.set(agent.id, { ref, strong: found.strong, ci: null });
      const button = { title: `CI de ${ref.repo}#${ref.number}`, icon: icon(ref.forge, null), label: pillLabel(ref, null) };
      if (entry.reg) entry.reg.update(button);
      else entry.reg = client.addComposerPill({ id: "ci", workspaceId, agentId: agent.id, button: { ...button, behavior: { kind: "popover", Content } } });
      emit();
      void poll();
    };

    const bootstrap = async () => {
      const page = await handle.timeline.refetch({ direction: "before", limit: 200, projection: "projected" }).catch(() => null);
      if (!page || !current()) return;
      see(page.entries.map((row) => row.item)); // one pass over the page: its last strong reference, else its last mention
    };
    const sub = handle.timeline.subscribe((e) => {
      if (!current()) return;
      if (e.event.type === "timeline") see(e.event.item);
      else if (e.event.type === "replacement" || e.event.type === "subscription_restored") void bootstrap();
    });
    sub.ready.catch(() => {});
    entry.release = () => sub.release();
    void bootstrap();
  };

  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(
    (result) => {
      if (stopped) {
        void result.subscription.release().catch(() => {});
        return;
      }
      agentsSub = result.subscription;
      for (const e of result.entries) upsert(e.agent);
      stopAgents = result.subscription.subscribe({
        snapshot: ({ entries: all }) => {
          const present = new Set(all.map((e) => e.agent.id));
          for (const e of all) upsert(e.agent);
          for (const agentId of [...live.keys()]) if (!present.has(agentId)) drop(agentId);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "upsert") upsert(message.payload.agent);
          else drop(message.payload.agentId);
        },
      });
    },
    () => {},
  );

  return () => {
    stopped = true;
    lifetime.abort();
    stopAgents?.();
    void agentsSub?.release().catch(() => {});
    for (const agentId of [...live.keys()]) drop(agentId);
  };
}

const noCi: CiStatus = { title: "", url: "", prState: "", branch: "", state: "none", checks: [], error: null };
