import type { PluginButtonIcon, PluginClientContext } from "@getpaseo/plugin/client";
import { CiPopover } from "./client/ci";
import { registerCiPills } from "./client/pills";
import type { PrRef, Tone } from "./shared/ci";

// The forges' own marks (Lucide has neither), filled with the CI's colour: the pill API colours no label, so the logo
// carries it. `{ svg }` icons are accepted by the host since 0.15; the pinned 0.11.2 types only know names and
// components. shortcut: <cast to the 0.11.2 types>, <drop it when @getpaseo/plugin is bumped>
const PATHS: Record<PrRef["forge"], { viewBox: string; d: string; idle: string }> = {
  github: {
    viewBox: "0 0 16 16",
    idle: "currentColor",
    d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z",
  },
  bitbucket: {
    viewBox: "0 0 24 24",
    idle: "#2684FF",
    d: "M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z",
  },
};
const FILL: Record<NonNullable<Tone>, string> = { pending: "#E3B341", failure: "#F85149", success: "#3FB950" };

const icon = (forge: PrRef["forge"], tone: Tone) => {
  const p = PATHS[forge];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.viewBox}" fill="${tone ? FILL[tone] : p.idle}"><path d="${p.d}"/></svg>`;
  return { svg } as unknown as PluginButtonIcon;
};

export default function contribute(client: PluginClientContext) {
  return registerCiPills(client, CiPopover, icon);
}
