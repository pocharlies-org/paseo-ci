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

// Order matters only for ties at one position; the last reference in the text wins.
const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => PrRef]> = [
  [/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g, (m) => ({ forge: "github", repo: m[1], number: +m[2] })],
  [/bitbucket\.org\/([\w.-]+\/[\w.-]+)\/pull-requests\/(\d+)/g, (m) => ({ forge: "bitbucket", repo: m[1], number: +m[2] })],
  [/gh pr \w+ (\d+)\b[^\n"]*?(?:-R|--repo)[ =]([\w.-]+\/[\w.-]+)/g, (m) => ({ forge: "github", repo: m[2], number: +m[1] })],
  [/(?<![\w./-])([\w.-]+\/[\w.-]+)#(\d+)\b/g, (m) => ({ forge: "github", repo: m[1], number: +m[2] })],
];

/** The last pull request a piece of text names: a GitHub or Bitbucket URL, `owner/repo#N`, or `gh pr <verb> N -R owner/repo`. */
export function lastPrRef(text: string): PrRef | null {
  let best: { at: number; ref: PrRef } | null = null;
  for (const [re, make] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (!best || m.index! >= best.at) best = { at: m.index!, ref: make(m as RegExpExecArray) };
    }
  }
  return best?.ref ?? null;
}

export const sameRef = (a: PrRef | null, b: PrRef | null) =>
  !!a && !!b && a.forge === b.forge && a.repo === b.repo && a.number === b.number;

export function overall(checks: ReadonlyArray<{ state: CheckState }>): CheckState {
  if (checks.some((c) => c.state === "failure")) return "failure";
  if (checks.some((c) => c.state === "pending")) return "pending";
  return checks.length ? "success" : "none";
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
