import { execCommand } from "@getpaseo/plugin/server";
import { overall, type CheckState, type CiStatus, type PrRef } from "../shared/ci.ts";

type Check = CiStatus["checks"][number];

const OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED", "SUCCESSFUL"]);
const PENDING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "INPROGRESS"]);
const stateOf = (word: string): CheckState => (OK.has(word) ? "success" : PENDING.has(word) ? "pending" : "failure");

interface GhRollupItem {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Normalises one entry of GitHub's statusCheckRollup (a CheckRun of Actions, or a commit StatusContext). */
export function ghCheck(i: GhRollupItem): Check {
  const run = i.__typename === "CheckRun";
  const word = run ? (i.status === "COMPLETED" ? (i.conclusion ?? "") : (i.status ?? "")) : (i.state ?? "");
  const started = i.startedAt && !i.startedAt.startsWith("0001") ? i.startedAt : null;
  const completed = i.completedAt && !i.completedAt.startsWith("0001") ? i.completedAt : null;
  return {
    name: (run ? i.name : i.context) ?? "",
    workflow: i.workflowName ?? "",
    state: stateOf(word),
    detail: word,
    url: (run ? i.detailsUrl : i.targetUrl) ?? "",
    startedAt: started,
    completedAt: completed,
  };
}

async function github(ref: PrRef): Promise<CiStatus> {
  const { stdout } = await execCommand(
    "gh",
    ["pr", "view", String(ref.number), "-R", ref.repo, "--json", "title,url,state,headRefName,statusCheckRollup"],
    { env: process.env, timeout: 20_000 },
  );
  const pr = JSON.parse(stdout) as { title: string; url: string; state: string; headRefName: string; statusCheckRollup: GhRollupItem[] };
  const checks = pr.statusCheckRollup.map(ghCheck);
  return { title: pr.title, url: pr.url, prState: pr.state, branch: pr.headRefName, state: overall(checks), checks, error: null };
}

// Bitbucket Cloud: a Bearer access token (BITBUCKET_TOKEN) or an app password (BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD);
// with neither, only public repositories answer.
function bitbucketAuth(): Record<string, string> {
  const e = process.env;
  if (e.BITBUCKET_TOKEN) return { Authorization: `Bearer ${e.BITBUCKET_TOKEN}` };
  if (e.BITBUCKET_USERNAME && e.BITBUCKET_APP_PASSWORD)
    return { Authorization: `Basic ${Buffer.from(`${e.BITBUCKET_USERNAME}:${e.BITBUCKET_APP_PASSWORD}`).toString("base64")}` };
  return {};
}

async function bitbucket(ref: PrRef): Promise<CiStatus> {
  const base = `https://api.bitbucket.org/2.0/repositories/${ref.repo}/pullrequests/${ref.number}`;
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { Accept: "application/json", ...bitbucketAuth() }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Bitbucket ${res.status}${res.status === 401 || res.status === 404 ? " (¿falta BITBUCKET_TOKEN en el daemon?)" : ""}`);
    return res.json();
  };
  const [pr, statuses] = await Promise.all([get(base), get(`${base}/statuses?pagelen=100`)]);
  const checks: Check[] = (statuses.values as Array<Record<string, string>>).map((s) => ({
    name: s.name || s.key,
    workflow: "",
    state: stateOf(s.state),
    detail: s.state,
    url: s.url ?? "",
    startedAt: s.created_on ?? null,
    completedAt: s.state === "INPROGRESS" ? null : (s.updated_on ?? null),
  }));
  return {
    title: pr.title,
    url: pr.links?.html?.href ?? "",
    prState: pr.state === "FULFILLED" ? "MERGED" : pr.state,
    branch: pr.source?.branch?.name ?? "",
    state: overall(checks),
    checks,
    error: null,
  };
}

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: Promise<CiStatus> }>();

/** One read per pull request every 15 s, however many clients and agents ask. Failures come back as `error`, not thrown. */
export function readCi(ref: PrRef): Promise<CiStatus> {
  const key = `${ref.forge}:${ref.repo}#${ref.number}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  for (const [k, v] of cache) if (Date.now() - v.at >= TTL_MS) cache.delete(k);
  const value = (ref.forge === "github" ? github(ref) : bitbucket(ref)).catch(
    (e: Error): CiStatus => ({ title: "", url: "", prState: "", branch: "", state: "none", checks: [], error: String(e.message).slice(0, 300) }),
  );
  cache.set(key, { at: Date.now(), value });
  return value;
}
