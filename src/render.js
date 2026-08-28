// 세계를 도트로 그린다. 글자는 캔버스가 아니라 DOM이 맡는다.

import {
  TILE, BIOME, OBSTACLE, biomeAt, obstacleAt, isWater, isBiomeSolid, regionRequiredMarksAt
} from "./world.js";
import { hashUnit } from "./rng.js";
import { bodyPlan } from "./creature.js";

// 타일마다 색을 크게 흔들면 체커보드처럼 보인다.
// 바탕색을 반복해 넣어 대부분의 타일이 같은 색을 쓰게 하고, 편차는 좁게 둔다.
const BIOME_COLORS = {
  [BIOME.DEEP]: ["#123a55", "#123a55", "#123a55", "#14405c", "#10364f"],
  [BIOME.WATER]: ["#2f7fa8", "#2f7fa8", "#2f7fa8", "#3285ad", "#2c79a1"],
  [BIOME.SAND]: ["#d9c48a", "#d9c48a", "#d9c48a", "#ddc991", "#d4bf83"],
  [BIOME.PLAIN]: ["#9dbf62", "#9dbf62", "#9dbf62", "#a1c366", "#98ba5d"],
  [BIOME.GRASS]: ["#6faa50", "#6faa50", "#6faa50", "#73ae54", "#6ba54c"],
  [BIOME.FOREST]: ["#44804a", "#44804a", "#44804a", "#47854d", "#417b46"],
  [BIOME.ROCK]: ["#8d8f96", "#8d8f96", "#8d8f96", "#91939a", "#898b92"]
};

export function tileColor(tx, ty, seed) {
  const biome = biomeAt(tx, ty, seed);
  const shades = BIOME_COLORS[biome] ?? BIOME_COLORS[BIOME.PLAIN];
  const pick = Math.floor(hashUnit(tx, ty, seed + 9091) * shades.length);
  return shades[pick];
}

/** 보이는 타일만 그린다. 카메라는 월드 픽셀 좌표. */
export function drawTerrain(ctx, camX, camY, viewW, viewH, seed, cleared, foundCount = 0, time = 0) {
  const t0x = Math.floor(camX / TILE) - 1;
  const t0y = Math.floor(camY / TILE) - 1;
  const t1x = Math.ceil((camX + viewW) / TILE) + 1;
  const t1y = Math.ceil((camY + viewH) / TILE) + 1;

  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const sx = Math.round(tx * TILE - camX);
      const sy = Math.round(ty * TILE - camY);

      const locked = regionRequiredMarksAt(tx, ty) > foundCount;

      ctx.fillStyle = tileColor(tx, ty, seed);
      ctx.fillRect(sx, sy, TILE, TILE);

      const biome = biomeAt(tx, ty, seed);
      if (isWater(biome)) drawRipple(ctx, sx, sy, tx, ty, seed);
      else if (biome === BIOME.ROCK) drawRockFace(ctx, sx, sy, tx, ty, seed);
      else drawGroundDetail(ctx, sx, sy, tx, ty, seed, biome);

      const obstacle = obstacleAt(tx, ty, seed);
      if (obstacle && !cleared.has(`${tx},${ty}`)) {
        drawObstacle(ctx, sx, sy, obstacle, tx, ty, seed);
      }
      if (locked) drawMovingFog(ctx, sx, sy, tx, ty, seed, time);
    }
  }
}

function drawMovingFog(ctx, sx, sy, tx, ty, seed, time) {
  const density = hashUnit(tx, ty, seed + 45011);
  const wave = Math.sin(time * .0018 + tx * .37 + ty * .19) * .5 + .5;
  // 잠긴 지형의 정보는 남기고, 흐르는 안개만 시야를 부드럽게 가린다.
  ctx.fillStyle = `rgba(38,54,66,${(.21 + density * .10).toFixed(3)})`;
  ctx.fillRect(sx, sy, TILE, TILE);

  // 시간값을 색 해시에 넣지 않고 위치만 이동시켜 안개가 깜빡이지 않고 흐른다.
  const driftX = Math.round(((time * .020 + tx * 5 + density * 17) % 34) - 17);
  const driftY = Math.round(Math.sin(time * .0013 + ty * .7) * 4);
  ctx.fillStyle = `rgba(218,232,236,${(.08 + wave * .10).toFixed(3)})`;
  ctx.fillRect(sx + driftX, sy + 2 + driftY, 25, 4);
  ctx.fillRect(sx - driftX * .48 - 9, sy + 9 - driftY, 23, 4);
  ctx.fillStyle = `rgba(242,248,247,${(.035 + wave * .045).toFixed(3)})`;
  ctx.fillRect(sx + driftX * .32, sy + 6, 15, 2);
  ctx.fillRect(sx - driftX * .22 - 5, sy + 14, 18, 2);
}

function drawRipple(ctx, sx, sy, tx, ty, seed) {
  const r = hashUnit(tx, ty, seed + 411);
  if (r < 0.55) return;
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  const ox = Math.floor(r * 9) + 2;
  const oy = Math.floor(hashUnit(tx, ty, seed + 412) * 10) + 3;
  ctx.fillRect(sx + ox, sy + oy, 4, 1);
  if (r > 0.91) {
    ctx.fillStyle = "rgba(175,231,192,0.62)";
    ctx.fillRect(sx + 3, sy + 11, 4, 2);
    ctx.fillStyle = "rgba(255,224,126,0.78)";
    ctx.fillRect(sx + 5, sy + 10, 1, 1);
  }
}

function drawRockFace(ctx, sx, sy, tx, ty, seed) {
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
  const r = hashUnit(tx, ty, seed + 611);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(sx + Math.floor(r * 8) + 2, sy + 2, 3, 2);
}

