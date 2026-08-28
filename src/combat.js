// 크리처 전투 수치와 보스 약점 판정을 게임 상태에서 분리한다.

import { clamp } from "./rng.js?rev=9";

export const WEAKNESS_LABELS = {
  edge: "절단",
  reach: "관통",
  buoy: "부력",
  grip: "구속"
};

export function creatureMaxHp(genome, rank = "normal") {
  const base = 3 + Math.floor(genome.bodyRadius / 2) + Math.floor(genome.segments / 2) + (genome.threat ?? 0) * 2;
  if (rank === "fieldboss") return base * 4 + 10;
  if (rank === "midboss") return base * 2 + 6;
  return base;
}

export function bossWeakness(seedValue) {
  return ["edge", "reach", "buoy", "grip"][Math.abs(seedValue) % 4];
}

export function attackDamage(stats, weakness = null, rank = "normal") {
  const base = Math.max(1, Math.round(1 + stats.edge * 2.4 + stats.reach * 1.2));
  if (!weakness) return base;
  const hitsWeakness = (stats[weakness] ?? 0) >= 0.42;
  if (hitsWeakness) return base * (rank === "fieldboss" ? 3 : 2);
  return Math.max(1, Math.floor(base * 0.5));
}

export function captureThresholdAtHp(baseThreshold, hp, maxHp, rank = "normal") {
  if (rank !== "normal") return Infinity;
  const healthRatio = clamp(hp / Math.max(1, maxHp), 0, 1);
  if (healthRatio > 0.38) return Infinity;
  return baseThreshold * (0.58 + healthRatio * 0.5);
}

export function inAttackArc(dx, dy, faceX, faceY, reach, bodyRadius = 0) {
  const distance = Math.hypot(dx, dy);
  if (distance > reach + bodyRadius) return false;
  if (distance < 0.001) return true;
  const facingLength = Math.hypot(faceX, faceY) || 1;
  const dot = (dx / distance) * (faceX / facingLength) + (dy / distance) * (faceY / facingLength);
  return dot >= 0.15;
}

export function parryDisarmDuration(rank = "normal") {
  return rank === "normal" ? 2.4 : 1.5;
}

// 적마다 별도 제어기를 만들지 않아도 되도록, 모든 적이 같은 예고→공격→회복 리듬을 쓴다.
export function creatureAttackProfile(rank = "normal", ranged = false, threat = 0) {
  const boss = rank === "fieldboss" ? 1 : rank === "midboss" ? .55 : 0;
  const level = clamp(threat, 0, 4);
  return {
    tell: Math.max(.20, (ranged ? .42 : .36) - boss * .07 - level * .018),
    lunge: ranged && boss === 0 ? 0 : .15 + boss * .04,
    slam: .13 + boss * .05,
    recover: .32 + boss * .10,
    speed: 112 + boss * 30 + level * 6,
    bind: .24 + boss * .22 + level * .035,
    knockback: 68 + boss * 28 + level * 5
  };
}

// 예전보다 짧아진 창이라, 공격 예고가 보인 뒤 실제 피격 순간에 맞춰야 성공한다.
export function parryTiming(guard = 0) {
  return {
    window: .12 + clamp(guard, 0, 1) * .10,
    cooldown: .94 - clamp(guard, 0, 1) * .18
  };
}

export function dodgeTiming(shoes = null) {
  const shoeSpeed = clamp(shoes?.speed ?? 0, 0, 1);
  const stability = clamp(shoes?.stability ?? 0, 0, 1);
  return {
    window: .18,
    cooldown: .64 - stability * .08,
    speed: 2.38 + shoeSpeed * .62 + stability * .18,
    wireLink: .50 + stability * .10
  };
}

// 락온 중에는 최근 이동 모멘텀을 유지하되 대상에게 가까워지는 성분만
// 제거한다. 정면 모멘텀만 남으면 마지막 선회 방향의 접선으로 빠진다.
export function lockSafeDodgeDirection(momentumX, momentumY, targetX, targetY, side = 1) {
  const momentumLength = Math.hypot(momentumX, momentumY) || 1;
  const targetLength = Math.hypot(targetX, targetY) || 1;
  const mx = momentumX / momentumLength;
  const my = momentumY / momentumLength;
  const tx = targetX / targetLength;
  const ty = targetY / targetLength;
  const inward = mx * tx + my * ty;
  if (inward <= 0) return { x: mx, y: my };
  const safeX = mx - tx * inward;
  const safeY = my - ty * inward;
  const safeLength = Math.hypot(safeX, safeY);
  if (safeLength > .08) return { x: safeX / safeLength, y: safeY / safeLength };
  const turn = side < 0 ? -1 : 1;
  return { x: -ty * turn, y: tx * turn };
}

export function directionalWeaknessAllows(dx, dy, direction) {
  if (direction === "north") return dy < -Math.abs(dx) * .45;
  if (direction === "south") return dy > Math.abs(dx) * .45;
  if (direction === "west") return dx < -Math.abs(dy) * .45;
  return dx > Math.abs(dy) * .45;
}
