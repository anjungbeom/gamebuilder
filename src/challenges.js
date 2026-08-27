import { PROGRESSION_TIERS, tierForFragments } from "./progression.js";

const CAPTURE_REWARDS = [2, 5, 9, 14];

export const ROTATING_TIPS = [
  "소음이 커지면 적대 크리처의 탐지 범위가 넓어집니다.",
  "마을 경계 안으로 들어가면 체력과 동행 펫이 회복됩니다.",
  "P 패링은 투사체를 반사하고 근접 공격자를 잠시 무장해제합니다.",
  "우두머리는 빛나는 연결 부위를 순서대로 파괴해야 약점이 드러납니다.",
  "안개 너머 크리처는 움직이지도, 그려지지도 않습니다.",
  "버린 수집품은 10초 동안만 바닥에 남습니다."
];

export function challengeRows(state) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    rows.push({
      id: `signal-${i + 1}`,
      title: `${i + 1}번째 신호기 활성화`,
      current: Math.min(state.foundCount, i + 1), target: i + 1,
      reward: i < 4 ? "다음 바이옴과 마을 공개" : "전 지역 자유 탐사",
      completed: state.foundCount >= i + 1
    });
  }
  PROGRESSION_TIERS.forEach((tier, index) => rows.push({
    id: `tech-${index + 1}`,
    title: `기술 조각 ${tier.fragments}개 수집`,
    current: Math.min(state.fragments, tier.fragments), target: tier.fragments,
    reward: `${tier.name} — ${tier.description}`,
    completed: state.fragments >= tier.fragments
  }));
  CAPTURE_REWARDS.forEach((target, index) => rows.push({
    id: `capture-${index + 1}`,
    title: `적대 크리처 ${target}마리 포획`,
    current: Math.min(state.captures, target), target,
    reward: "장비칸 +1 · 잉크 +4",
    completed: state.captures >= target
  }));
  return rows;
}

export function nextChallenge(state) {
  const rows = challengeRows(state);
  const nextSignal = rows.find(row => row.id.startsWith("signal-") && !row.completed);
  const nextTech = rows.find(row => row.id.startsWith("tech-") && !row.completed);
  const nextCapture = rows.find(row => row.id.startsWith("capture-") && !row.completed);
  const candidates = [nextSignal, nextTech, nextCapture].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.sort((a, b) =>
    ((a.target - a.current) / a.target) - ((b.target - b.current) / b.target)
  )[0];
}

export function challengeState(game) {
  return {
    foundCount: game.found?.size ?? game.foundCount ?? 0,
    fragments: game.fragments ?? 0,
    captures: game.captures ?? 0,
    tier: tierForFragments(game.fragments ?? 0)
  };
}