function drawGroundDetail(ctx, sx, sy, tx, ty, seed, biome) {
  const r = hashUnit(tx, ty, seed + 811);
  if (r < 0.68) return;
  const ox = Math.floor(hashUnit(tx, ty, seed + 812) * 12) + 2;
  const oy = Math.floor(hashUnit(tx, ty, seed + 813) * 12) + 2;

  if (biome === BIOME.SAND) {
    ctx.fillStyle = "rgba(120,96,54,0.35)";
    ctx.fillRect(sx + ox, sy + oy, 2, 1);
    if (r > 0.91) {
      ctx.fillStyle = "rgba(255,241,181,0.5)";
      ctx.fillRect(sx + 10, sy + 4, 3, 1);
      ctx.fillRect(sx + 12, sy + 3, 1, 3);
    }
    return;
  }
  ctx.fillStyle = biome === BIOME.FOREST ? "rgba(24,58,30,0.45)" : "rgba(56,96,40,0.4)";
  ctx.fillRect(sx + ox, sy + oy, 1, 2);
  ctx.fillRect(sx + ox + 2, sy + oy + 1, 1, 2);
  if (biome === BIOME.FOREST && r > 0.9) {
    ctx.fillStyle = "#f2c47b";
    ctx.fillRect(sx + 11, sy + 10, 3, 2);
    ctx.fillStyle = "#e7ecda";
    ctx.fillRect(sx + 12, sy + 12, 1, 2);
  } else if ((biome === BIOME.GRASS || biome === BIOME.PLAIN) && r > 0.94) {
    const bloom = hashUnit(tx, ty, seed + 818) > 0.5 ? "#ffe07a" : "#ff9fa0";
    ctx.fillStyle = bloom;
    ctx.fillRect(sx + 9, sy + 7, 2, 2);
    ctx.fillStyle = "rgba(44,103,49,0.72)";
    ctx.fillRect(sx + 10, sy + 9, 1, 3);
  }
}

function drawObstacle(ctx, sx, sy, kind, tx, ty, seed) {
  const wobble = Math.floor(hashUnit(tx, ty, seed + 1201) * 3) - 1;

  if (kind === OBSTACLE.BOULDER) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(sx + 2, sy + TILE - 4, 12, 3);
    ctx.fillStyle = "#8b8d94";
    ctx.fillRect(sx + 3 + wobble, sy + 4, 10, 9);
    ctx.fillStyle = "#a5a7ad";
    ctx.fillRect(sx + 4 + wobble, sy + 5, 5, 4);
    ctx.fillStyle = "#6e7076";
    ctx.fillRect(sx + 3 + wobble, sy + 11, 10, 2);
    return;
  }

  if (kind === OBSTACLE.THICKET) {
    // 네모 한 덩이는 상자로 읽힌다. 작은 덩이를 겹쳐 수풀처럼 보이게 한다.
    const ox = sx + wobble;
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(sx + 3, sy + TILE - 3, 10, 2);
    ctx.fillStyle = "#24512c";
    ctx.fillRect(ox + 3, sy + 6, 10, 7);
    ctx.fillRect(ox + 1, sy + 8, 14, 4);
    ctx.fillStyle = "#316b39";
    ctx.fillRect(ox + 4, sy + 4, 4, 5);
    ctx.fillRect(ox + 8, sy + 5, 4, 4);
    ctx.fillRect(ox + 2, sy + 8, 3, 3);
    ctx.fillStyle = "#4c8f4f";
    ctx.fillRect(ox + 5, sy + 3, 2, 2);
    ctx.fillRect(ox + 9, sy + 6, 2, 2);
    return;
  }

  if (kind === OBSTACLE.TREE) {
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(sx - 5, sy + 12, 25, 4);
    ctx.fillStyle = "#5b3d27";
    ctx.fillRect(sx + 6, sy - 9, 5, 23);
    ctx.fillStyle = "#2b6338";
    ctx.fillRect(sx - 4 + wobble, sy - 17, 25, 13);
    ctx.fillRect(sx, sy - 23, 17, 10);
    ctx.fillStyle = "#43814a";
    ctx.fillRect(sx + 2, sy - 20, 8, 5);
    return;
  }

  if (kind === OBSTACLE.MOUNTAIN) {
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fillRect(sx - 6, sy + 12, 29, 5);
    ctx.fillStyle = "#676b72";
    ctx.beginPath(); ctx.moveTo(sx - 7, sy + 13); ctx.lineTo(sx + 8, sy - 18); ctx.lineTo(sx + 23, sy + 13); ctx.fill();
    ctx.fillStyle = "#9ba0a7";
    ctx.beginPath(); ctx.moveTo(sx + 2, sy - 5); ctx.lineTo(sx + 8, sy - 18); ctx.lineTo(sx + 13, sy - 6); ctx.fill();
    return;
  }

  // 가시덩굴: 낮게 깔린 엉킴.
  ctx.fillStyle = "#6b4a2a";
  for (let i = 0; i < 4; i++) {
    const px = sx + 2 + i * 3;
    const py = sy + 6 + Math.floor(hashUnit(tx * 7 + i, ty, seed + 1301) * 5);
    ctx.fillRect(px, py, 3, 1);
    ctx.fillRect(px + 1, py - 2, 1, 3);
  }
  ctx.fillStyle = "#9c6b3c";
  ctx.fillRect(sx + 4, sy + 9, 8, 1);
}

/** 표석. 아직 못 찾았으면 회색, 찾았으면 빛난다. */
export function drawLandmark(ctx, sx, sy, found, time) {
  const pulse = 0.52 + Math.sin(time / 260) * 0.18;
  ctx.strokeStyle = found ? `rgba(255,217,100,${pulse.toFixed(3)})` : "rgba(216,221,226,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sx, sy - 2, found ? 14 : 11, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(sx - 6, sy + 6, 13, 3);

  ctx.fillStyle = found ? "#ffd964" : "#b9bfc6";
  ctx.fillRect(sx - 4, sy - 10, 9, 17);
  ctx.fillStyle = found ? "#fff0b0" : "#d8dde2";
  ctx.fillRect(sx - 3, sy - 9, 4, 15);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(sx - 4, sy + 4, 9, 3);

  // 신호기는 멀리서도 같은 목표물로 읽히도록 공통 표식을 쓴다.
  ctx.fillStyle = found ? "#fff4bd" : "#7b8792";
  ctx.fillRect(sx - 1, sy - 7, 3, 3);
  ctx.fillRect(sx, sy - 9, 1, 7);
  ctx.fillRect(sx - 3, sy - 6, 7, 1);

  if (found) {
    ctx.fillStyle = `rgba(255,232,140,${pulse.toFixed(3)})`;
    ctx.fillRect(sx - 2, sy - 16, 5, 4);
    ctx.fillRect(sx - 12, sy - 3, 4, 1);
    ctx.fillRect(sx + 9, sy - 3, 4, 1);
    ctx.fillRect(sx, sy - 20, 1, 4);
  }
}

