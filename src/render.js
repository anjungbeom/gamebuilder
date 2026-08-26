// 세계를 도트로 그린다. 글자는 캔버스가 아니라 DOM이 맡는다.

import {
  TILE, BIOME, OBSTACLE, biomeAt, obstacleAt, isWater, isBiomeSolid
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
export function drawTerrain(ctx, camX, camY, viewW, viewH, seed, cleared) {
  const t0x = Math.floor(camX / TILE) - 1;
  const t0y = Math.floor(camY / TILE) - 1;
  const t1x = Math.ceil((camX + viewW) / TILE) + 1;
  const t1y = Math.ceil((camY + viewH) / TILE) + 1;

  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const sx = Math.round(tx * TILE - camX);
      const sy = Math.round(ty * TILE - camY);

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
    }
  }
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

  // 원래 표석 위에 개척망의 공통 룬만 추가한다.
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
  const dir = creature.facing >= 0 ? 1 : -1;
  const bob = Math.sin(time / 180 + creature.phase) * 0.8;

  const body = `hsl(${g.hue.toFixed(0)},${g.sat.toFixed(0)}%,${g.light.toFixed(0)}%)`;
  const dark = `hsl(${g.hue.toFixed(0)},${g.sat.toFixed(0)}%,${Math.max(14, g.light - 20).toFixed(0)}%)`;
  const lightC = `hsl(${g.hue.toFixed(0)},${g.sat.toFixed(0)}%,${Math.min(88, g.light + 18).toFixed(0)}%)`;

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(sx - g.bodyRadius * 1.6, sy + g.bodyRadius, g.bodyRadius * 3.2, 2);

  // 다리
  ctx.fillStyle = dark;
  for (let i = 0; i < g.legPairs; i++) {
    const lx = sx + dir * (parts[Math.min(i, parts.length - 1)].offset * -0.6);
    const swing = Math.sin(time / 120 + creature.phase + i) * 1.4 * (creature.moving ? 1 : 0.2);
    ctx.fillRect(Math.round(lx - 1 + swing), Math.round(sy + g.bodyRadius - 1), 2, 4);
  }

  // 몸통 마디 (뒤에서 앞으로)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const px = Math.round(sx + dir * p.offset);
    const py = Math.round(sy + bob);
    const r = Math.max(1, Math.round(p.radius));
    ctx.fillStyle = i === 0 ? lightC : body;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
    ctx.fillStyle = dark;
    ctx.fillRect(px - r, py + r - 1, r * 2, 1);
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
  if (g.eyes === 1) {
    ctx.fillRect(headX + dir * 1, headY - 1, 2, 2);
  } else {
    ctx.fillRect(headX + dir * 1, headY - 2, 2, 2);
    ctx.fillRect(headX + dir * 1, headY + 1, 2, 2);
  }
}

export function drawPlayer(ctx, sx, sy, facing, walking, time, afloat) {
  const bob = walking ? Math.round(Math.sin(time / 90) * 1) : 0;
  const x = Math.round(sx);
  const y = Math.round(sy) + bob;

  if (afloat) {
    ctx.fillStyle = "#8a5a2f";
    ctx.fillRect(x - 8, y + 5, 16, 3);
    ctx.fillStyle = "#a8703c";
    ctx.fillRect(x - 7, y + 5, 14, 1);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x - 4, y + 6, 9, 2);
  }

  ctx.fillStyle = "#2f4a6b";        // 다리
  ctx.fillRect(x - 3, y + 2, 3, 5);
  ctx.fillRect(x + 1, y + 2, 3, 5);
  ctx.fillStyle = "#6b5037";        // 기존 실루엣 뒤에 덧대는 개척 가방
  const packX = facing >= 0 ? x - 6 : x + 3;
  ctx.fillRect(packX, y - 3, 4, 6);
  ctx.fillStyle = "#b58a52";
  ctx.fillRect(packX + 1, y - 2, 2, 1);
  ctx.fillStyle = "#d9584a";        // 외투
  ctx.fillRect(x - 4, y - 4, 9, 7);
  ctx.fillStyle = "#f0705e";
  ctx.fillRect(x - 3, y - 3, 4, 4);
  ctx.fillStyle = "#f2c8a0";        // 머리
  ctx.fillRect(x - 3, y - 10, 7, 6);
  ctx.fillStyle = "#3a2a20";        // 머리카락
  ctx.fillRect(x - 4, y - 12, 9, 3);
  ctx.fillStyle = "#101418";        // 눈
  const ex = facing >= 0 ? x + 1 : x - 2;
  ctx.fillRect(ex, y - 8, 2, 2);
  ctx.fillStyle = "#ffd166";        // 맥점의 색을 닮은 짧은 길잡이 스카프
  const scarfX = facing >= 0 ? x - 6 : x + 5;
  ctx.fillRect(scarfX, y - 4, 3, 2);
  ctx.fillRect(scarfX + (facing >= 0 ? -2 : 2), y - 3, 3, 1);
}

/**
 * 플레이어가 그린 도구를 손에 들려 준다.
 * 게임 안의 모든 도구는 이 획들이 전부다.
 */
export function drawHeldTool(ctx, tool, sx, sy, facing, swing) {
  if (!tool) return;
  const dir = facing >= 0 ? 1 : -1;
  const angle = (-0.5 + swing * 1.9) * dir;
  const originX = Math.round(sx) + dir * 4;
  const originY = Math.round(sy) - 1;

  ctx.save();
  ctx.translate(originX, originY);
  ctx.rotate(angle);
  ctx.scale(dir, 1);

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
export function drawVignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(6,10,18,0.42)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
