import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { GLYPH, type CheckState } from "../shared/ci.ts";
import { ciEntry, subscribeCi } from "./pills.ts";

const ORDER: Record<CheckState, number> = { failure: 0, pending: 1, success: 2, none: 3 };

function duration(start: string | null, end: string | null, now: number): string {
  if (!start) return "";
  const s = Math.max(0, Math.round(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function CiPopover(props: PluginButtonContentProps) {
  const { theme } = props;
  const c = theme.colors;
  const agentId = props.context === "agent" ? props.agentId : "";
  const [, setTick] = useState(0);
  useEffect(() => subscribeCi(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000); // running checks' clocks
    return () => clearInterval(t);
  }, []);
  const entry = ciEntry(agentId);
  const color = (s: CheckState) =>
    s === "success" ? c.statusSuccess : s === "failure" ? c.statusDanger : s === "pending" ? c.accent : c.foregroundMuted;
  const muted = { color: c.foregroundMuted, fontSize: 12 };

  if (!entry) return <Text style={{ ...muted, padding: 12 }}>Sin pull request en esta conversación.</Text>;
  const { ref, ci } = entry;
  const forge = ref.forge === "github" ? "GitHub" : "Bitbucket";
  const checks = [...(ci?.checks ?? [])].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const now = Date.now();
  const counts = (s: CheckState) => checks.filter((k) => k.state === s).length;

  return (
    <View style={{ padding: 12, gap: 8, minWidth: 320, maxWidth: 480 }}>
      <View style={{ gap: 2 }}>
        <Text style={muted}>
          {forge} · {ref.repo}#{ref.number}
          {ci?.branch ? ` · ${ci.branch}` : ""}
          {ci?.prState ? ` · ${ci.prState}` : ""}
        </Text>
        {ci?.url ? (
          <ExternalLink href={ci.url}>
            <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>{ci.title || "Abrir el PR"}</Text>
          </ExternalLink>
        ) : null}
      </View>
      {!ci ? <Text style={muted}>Leyendo la CI…</Text> : null}
      {ci?.error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{ci.error}</Text> : null}
      {ci && !ci.error ? (
        <Text style={{ color: color(ci.state), fontSize: 13, fontWeight: "600" }}>
          {GLYPH[ci.state]}{" "}
          {ci.state === "none"
            ? "Sin checks"
            : `${counts("success")} ok · ${counts("pending")} en curso · ${counts("failure")} fallidos`}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6 }}>
        {checks.map((k, i) => {
          const row = (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: color(k.state), width: 16, textAlign: "center" }}>{GLYPH[k.state]}</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13 }}>
                  {k.name}
                </Text>
                <Text numberOfLines={1} style={muted}>
                  {[k.workflow, k.detail.toLowerCase().replace(/_/g, " "), duration(k.startedAt, k.completedAt, now)].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </View>
          );
          return k.url ? (
            <ExternalLink key={i} href={k.url} accessibilityLabel={`Abrir ${k.name}`}>
              {row}
            </ExternalLink>
          ) : (
            <View key={i}>{row}</View>
          );
        })}
      </ScrollView>
    </View>
  );
}