/** 유전자에서 바로 몸을 그린다. 저장된 스프라이트는 없다. */
export function drawCreature(ctx, creature, sx, sy, time) {
  const g = creature.genome;
  const parts = bodyPlan(g);
  const dir = (creature.assetFacing ?? creature.facing) >= 0 ? 1 : -1;
  const turning = !!creature.turning;
  const bob = Math.sin(time / 180 + creature.phase) * 0.8;
  const attackState = creature.attackState ?? "idle";
  const attackPulse = .5 + Math.sin(time / 52 + creature.phase) * .5;
  if (attackState === "lunge") sx += dir * 2;

  const body = `hsl(${g.hue.toFixed(0)},${g.sat.toFixed(0)}%,${g.light.toFixed(0)}%)`;
  const dark = `hsl(${g.hue.toFixed(0)},${g.sat.toFixed(0)}%,${Math.max(14, g.light - 20).toFixed(0)}%)`;
  const lightC = `hsl(${g.hue.toFixed(0)},${g.sat.toFixed(0)}%,${Math.min(88, g.light + 18).toFixed(0)}%)`;

  if (creature.hostile && ["tell", "shoot-tell", "slam-tell", "bite-tell"].includes(attackState)) {
    const rangedTell = attackState === "shoot-tell";
    const slamTell = attackState === "slam-tell";
    ctx.strokeStyle = rangedTell ? `rgba(255,176,107,${(.38 + attackPulse * .38).toFixed(3)})` : slamTell ? `rgba(255,209,102,${(.38 + attackPulse * .42).toFixed(3)})` : `rgba(255,97,93,${(.34 + attackPulse * .42).toFixed(3)})`;
    ctx.lineWidth = 1;
    const telegraphRadius = g.bodyRadius * 2.7 + 5 + Math.round(attackPulse * 2);
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI * .76 + i * Math.PI * .76;
      ctx.beginPath();
      ctx.arc(sx, sy + 1, telegraphRadius, a, a + .28);
      ctx.stroke();
    }
    ctx.fillStyle = rangedTell ? "#ffb06b" : slamTell ? "#ffd166" : "#ff615d";
    ctx.fillRect(sx - 1, sy - g.bodyRadius - 18, 3, 3);
  }

  if (creature.bossParts) {
    for (const part of creature.bossParts) {
      const px = sx + part.ox;
      const py = sy + part.oy;
      ctx.strokeStyle = part.destroyed ? "rgba(105,115,126,.35)" : part.active ? "#fff0a8" : "rgba(218,220,230,.38)";
      ctx.lineWidth = part.active ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = part.destroyed ? "#555c66" : part.active ? "#ffd166" : "#8a789b";
      ctx.fillRect(px - 5, py - 5, 10, 10);
      if (!part.destroyed) {
        ctx.fillStyle = "#fff4bd";
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }
  }

  if (creature.isPet) {
    if (creature.downTimer > 0) {
      ctx.fillStyle = "#d5dde8";
      ctx.fillRect(sx - 4, sy - g.bodyRadius - 12, 3, 1);
      ctx.fillRect(sx - 3, sy - g.bodyRadius - 13, 1, 3);
      ctx.fillRect(sx + 2, sy - g.bodyRadius - 12, 3, 1);
      ctx.fillRect(sx + 3, sy - g.bodyRadius - 13, 1, 3);
    }
  }

  if (creature.disarmed > 0) {
    ctx.fillStyle = "#b7e8ff";
    ctx.fillRect(sx - 6, sy - g.bodyRadius - 16, 3, 3);
    ctx.fillRect(sx + 4, sy - g.bodyRadius - 14, 3, 3);
    ctx.fillStyle = "#dcefff";
    ctx.fillRect(sx - 2, sy - g.bodyRadius - 18, 4, 1);
  }

  if (creature.rank !== "normal") {
    const pulse = 0.35 + Math.sin(time / 180 + creature.phase) * 0.12;
    ctx.fillStyle = creature.rank === "fieldboss" ? "#ff615d" : "#ffd166";
    ctx.fillRect(sx - 7, sy - g.bodyRadius - 18, 14, 2);
    ctx.fillRect(sx - 5, sy - g.bodyRadius - 21, 3, 3);
    ctx.fillRect(sx + 2, sy - g.bodyRadius - 21, 3, 3);
    ctx.fillStyle = `rgba(255,241,184,${pulse.toFixed(3)})`;
    ctx.fillRect(sx - 1, sy - g.bodyRadius - 24, 3, 2);

    // 보스 전용 도트 프레임: 공격 종류가 실루엣만으로 읽힌다.
    const arm = Math.max(8, Math.round(g.bodyRadius * 1.25));
    if (attackState === "slam-tell") {
      ctx.fillStyle = lightC;
      ctx.fillRect(sx + dir * 4, sy - arm - 7, dir * arm, 3);
      ctx.fillRect(sx + dir * (arm + 2), sy - arm - 10, dir * 4, 7);
      ctx.fillStyle = "#fff0a8";
      ctx.fillRect(sx + dir * (arm + 4), sy - arm - 11, 3, 3);
    } else if (attackState === "slam") {
      ctx.fillStyle = dark;
      ctx.fillRect(sx + dir * 4, sy + 2, dir * (arm + 5), 4);
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(sx + dir * (arm + 8), sy + 4, dir * 7, 2);
      ctx.fillRect(sx - 12, sy + g.bodyRadius + 4, 24, 2);
    } else if (attackState === "bite-tell" || attackState === "lunge") {
      const mouthX = sx + dir * (g.bodyRadius + 4);
      ctx.fillStyle = "#101418";
      ctx.fillRect(mouthX, sy - 3, dir * (g.bodyRadius + 5), 7);
      ctx.fillStyle = "#fff4bd";
      ctx.fillRect(mouthX + dir * 2, sy - 3, dir * 2, 3);
      ctx.fillRect(mouthX + dir * (g.bodyRadius + 1), sy + 2, dir * 2, 3);
    } else if (attackState === "shoot-tell") {
      const mouthX = sx + dir * (g.bodyRadius + 3);
      ctx.fillStyle = "#101418";
      ctx.fillRect(mouthX, sy - 3, dir * 7, 7);
      ctx.fillStyle = `rgba(255,176,107,${(.55 + attackPulse * .35).toFixed(3)})`;
      ctx.fillRect(mouthX + dir * 2, sy - 1, dir * 6, 3);
    }
  }

  if (creature.weakness && (creature.rank === "normal" || creature.weaknessExposed)) {
    drawWeaknessMark(ctx, sx, sy - g.bodyRadius - (creature.rank === "normal" ? 14 : 28), creature.weakness);
  }

  if (creature.lockedTarget) {
    // 조준 보조는 경계선 대신 머리 위 하나의 도트로만 표시한다.
    const lockPulse = .55 + Math.sin(time / 90 + creature.phase) * .25;
    const lockY = Math.round(sy - g.bodyRadius - (creature.rank === "normal" ? 19 : 34));
    ctx.fillStyle = `rgba(218,55,65,${lockPulse.toFixed(3)})`;
    ctx.fillRect(Math.round(sx - 2), lockY, 5, 3);
    ctx.fillStyle = "#fff1b8";
    ctx.fillRect(Math.round(sx - 1), lockY + 1, 2, 1);
  }

  // 행동을 보기 전에도 적대 여부가 읽히는 고정 표식.
  const signal = creature.hostile ? "#ff615d" : "#7ee0c0";
  ctx.fillStyle = signal;
  if (creature.hostile) {
    ctx.fillRect(sx - 1, sy - g.bodyRadius - 10, 2, 5);
    ctx.fillRect(sx - 1, sy - g.bodyRadius - 3, 2, 2);
    if (creature.ranged) {
      ctx.fillStyle = "#ffb06b";
      ctx.fillRect(sx - 5, sy - g.bodyRadius - 8, 2, 2);
      ctx.fillRect(sx + 4, sy - g.bodyRadius - 8, 2, 2);
    }
  } else {
    ctx.fillRect(sx - 3, sy - g.bodyRadius - 8, 2, 2);
    ctx.fillRect(sx + 2, sy - g.bodyRadius - 8, 2, 2);
    ctx.fillRect(sx - 1, sy - g.bodyRadius - 6, 3, 3);
  }

  if (creature.stun > 0) {
    ctx.fillStyle = "#b7e8ff";
    ctx.fillRect(sx - 5, sy - g.bodyRadius - 13, 2, 2);
    ctx.fillRect(sx + 3, sy - g.bodyRadius - 11, 2, 2);
  }

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(sx - g.bodyRadius * 1.6, sy + g.bodyRadius, g.bodyRadius * 3.2, 2);

  // 다리
  ctx.fillStyle = dark;
  if (g.upright) {
    const footY = sy + g.bodyRadius * 2.45;
    const swing = Math.sin(time / 120 + creature.phase) * (creature.moving ? 2 : .3);
    ctx.fillRect(Math.round(sx - g.bodyRadius * .55 + swing), Math.round(footY), 3, 6);
    ctx.fillRect(Math.round(sx + g.bodyRadius * .3 - swing), Math.round(footY), 3, 6);
  } else for (let i = 0; i < g.legPairs; i++) {
    const part = parts[Math.min(i, parts.length - 1)];
    const lx = sx + dir * (part.offset * -0.6);
    const swing = Math.sin(time / 120 + creature.phase + i) * 1.4 * (creature.moving ? 1 : 0.2);
    ctx.fillRect(Math.round(lx - 1 + swing), Math.round(sy + (part.yOffset ?? 0) + g.bodyRadius - 1), 2, 4);
  }

  // 직립형·다완형·거구형은 몸통과 분리된 팔 실루엣을 가진다.
  if ((g.armPairs ?? 0) > 0 && attackState === "idle") {
    ctx.fillStyle = dark;
    for (let i = 0; i < g.armPairs; i++) {
      const armY = sy + g.bodyRadius * (.72 + i * .42);
      const reach = Math.round(g.bodyRadius * (g.form === "armed" ? 1.7 : 1.25));
      ctx.fillRect(Math.round(sx - reach - 2), Math.round(armY), reach, 3);
      ctx.fillRect(Math.round(sx + 2), Math.round(armY), reach, 3);
      ctx.fillStyle = lightC;
      ctx.fillRect(Math.round(sx - reach - 3), Math.round(armY + 2), 3, 3);
      ctx.fillRect(Math.round(sx + reach), Math.round(armY + 2), 3, 3);
      ctx.fillStyle = dark;
    }
  }

  if (creature.hostile && attackState !== "idle") {
    ctx.fillStyle = ["lunge", "bite-tell"].includes(attackState) ? "#fff0a8" : dark;
    const armX = sx + dir * (g.bodyRadius + 2);
    ctx.fillRect(Math.round(armX), Math.round(sy - 1), dir * 3, 2);
    if (attackState === "lunge") ctx.fillRect(Math.round(armX + dir * 3), Math.round(sy - 2), dir * 3, 1);
  }

  // 몸통 마디 (뒤에서 앞으로)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const px = Math.round(sx + dir * p.offset);
    const py = Math.round(sy + bob + (p.yOffset ?? 0));
    const r = Math.max(1, Math.round(p.radius));
    ctx.fillStyle = i === 0 ? lightC : body;
    if (g.form === "orb") {
      ctx.fillRect(px - r + 2, py - r, r * 2 - 4, r * 2);
      ctx.fillRect(px - r, py - r + 2, r * 2, r * 2 - 4);
    } else ctx.fillRect(px - r, py - r, r * 2, r * 2);
    ctx.fillStyle = dark;
    ctx.fillRect(px - r, py + r - 1, r * 2, 1);
  }

  // 유전자 부위는 작은 도트 실루엣으로 읽히게 한다.
  const headRadius = Math.max(1, Math.round(parts[0].radius));
  ctx.fillStyle = dark;
  if (g.hasHorns) {
    ctx.fillRect(sx - 4, sy - headRadius - 4, 2, 4);
    ctx.fillRect(sx + 3, sy - headRadius - 4, 2, 4);
    ctx.fillStyle = lightC;
    ctx.fillRect(sx - 4, sy - headRadius - 5, 2, 1);
    ctx.fillRect(sx + 3, sy - headRadius - 5, 2, 1);
  }
  if (g.hasAntennae) {
    ctx.strokeStyle = lightC;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 2, sy - headRadius - 1); ctx.lineTo(sx - 5, sy - headRadius - 6);
    ctx.moveTo(sx + 2, sy - headRadius - 1); ctx.lineTo(sx + 5, sy - headRadius - 6);
    ctx.stroke();
  }
  if (g.hasFins) {
    ctx.fillStyle = `hsl(${((g.hue + 42) % 360).toFixed(0)},${g.sat.toFixed(0)}%,${Math.min(88, g.light + 20).toFixed(0)}%)`;
    ctx.fillRect(sx - headRadius - 4, sy - 2, 4, 3);
    ctx.fillRect(sx + headRadius, sy - 2, 4, 3);
  }
  if (g.shell) {
    ctx.strokeStyle = "rgba(255,240,190,.75)";
    ctx.strokeRect(sx - Math.round(g.bodyRadius * 1.4), sy - Math.round(g.bodyRadius * .9), Math.round(g.bodyRadius * 2.8), Math.round(g.bodyRadius * 1.8));
  }
  if (g.pattern > 0) {
    ctx.fillStyle = `hsl(${((g.hue + 180) % 360).toFixed(0)},${Math.min(90, g.sat + 12).toFixed(0)}%,${Math.min(90, g.light + 16).toFixed(0)}%)`;
    if (g.pattern === 1) ctx.fillRect(sx - 1, sy - 2, 2, 4);
    else if (g.pattern === 2) { ctx.fillRect(sx - 5, sy, 2, 2); ctx.fillRect(sx + 4, sy, 2, 2); }
    else { ctx.fillRect(sx - 3, sy - 2, 2, 2); ctx.fillRect(sx + 2, sy + 1, 2, 2); }
  }
  if (creature.hitFlash > 0) {
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillRect(sx - 2, sy - g.bodyRadius - 2, 4, 2);
    ctx.fillRect(sx - g.bodyRadius - 3, sy, 2, 2);
    ctx.fillRect(sx + g.bodyRadius + 1, sy - 1, 2, 2);
  }

  const headX = Math.round(sx);
  const headY = Math.round(sy + bob);
  const hr = Math.max(1, Math.round(parts[0].radius));

  if (g.hasCrest) {
    ctx.fillStyle = lightC;
    ctx.fillRect(headX - 1, headY - hr - 3, 2, 3);
  }
  if (g.hasTail) {
    const tail = parts[parts.length - 1];
    ctx.fillStyle = dark;
    ctx.fillRect(Math.round(sx + dir * (tail.offset - 4)), headY - 1, 4, 2);
  }

  ctx.fillStyle = "#101418";
  if (turning) {
    // 방향 전환 중에는 정면을 본 중립 프레임으로 바꿔 순간 반전을 숨긴다.
    ctx.fillRect(headX - 2, headY - 1, 1, 2);
    ctx.fillRect(headX + 1, headY - 1, 1, 2);
    ctx.fillStyle = lightC;
    ctx.fillRect(headX - 1, headY + 2, 3, 1);
  } else if (g.eyes === 1) {
    ctx.fillRect(headX + dir * 1, headY - 1, 2, 2);
  } else {
    ctx.fillRect(headX + dir * 1, headY - 2, 2, 2);
    ctx.fillRect(headX + dir * 1, headY + 1, 2, 2);
  }
}

