import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const forge = z.enum(["github", "bitbucket"]);
const state = z.enum(["pending", "success", "failure", "none"]);

export const prRefSchema = z.object({
  forge,
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  number: z.number().int().positive(),
});
export type PrRef = z.output<typeof prRefSchema>;

export const ciSchema = z.object({
  title: z.string(),
  url: z.string(),
  prState: z.string(),
  branch: z.string(),
  state,
  checks: z.array(
    z.object({
      name: z.string(),
      workflow: z.string(),
      state,
      detail: z.string(), // the forge's own word: IN_PROGRESS, FAILURE, SKIPPED…
      url: z.string(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
    }),
  ),
  error: z.string().nullable(),
});
export type CiStatus = z.output<typeof ciSchema>;
export type CheckState = z.output<typeof state>;

/** The CI of one pull request, read by the daemon with its own credentials (gh, Bitbucket token). */
export const ciGet = defineRpc({ name: "ci.get", input: prRefSchema.strict(), output: ciSchema });

const gh = (repo: string, n: string): PrRef => ({ forge: "github", repo, number: +n });
const R = "([\\w.-]+\\/[\\w.-]+)";

// A mention is any reference; a strong one says the PR is the agent's own: its `ESPERA: ci|merge|review` line, the
// checks or merge it runs, or the URL `gh pr create` printed. Agents also cite PRs they only read (`gh pr view`, «ya
// fusionados en master»): the last strong reference wins over any later mention.
const STRONG: Array<[RegExp, (m: RegExpExecArray) => PrRef]> = [
  [new RegExp(`ESPERA:\\s*(?:ci|merge|review)\\s+${R}#(\\d+)`, "g"), (m) => gh(m[1], m[2])],
  [new RegExp(`gh pr (?:checks|merge) (\\d+)\\b[^\\n"]*?(?:-R|--repo)[ =]${R}`, "g"), (m) => gh(m[2], m[1])],
];
const URLS: Array<[RegExp, (m: RegExpExecArray) => PrRef]> = [
  [new RegExp(`github\\.com\\/${R}\\/pull\\/(\\d+)`, "g"), (m) => gh(m[1], m[2])],
  [new RegExp(`bitbucket\\.org\\/${R}\\/pull-requests\\/(\\d+)`, "g"), (m) => ({ forge: "bitbucket", repo: m[1], number: +m[2] })],
];
const MENTIONS: Array<[RegExp, (m: RegExpExecArray) => PrRef]> = [
  ...URLS,
  [new RegExp(`gh pr \\w+ (\\d+)\\b[^\\n"]*?(?:-R|--repo)[ =]${R}`, "g"), (m) => gh(m[2], m[1])],
  [new RegExp(`(?<![\\w./-])${R}#(\\d+)\\b`, "g"), (m) => gh(m[1], m[2])],
];

function last(text: string, patterns: Array<[RegExp, (m: RegExpExecArray) => PrRef]>): PrRef | null {
  let best: { at: number; ref: PrRef } | null = null;
  for (const [re, make] of patterns) {
    for (const m of text.matchAll(re)) {
      if (!best || m.index! >= best.at) best = { at: m.index!, ref: make(m as RegExpExecArray) };
    }
  }
  return best?.ref ?? null;
}

/** The pull request a piece of text points at: its last strong reference, else its last mention. */
export function lastPrRef(text: string): { ref: PrRef; strong: boolean } | null {
  const strong = last(text, /gh pr create/.test(text) ? [...STRONG, ...URLS] : STRONG);
  if (strong) return { ref: strong, strong: true };
  const mention = last(text, MENTIONS);
  return mention ? { ref: mention, strong: false } : null;
}

export const sameRef = (a: PrRef | null, b: PrRef | null) =>
  !!a && !!b && a.forge === b.forge && a.repo === b.repo && a.number === b.number;

export function overall(checks: ReadonlyArray<{ state: CheckState }>): CheckState {
  if (checks.some((c) => c.state === "failure")) return "failure";
  if (checks.some((c) => c.state === "pending")) return "pending";
  return checks.length ? "success" : "none";
}

/** The pill's colour: yellow while checks run, red when one failed, green once green or merged; none when unknown. */
export type Tone = "pending" | "failure" | "success" | null;
export function tone(ci: CiStatus | null): Tone {
  if (!ci || ci.error) return null;
  if (ci.prState === "MERGED") return "success";
  return ci.state === "none" ? null : ci.state;
}

export const GLYPH: Record<CheckState, string> = { success: "✓", failure: "✗", pending: "◐", none: "·" };

/** The pill's short label: `#1821 ◐ 3/7`, `#1821 ✓`, `#1821 ✗ 2`. */
export function pillLabel(ref: PrRef, ci: CiStatus | null): string {
  const head = `#${ref.number}`;
  if (!ci) return head;
  if (ci.error) return `${head} ?`;
  if (ci.prState === "MERGED") return `${head} fusionado`;
  const done = ci.checks.filter((c) => c.state !== "pending").length;
  const failed = ci.checks.filter((c) => c.state === "failure").length;
  if (ci.state === "pending") return `${head} ${GLYPH.pending} ${done}/${ci.checks.length}`;
  if (ci.state === "failure") return `${head} ${GLYPH.failure} ${failed}`;
  return `${head} ${GLYPH[ci.state]}`;
}
