// 확률 보상과 탐사 등급은 순수 로직으로 분리해 같은 시드에서 재현 가능하게 한다.

import { hashUnit } from "./rng.js";

export const PROGRESSION_TIERS = [
  { fragments: 2, name: "채집 요령", description: "기술 조각 발견 확률 +10%" },
  { fragments: 5, name: "점프", description: "X로 지형과 투사체를 한 번 뛰어넘기" },
  { fragments: 9, name: "현장 수리", description: "기술 조각 발견 시 장비 수리, 제작 잉크 -1" },
  { fragments: 14, name: "와이어", description: "E로 크리처를 끌거나 걸린 지점으로 이동" },
  { fragments: 20, name: "반사 방벽", description: "R로 투사체를 막아 되돌리는 방벽 펼치기" },
  { fragments: 28, name: "기동 강화", description: "상호작용 거리와 달리기 속도 증가" }
];

export const BASE_DROP_CHANCE = {
  boulder: 0.45,
  thicket: 0.50,
  bramble: 0.55,
  tree: 0.52,
  mountain: 0.48,
  peaceful: 0.60,
  hostile: 0.70
};

export function tierForFragments(fragments) {
  let tier = 0;
  while (tier < PROGRESSION_TIERS.length && fragments >= PROGRESSION_TIERS[tier].fragments) tier++;
  return tier;
}

export function progressionEffects(tier) {
  return {
    dropBonus: tier >= 1 ? 0.10 : 0,
    jump: tier >= 2,
    fieldRepair: tier >= 3,
    craftDiscount: tier >= 3 ? 1 : 0,
    wire: tier >= 4,
    reflector: tier >= 5,
    rangeBonus: tier >= 6 ? 8 : 0,
    sprintBonus: tier >= 6 ? 0.16 : 0
  };
}

export function dropChance(source, tier = 0) {
  const base = BASE_DROP_CHANCE[source] ?? 0;
  return Math.min(0.85, base + progressionEffects(tier).dropBonus);
}

export function craftingCost(strokeCount, tier = 0) {
  if (strokeCount <= 0) return 0;
  return Math.max(1, strokeCount - progressionEffects(tier).craftDiscount);
}

/** 처리 대상의 좌표와 월드 시드만 사용하므로 새로고침으로 결과를 바꿀 수 없다. */
export function rollInteractionReward(source, x, y, seed, tier = 0) {
  const salt = source === "hostile" ? 73001
    : source === "peaceful" ? 73003
      : source === "boulder" ? 73007
        : source === "thicket" ? 73009
          : source === "tree" ? 73017
            : source === "mountain" ? 73019
              : 73013;
  const chance = dropChance(source, tier);
  return { dropped: hashUnit(x, y, seed + salt) < chance, chance };
}

export function nextTierProgress(fragments) {
  const tier = tierForFragments(fragments);
  const next = PROGRESSION_TIERS[tier] ?? null;
  return { tier, next, remaining: next ? next.fragments - fragments : 0 };
}