export function drawVillage(ctx, village, camX, camY, time) {
  const x = Math.round(village.tx * TILE + TILE / 2 - camX);
  const y = Math.round(village.ty * TILE + TILE / 2 - camY);
  const glow = .16 + Math.sin(time / 260 + village.index) * .05;
  ctx.fillStyle = `rgba(126,224,192,${glow.toFixed(3)})`;
  ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(x - 24, y + 10, 48, 5);
  ctx.fillStyle = "#8f6a42"; ctx.fillRect(x - 22, y - 5, 18, 17); ctx.fillRect(x + 5, y - 2, 16, 14);
  ctx.fillStyle = "#d58b56";
  ctx.beginPath(); ctx.moveTo(x - 25, y - 5); ctx.lineTo(x - 13, y - 17); ctx.lineTo(x - 1, y - 5); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 2, y - 2); ctx.lineTo(x + 13, y - 13); ctx.lineTo(x + 24, y - 2); ctx.fill();
  ctx.fillStyle = "#7ee0c0"; ctx.fillRect(x - 1, y + 3, 3, 9); ctx.fillStyle = "#fff1b8"; ctx.fillRect(x, y - 2, 1, 7);
}

export function drawVillager(ctx, villager, sx, sy, time) {
  const bob = villager.moving ? Math.round(Math.sin(time / 100 + villager.phase) * 1) : 0;
  const x = Math.round(sx), y = Math.round(sy) + bob;
  ctx.fillStyle = "rgba(0,0,0,.23)"; ctx.fillRect(x - 4, y + 6, 9, 2);
  ctx.fillStyle = villager.color; ctx.fillRect(x - 4, y - 2, 9, 8);
  ctx.fillStyle = villager.accent; ctx.fillRect(x - 3, y - 7, 7, 6);
  ctx.fillStyle = "#15202b"; ctx.fillRect(x + (villager.facing > 0 ? 2 : -2), y - 5, 1, 1);
  ctx.fillStyle = "#39475a"; ctx.fillRect(x - 3, y + 5, 3, 4); ctx.fillRect(x + 1, y + 5, 3, 4);
}

