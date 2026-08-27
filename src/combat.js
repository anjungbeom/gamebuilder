// 크리처 전투 수치와 보스 약점 판정을 게임 상태에서 분리한다.

import { clamp } from "./rng.js";

export const WEAKNESS_LABELS = {
  edge: "절단",
  reach: "관통",
  buoy: "부력",
  grip: "구속"
};

export function creatureMaxHp(genome, rank = "normal") {
  const base = 3 + Math.floor(genome.bodyRadius / 2) + Math.floor(genome.segments / 2);
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

export function directionalWeaknessAllows(dx, dy, direction) {
  if (direction === "north") return dy < -Math.abs(dx) * .45;
  if (direction === "south") return dy > Math.abs(dx) * .45;
  if (direction === "west") return dx < -Math.abs(dy) * .45;
  return dx > Math.abs(dy) * .45;
}
