// 시드와 좌표만으로 결정되는 무한 세계.
// 어떤 타일도 저장하지 않는다. 같은 곳에 돌아오면 같은 풍경이 다시 계산된다.

import { fbm, hashUnit, hash2, clamp, lerp } from "./rng.js";

export const TILE = 16;

export const BIOME = {
  DEEP: "deep",
  WATER: "water",
  SAND: "sand",
  PLAIN: "plain",
  GRASS: "grass",
  FOREST: "forest",
  ROCK: "rock"
};

export const OBSTACLE = {
  NONE: null,
  BOULDER: "boulder",
  THICKET: "thicket",
  BRAMBLE: "bramble"
};

/** 장애물마다 요구하는 능력치와 문턱값. 도구가 이 값을 넘겨야 치운다. */
export const OBSTACLE_RULE = {
  [OBSTACLE.BOULDER]: { stat: "edge", threshold: 0.42, label: "균열 바위", need: "바위 성능" },
  [OBSTACLE.THICKET]: { stat: "reach", threshold: 0.40, label: "높은 수풀", need: "거리" },
  [OBSTACLE.BRAMBLE]: { stat: "grip", threshold: 0.34, label: "엉킨 덩굴", need: "포획" }
};

/** 물은 부력으로만 건넌다. */
export const WATER_RULE = { stat: "buoy", threshold: 0.30, label: "물", need: "물길" };

const BIOME_SOLID = {
  [BIOME.DEEP]: true,
  [BIOME.WATER]: false,
  [BIOME.ROCK]: true
};

const SPAWN_RADIUS = 9;
const SPAWN_ELEVATION = 0.55;

export function elevationAt(tx, ty, seed) {
  const base = fbm(tx * 0.045, ty * 0.045, seed, 4);
  const ridge = fbm(tx * 0.012, ty * 0.012, seed + 7717, 2);
  const raw = base * 0.62 + ridge * 0.38;

  // 시작 지점은 어떤 시드에서도 걸어다닐 수 있어야 한다.
  // 고도를 올리는 게 아니라 안전한 중간값 쪽으로 끌어당긴다.
  const d = Math.hypot(tx, ty);
  if (d >= SPAWN_RADIUS) return raw;
  const pull = Math.pow(clamp(1 - d / SPAWN_RADIUS, 0, 1), 0.55);
  return lerp(raw, SPAWN_ELEVATION, pull);
}

export function moistureAt(tx, ty, seed) {
  return fbm(tx * 0.032 + 120.5, ty * 0.032 - 88.25, seed + 3331, 3);
}

export function biomeAt(tx, ty, seed) {
  const e = elevationAt(tx, ty, seed);
  const m = moistureAt(tx, ty, seed);

  if (e < 0.30) return BIOME.DEEP;
  if (e < 0.375) return BIOME.WATER;
  if (e < 0.425) return BIOME.SAND;
  if (e > 0.735) return BIOME.ROCK;
  if (m < 0.40) return BIOME.PLAIN;
  if (m < 0.63) return BIOME.GRASS;
  return BIOME.FOREST;
}

/** 걸을 수 있는 땅 위에만 장애물이 놓인다. */
export function obstacleAt(tx, ty, seed) {
  const biome = biomeAt(tx, ty, seed);
  if (biome === BIOME.DEEP || biome === BIOME.WATER || biome === BIOME.ROCK) return OBSTACLE.NONE;
  if (Math.hypot(tx, ty) < 4) return OBSTACLE.NONE;

  // 밀도가 높으면 길이 아니라 벽이 된다. 막히되 갇히지는 않을 만큼만 놓는다.
  const roll = hashUnit(tx, ty, seed + 55501);
  if (biome === BIOME.FOREST) {
    if (roll < 0.12) return OBSTACLE.THICKET;
    if (roll < 0.17) return OBSTACLE.BRAMBLE;
    return OBSTACLE.NONE;
  }
  if (biome === BIOME.GRASS) {
    if (roll < 0.05) return OBSTACLE.BRAMBLE;
    if (roll < 0.09) return OBSTACLE.BOULDER;
    return OBSTACLE.NONE;
  }
  if (biome === BIOME.PLAIN || biome === BIOME.SAND) {
    if (roll < 0.06) return OBSTACLE.BOULDER;
    return OBSTACLE.NONE;
  }
  return OBSTACLE.NONE;
}

/** 지형만 보고 막혔는지. 장애물은 별도로 확인한다. */
export function isBiomeSolid(biome) {
  return BIOME_SOLID[biome] === true;
}

export function isWater(biome) {
  return biome === BIOME.WATER || biome === BIOME.DEEP;
}

// ---- 개척 맥점 ------------------------------------------------------------
// 첫 개척망의 목표. 시작점에서 점점 먼 고리 위에 하나씩 놓인다.

export const LANDMARK_COUNT = 5;
const LANDMARK_RINGS = [14, 26, 40, 56, 74];

export const LANDMARK_NAMES = [
  "개척의 불씨",
  "해류 우물",
  "바람 관문",
  "수림 공명석",
  "새벽 봉화"
];

/** 표석은 시드로 각도가 정해지고, 물 위에 놓이지 않도록 조금씩 밀린다. */
export function landmarkPositions(seed) {
  const out = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const radius = LANDMARK_RINGS[i];
    const baseAngle = hashUnit(i * 977, 13, seed) * Math.PI * 2;

    let placed = null;
    for (let attempt = 0; attempt < 48; attempt++) {
      const angle = baseAngle + attempt * 0.31;
      const r = radius + (attempt % 5) - 2;
      const tx = Math.round(Math.cos(angle) * r);
      const ty = Math.round(Math.sin(angle) * r);
      const biome = biomeAt(tx, ty, seed);
      if (!isWater(biome) && !isBiomeSolid(biome)) {
        placed = { tx, ty, index: i, name: LANDMARK_NAMES[i], radius };
        break;
      }
    }
    // 모든 시도가 실패하면 고리 위 기본 위치를 그대로 쓴다.
    out.push(
      placed ?? {
        tx: Math.round(Math.cos(baseAngle) * radius),
        ty: Math.round(Math.sin(baseAngle) * radius),
        index: i,
        name: LANDMARK_NAMES[i],
        radius
      }
    );
  }
  return out;
}

// ---- 크리처 서식 ---------------------------------------------------------
// 8x8 타일마다 한 마리까지. 셀 좌표 해시가 존재 여부와 유전자를 정한다.

export const CREATURE_CELL = 8;

export function creatureSeedAt(cx, cy, seed) {
  const roll = hashUnit(cx, cy, seed + 24001);
  if (roll > 0.46) return null;

  const tx = cx * CREATURE_CELL + Math.floor(hashUnit(cx, cy, seed + 31) * CREATURE_CELL);
  const ty = cy * CREATURE_CELL + Math.floor(hashUnit(cx, cy, seed + 61) * CREATURE_CELL);

  const biome = biomeAt(tx, ty, seed);
  if (isBiomeSolid(biome) || isWater(biome)) return null;
  if (Math.hypot(tx, ty) < 5) return null;

  return { tx, ty, biome, genomeSeed: hash2(cx, cy, seed + 909) };
}