export function drawSmokeEffects(ctx, effects, camX, camY) {
  for (const effect of effects) {
    const progress = 1 - effect.time / effect.duration;
    const x = effect.x - camX, y = effect.y - camY;
    for (let i = 0; i < effect.count; i++) {
      const angle = i * 2.399;
      const distance = progress * (8 + (i % 4) * 5);
      const size = Math.max(1, Math.round((1 - progress) * (effect.big ? 8 : 5)));
      ctx.fillStyle = `rgba(${i % 2 ? "180,188,197" : "91,101,112"},${Math.max(0, .72 - progress * .65).toFixed(3)})`;
      ctx.fillRect(Math.round(x + Math.cos(angle) * distance - size / 2), Math.round(y - progress * 18 + Math.sin(angle) * distance * .4), size, size);
    }
  }
}

function drawWeaknessMark(ctx, x, y, weakness) {
  const color = weakness === "edge" ? "#ff7b6b" : weakness === "reach" ? "#7fd0ff" : weakness === "buoy" ? "#7ee0c0" : "#ffd166";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  if (weakness === "edge") {
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 3, y + 2); ctx.lineTo(x - 3, y + 2); ctx.closePath(); ctx.stroke();
  } else if (weakness === "reach") {
    ctx.fillRect(x - 4, y, 8, 1); ctx.fillRect(x + 2, y - 2, 2, 5);
  } else if (weakness === "buoy") {
    ctx.strokeRect(x - 3, y - 3, 6, 6);
  } else {
    ctx.fillRect(x - 4, y - 2, 1, 5); ctx.fillRect(x, y - 3, 1, 6); ctx.fillRect(x + 4, y - 2, 1, 5);
  }
}

