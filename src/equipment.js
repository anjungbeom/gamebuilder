import { clamp } from "./rng.js?rev=9";

const TYPES = {
  edge: { key: "breaker", label: "파쇄형", bonus: "파쇄력 +12% · 충격 강화" },
  reach: { key: "lance", label: "장대형", bonus: "사거리 +12% · 조작 강화" },
  buoy: { key: "ward", label: "방벽형", bonus: "부력 +12% · 패링 강화" },
  grip: { key: "snare", label: "포획형", bonus: "포획력 +12% · 제압 강화" }
};

// 성능값을 자르지 않는다. 대신 한 설계에서 사용할 수 있는 총 선 길이를
// 숙련도에 맞춰 늘려, 같은 총량 안에서 어떤 형태에 길이를 배분할지 선택하게 한다.
export const MILESTONE_LENGTH_BUDGETS = [
  { budget: 520, label: "입문" },
  { budget: 650, label: "탐사" },
  { budget: 800, label: "숙련" },
  { budget: 980, label: "정예" },
  { budget: 1200, label: "개척" }
];

export function milestoneLengthBudget(milestone = 0) {
  const index = clamp(Math.floor(milestone), 0, MILESTONE_LENGTH_BUDGETS.length - 1);
  return { ...MILESTONE_LENGTH_BUDGETS[index], index };
}

export function drawingLengthState(raw, milestone = 0) {
  const level = milestoneLengthBudget(milestone);
  const used = Math.max(0, raw.inkPx ?? 0);
  return { ...level, used, remaining: Math.max(0, level.budget - used), exceeded: used > level.budget + .5 };
}

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

// 총 선 길이는 설계 예산으로만 제한하고, 투척 무게는 그 예산 안에서
// 얼마나 조밀하고 넓게 채웠는지로 해석한다.
export function toolThrowProfile(raw, stats = raw) {
  const compactness = clamp((raw.ink ?? 0) * .62 + (raw.buoy ?? 0) * .28 + (1 - (raw.reach ?? 0)) * .10, 0, 1);
  const weight = clamp(.16 + compactness * .84, .16, 1);
  const speed = 176 - weight * 72;
  const range = 62 + (1 - weight) * 78 + (stats.reach ?? 0) * 22;
  const damage = Math.max(1, Math.round(1 + weight * 2.4 + (stats.impact ?? 0) * 2.2));
  const stagger = .12 + weight * .38;
  return { weight, speed, range, damage, stagger };
}

export function petToolStats(raw) {
  return {
    power: clamp(raw.edge * .62 + raw.reach * .38, 0, 1),
    range: clamp(.2 + raw.reach * .8, 0, 1),
    guard: clamp(raw.buoy * .65 + raw.ink * .35, 0, 1),
    control: clamp(raw.grip * .72 + raw.edge * .28, 0, 1)
  };
}
