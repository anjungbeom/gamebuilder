import { clamp } from "./rng.js";

const TYPES = {
  edge: { key: "breaker", label: "파쇄형", bonus: "파쇄력 +12% · 충격 강화" },
  reach: { key: "lance", label: "장대형", bonus: "사거리 +12% · 조작 강화" },
  buoy: { key: "ward", label: "방벽형", bonus: "부력 +12% · 패링 강화" },
  grip: { key: "snare", label: "포획형", bonus: "포획력 +12% · 제압 강화" }
};

export function handToolProfile(raw) {
  const ordered = ["edge", "reach", "buoy", "grip"].sort((a, b) => raw[b] - raw[a]);
  const balanced = raw[ordered[0]] - raw[ordered[1]] < .08;
  const type = balanced ? { key: "balanced", label: "균형형", bonus: "핵심 성능 전체 +4%" } : TYPES[ordered[0]];
  const stats = { ...raw };
  if (balanced) for (const key of ["edge", "reach", "buoy", "grip"]) stats[key] = clamp(stats[key] + .04, 0, 1);
  else stats[ordered[0]] = clamp(stats[ordered[0]] + .12, 0, 1);
  stats.impact = clamp(stats.edge * .68 + raw.ink * .32, 0, 1);
  stats.control = clamp(stats.grip * .58 + stats.reach * .42, 0, 1);
  stats.guard = clamp(stats.buoy * .5 + stats.grip * .3 + stats.edge * .2, 0, 1);
  stats.efficiency = clamp(1 - Math.max(0, raw.strokeCount - 1) / 8, 0, 1);
  return { type, stats };
}

export function petToolStats(raw) {
  return {
    power: clamp(raw.edge * .62 + raw.reach * .38, 0, 1),
    range: clamp(.2 + raw.reach * .8, 0, 1),
    guard: clamp(raw.buoy * .65 + raw.ink * .35, 0, 1),
    control: clamp(raw.grip * .72 + raw.edge * .28, 0, 1)
  };
}