export function drawPlayer(ctx, sx, sy, faceX, faceY, walking, time, afloat, running = false, shoes = null, hurt = 0, deathProgress = 0, bindTimer = 0, dodgeTimer = 0, craftingProgress = 0) {
  if (deathProgress > 0) {
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy) + Math.round(deathProgress * 6));
    ctx.rotate(deathProgress * 1.25);
    sx = 0;
    sy = 0;
  }
  const bob = walking ? Math.round(Math.sin(time / 90) * 1) : 0;
  const stride = walking ? Math.round(Math.sin(time / 70)) : 0;
  const x = Math.round(sx);
  const y = Math.round(sy) + bob;
  const side = faceX !== 0;
  const front = faceY > 0;
  const back = faceY < 0;
  const dir = faceX < 0 ? -1 : 1;

  if (dodgeTimer > 0) {
    ctx.fillStyle = "rgba(185,232,255,.50)";
    ctx.fillRect(x - faceX * 10 - 3, y - faceY * 7 - 4, 5, 10);
    ctx.fillRect(x - faceX * 15 - 2, y - faceY * 9 - 2, 3, 7);
  }

  if (running) {
    ctx.fillStyle = "rgba(218,244,255,0.48)";
    ctx.fillRect(x - faceX * 8 - 2, y - faceY * 5 + 1, 4, 1);
    ctx.fillRect(x - faceX * 12, y - faceY * 7 + 4, 3, 1);
  }

  if (afloat) {
    ctx.fillStyle = "#8a5a2f";
    ctx.fillRect(x - 8, y + 5, 16, 3);
    ctx.fillStyle = "#a8703c";
    ctx.fillRect(x - 7, y + 5, 14, 1);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x - 4, y + 6, 9, 2);
  }

  ctx.fillStyle = shoes?.color ?? "#2f4a6b";
  if (faceY !== 0 && !faceX) {
    ctx.fillRect(x - 3 + stride, y + 2, 3, 5);
    ctx.fillRect(x + 1 - stride, y + 2, 3, 5);
  } else {
    ctx.fillRect(x - 3 + stride * dir, y + 2, 3, 5);
    ctx.fillRect(x + 1 - stride * dir, y + 2, 3, 5);
  }

  // 가방 위치가 뒤쪽을 알려 줘서 작은 실루엣에서도 방향이 먼저 읽힌다.
  ctx.fillStyle = "#6b5037";
  const packX = side ? (dir > 0 ? x - 6 : x + 3) : x - 4;
  const packY = back ? y - 4 : y - 2;
  ctx.fillRect(packX, packY, side ? 4 : 9, back ? 7 : 5);
  ctx.fillStyle = "#b58a52";
  ctx.fillRect(packX + 1, packY + 1, side ? 2 : 7, 1);
  ctx.fillStyle = hurt > 0.18 ? "#ff9a84" : "#d9584a";
  ctx.fillRect(x - 4, y - 4, 9, 7);
  ctx.fillStyle = "#f0705e";
  if (!back) ctx.fillRect(x - 3, y - 3, 4, 4);
  if (back) {
    ctx.fillStyle = "#795b3e";
    ctx.fillRect(x - 3, y - 2, 7, 4);
    ctx.fillStyle = "#c39759";
    ctx.fillRect(x - 2, y - 1, 5, 1);
  }

  // 작은 팔과 손을 몸통 바깥으로 빼서 어떤 방향에서도 실루엣이 읽히게 한다.
  const celebrating = craftingProgress > 0;
  ctx.fillStyle = hurt > 0.18 ? "#ff9a84" : "#c94943";
  if (celebrating) {
    const lift = Math.round(Math.sin(Math.min(1, craftingProgress) * Math.PI) * 2);
    ctx.fillRect(x - 6, y - 7 - lift, 3, 6);
    ctx.fillRect(x + 4, y - 7 - lift, 3, 6);
    ctx.fillStyle = "#f2c8a0";
    ctx.fillRect(x - 7, y - 9 - lift, 3, 3);
    ctx.fillRect(x + 5, y - 9 - lift, 3, 3);
  } else if (side) {
    const frontHandX = x + dir * 6;
    const backHandX = x - dir * 5;
    ctx.fillRect(Math.min(x + dir * 3, frontHandX), y - 2, 4, 2);
    ctx.fillRect(Math.min(x - dir * 4, backHandX), y, 3, 2);
    ctx.fillStyle = "#f2c8a0";
    ctx.fillRect(frontHandX - (dir < 0 ? 2 : 0), y - 2, 3, 3);
    ctx.fillRect(backHandX - (dir < 0 ? 2 : 0), y, 3, 3);
  } else {
    ctx.fillRect(x - 6, y - 3, 3, 5);
    ctx.fillRect(x + 4, y - 3, 3, 5);
    ctx.fillStyle = "#f2c8a0";
    ctx.fillRect(x - 7, y + 1, 3, 3);
    ctx.fillRect(x + 5, y + 1, 3, 3);
  }

  ctx.fillStyle = "#f2c8a0";
  ctx.fillRect(x - 3, y - 10, 7, 6);
  ctx.fillStyle = "#3a2a20";
  ctx.fillRect(x - 4, y - 12, 9, 3);
  if (back) {
    ctx.fillRect(x - 3, y - 10, 7, 4);
  } else {
    ctx.fillStyle = "#101418";
    if (!side) {
      ctx.fillRect(x - 2, y - 8, 1, 2);
      ctx.fillRect(x + 2, y - 8, 1, 2);
    } else {
      ctx.fillRect(x + dir * 1 - (dir < 0 ? 1 : 0), y - 8, 2, 2);
    }
  }

  ctx.fillStyle = "#ffd166";
  if (side) {
    const scarfX = dir > 0 ? x - 6 : x + 5;
    ctx.fillRect(scarfX, y - 4, 3, 2);
    ctx.fillRect(scarfX - dir * 2, y - 3, 3, 1);
  } else {
    ctx.fillRect(x - 4, y - 5, 9, 1);
    ctx.fillRect(x + (front ? 3 : -5), y - 4, 3, 2);
  }
  if (bindTimer > 0) {
    ctx.fillStyle = "rgba(150,219,255,.82)";
    ctx.fillRect(x - 6, y - 1, 12, 1);
    ctx.fillRect(x - 5, y + 3, 10, 1);
    ctx.fillRect(x - 6, y - 1, 1, 5);
    ctx.fillRect(x + 5, y - 1, 1, 5);
  }
  if (deathProgress > 0) ctx.restore();
}

/**
 * 플레이어가 그린 도구를 손에 들려 준다.
 * 게임 안의 모든 도구는 이 획들이 전부다.
 */
export function drawHeldTool(ctx, tool, sx, sy, faceX, faceY, swing) {
  if (!tool) return;
  const fx = faceX || (faceY === 0 ? 1 : 0);
  const fy = faceY || 0;
  const base = Math.atan2(fy, fx);
  const angle = base - 0.52 + swing * 2.15;
  const originX = Math.round(sx) + fx * 4;
  const originY = Math.round(sy) - 1 + fy * 2;

  if (swing > 0.12) {
    ctx.save();
    ctx.strokeStyle = `rgba(218,244,255,${Math.min(0.65, swing * 0.75).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(originX, originY, 13, base - 0.7, base + swing * 2.1);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(originX, originY);
  ctx.rotate(angle);

  ctx.strokeStyle = "#20242c";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokePath(ctx, tool.strokes);

  ctx.strokeStyle = tool.color;
  ctx.lineWidth = 1.2;
  strokePath(ctx, tool.strokes);

  ctx.restore();
}

/** 제작 직후, 멈춘 필드 위에서 새 도구를 양손으로 들어 올리는 짧은 공개 연출. */
export function drawCraftingReveal(ctx, tool, sx, sy, progress) {
  if (!tool) return;
  const rise = Math.sin(Math.min(1, progress) * Math.PI);
  const toolY = Math.round(sy - 22 - rise * 4);
  ctx.save();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,247,201,.88)";
  ctx.fillRect(Math.round(sx) - 13, toolY - 9, 27, 17);
  ctx.strokeStyle = "#d99b12";
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(sx) - 13, toolY - 9, 27, 17);

  ctx.save();
  ctx.translate(Math.round(sx), toolY);
  ctx.scale(1.25, 1.25);
  ctx.strokeStyle = "#20242c";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokePath(ctx, tool.strokes);
  ctx.strokeStyle = tool.color ?? "#ffd166";
  ctx.lineWidth = 1.2;
  strokePath(ctx, tool.strokes);
  ctx.restore();

  const sparkle = Math.floor(progress * 10) % 2;
  ctx.fillStyle = "#ffd65a";
  ctx.fillRect(Math.round(sx) - 20, toolY - 5 - sparkle, 5, 1);
  ctx.fillRect(Math.round(sx) - 18, toolY - 7 - sparkle, 1, 5);
  ctx.fillRect(Math.round(sx) + 17, toolY - 1 + sparkle, 5, 1);
  ctx.fillRect(Math.round(sx) + 19, toolY - 3 + sparkle, 1, 5);
  ctx.fillStyle = "#7fd0ff";
  ctx.fillRect(Math.round(sx) - 11, toolY - 14 + sparkle, 3, 3);
  ctx.fillStyle = "#7ee0c0";
  ctx.fillRect(Math.round(sx) + 10, toolY - 12 - sparkle, 3, 3);
  ctx.restore();
}

function strokePath(ctx, strokes) {
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.stroke();
  }
}

/** 밤낮 없이, 가장자리만 살짝 어둡게 해서 화면에 초점을 준다. */
export function drawVignette(ctx, w, h, hurt = 0) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(6,10,18,0.42)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (hurt > 0) {
    const a = Math.min(0.22, hurt * 0.2);
    ctx.fillStyle = `rgba(255,73,63,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

export function drawParryEffect(ctx, sx, sy, faceX, faceY, timer, cooldown, flash) {
  if (timer <= 0 && flash <= 0) return;
  const fx = faceX || 1;
  const fy = faceY || 0;
  const angle = Math.atan2(fy, fx);
  const active = timer > 0;
  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy));
  ctx.strokeStyle = active ? "#dcefff" : "rgba(126,224,192,.72)";
  ctx.lineWidth = active ? 2 : 1;
  ctx.beginPath();
  ctx.arc(0, 0, 14, angle - 0.82, angle + 0.82);
  ctx.stroke();
  if (active) {
    ctx.fillStyle = "#fff4bd";
    ctx.fillRect(Math.round(Math.cos(angle) * 12) - 1, Math.round(Math.sin(angle) * 12) - 1, 3, 3);
  }
  ctx.restore();
}

export function drawSuccessEffects(ctx, effects, camX, camY) {
  for (const effect of effects) {
    const progress = 1 - effect.time / effect.duration;
    const alpha = Math.max(0, 1 - progress);
    const x = Math.round(effect.x - camX);
    const y = Math.round(effect.y - camY);
    ctx.save();
    ctx.translate(x, y);
    if (effect.kind === "dodge") {
      ctx.strokeStyle = `rgba(126,224,192,${(.85 * alpha).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-10 - progress * 8, 0); ctx.lineTo(3, 0); ctx.lineTo(-1, -4); ctx.moveTo(3, 0); ctx.lineTo(-1, 4);
      ctx.stroke();
      ctx.fillStyle = `rgba(218,244,255,${(.72 * alpha).toFixed(3)})`;
      ctx.fillRect(-4, -8 - Math.round(progress * 5), 3, 3);
    } else {
      ctx.strokeStyle = `rgba(255,241,184,${(.95 * alpha).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 7 + progress * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(220,239,255,${(.9 * alpha).toFixed(3)})`;
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2 + Math.PI / 4;
        const d = 8 + progress * 12;
        ctx.fillRect(Math.round(Math.cos(angle) * d) - 1, Math.round(Math.sin(angle) * d) - 1, 3, 3);
      }
    }
    ctx.restore();
  }
}

export function drawRevealEffect(ctx, effect, camX, camY) {
  if (!effect) return;
  const x = Math.round(effect.x - camX);
  const y = Math.round(effect.y - camY);
  const progress = 1 - effect.time / effect.duration;
  const radius = 14 + progress * 150;
  const alpha = Math.max(0, 1 - progress);
  ctx.save();
  ctx.strokeStyle = `rgba(255,226,132,${(.9 * alpha).toFixed(3)})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  const beamHeight = Math.round((1 - Math.min(1, progress * 1.5)) * 190);
  ctx.fillStyle = `rgba(255,236,160,${(.24 * alpha).toFixed(3)})`;
  ctx.fillRect(x - 7, y - beamHeight, 14, beamHeight);
  ctx.fillStyle = `rgba(255,255,220,${(.7 * alpha).toFixed(3)})`;
  ctx.fillRect(x - 1, y - beamHeight, 3, beamHeight);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    const distance = 18 + progress * (70 + (i % 3) * 18);
    const cx = Math.round(x + Math.cos(angle) * distance);
    const cy = Math.round(y + Math.sin(angle) * distance * .55);
    ctx.fillStyle = `rgba(185,201,211,${(.18 * alpha).toFixed(3)})`;
    ctx.fillRect(cx - 12, cy - 4, 24, 8);
    ctx.fillRect(cx - 6, cy - 8, 14, 5);
  }
  ctx.restore();
}

export function drawAtmosphere(ctx, w, h, env, time) {
  if (!env) return;
  const nightAlpha = Math.max(0, .42 - env.daylight * .38);
  if (nightAlpha > .01) {
    ctx.fillStyle = `rgba(8,16,38,${nightAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
  const weather = env.weather.key;
  if (weather === "rain") {
    ctx.strokeStyle = "rgba(164,211,239,.38)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 34; i++) {
      const x = (i * 47 + time * .13) % (w + 30) - 15;
      const y = (i * 29 + time * .22) % (h + 20) - 10;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 9); ctx.stroke();
    }
  } else if (weather === "fog") {
    for (let i = 0; i < 5; i++) {
      const x = ((i * 97 + time * .012) % (w + 120)) - 60;
      const alpha = .065 + (i % 2) * .025;
      ctx.fillStyle = `rgba(205,220,226,${alpha.toFixed(3)})`;
      ctx.fillRect(x, 25 + i * 37, 145, 20);
      ctx.fillStyle = `rgba(233,242,240,${(alpha * .45).toFixed(3)})`;
      ctx.fillRect(x + 32, 29 + i * 37, 86, 4);
    }
  } else if (weather === "wind") {
    ctx.strokeStyle = "rgba(225,240,230,.18)";
    for (let i = 0; i < 12; i++) {
      const x = (i * 61 + time * .08) % (w + 25) - 20;
      const y = 18 + (i * 37) % (h - 25);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 14, y); ctx.stroke();
    }
  } else if (weather === "heat") {
    ctx.fillStyle = "rgba(255,174,91,.045)";
    ctx.fillRect(0, 0, w, h);
  }
}

export function drawDeathDrops(ctx, drops, camX, camY, time) {
  for (const drop of drops) {
    const x = Math.round(drop.x - camX);
    const y = Math.round(drop.y - camY);
    const bob = Math.round(Math.sin(time / 110 + x) * 2);
    ctx.fillStyle = "rgba(255,209,102,.2)";
    ctx.fillRect(x - 6, y - 5 + bob, 12, 10);
    if (drop.type === "gear") {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 4, y - 3 + bob, 8, 6);
      ctx.fillStyle = drop.item.color ?? "#ffd166";
      ctx.fillRect(x - 2, y - 1 + bob, 4, 2);
    } else {
      ctx.fillStyle = "#e8f3ff";
      ctx.fillRect(x - 3, y - 3 + bob, 6, 6);
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(x - 1, y - 2 + bob, 2, 4);
    }
  }
}
