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

export const REGION_THEMES = [
  { name: "바람 초원", creatureBias: "peaceful" },
  { name: "유리모래 사막", creatureBias: "aggressive" },
  { name: "안개 숲", creatureBias: "skittish" },
  { name: "침수 습지", creatureBias: "ranged" },
  { name: "바위 고원", creatureBias: "tough" }
];

const REGION_RADII = [30, 52, 80, 112];

export function frontierRegionAt(tx, ty) {
  const distance = Math.hypot(tx, ty);
  let index = 0;
  while (index < REGION_RADII.length && distance >= REGION_RADII[index]) index++;
  return { index, ...REGION_THEMES[index] };
}

export function regionRequiredMarksAt(tx, ty) {
  return Math.min(4, frontierRegionAt(tx, ty).index);
}

export const OBSTACLE = {
  NONE: null,
  BOULDER: "boulder",
  THICKET: "thicket",
  BRAMBLE: "bramble",
  TREE: "tree",
  MOUNTAIN: "mountain"
};

/** 장애물마다 요구하는 능력치와 문턱값. 도구가 이 값을 넘겨야 치운다. */
export const OBSTACLE_RULE = {
  [OBSTACLE.BOULDER]: { stat: "edge", threshold: 0.42, label: "금이 간 바위", need: "파쇄력" },
  [OBSTACLE.THICKET]: { stat: "reach", threshold: 0.40, label: "높은 수풀", need: "사거리" },
  [OBSTACLE.BRAMBLE]: { stat: "grip", threshold: 0.34, label: "엉킨 덩굴", need: "포획력" },
  [OBSTACLE.TREE]: { stat: "reach", threshold: 0.50, label: "거대한 나무", need: "사거리" },
  [OBSTACLE.MOUNTAIN]: { stat: "edge", threshold: 0.62, label: "산비탈", need: "파쇄력" }
};

/** 물은 부력으로만 건넌다. */
export const WATER_RULE = { stat: "buoy", threshold: 0.30, label: "깊은 물", need: "부력" };

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
  const region = frontierRegionAt(tx, ty).index;

  if (region === 1) {
    if (e < 0.29) return BIOME.DEEP;
    if (e < 0.34) return BIOME.WATER;
    if (e < 0.68) return BIOME.SAND;
    return BIOME.PLAIN;
  }
  if (region === 2) {
    if (e < 0.30) return BIOME.DEEP;
    if (e < 0.36) return BIOME.WATER;
    if (m < 0.38) return BIOME.GRASS;
    return BIOME.FOREST;
  }
  if (region === 3) {
    if (e < 0.34) return BIOME.DEEP;
    if (e < 0.48) return BIOME.WATER;
    if (e < 0.52) return BIOME.SAND;
    return m > 0.58 ? BIOME.FOREST : BIOME.GRASS;
  }
  if (region === 4) {
    if (e < 0.28) return BIOME.DEEP;
    if (e < 0.33) return BIOME.WATER;
    if (e > 0.56) return BIOME.ROCK;
    return m > 0.6 ? BIOME.FOREST : BIOME.PLAIN;
  }

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
  const cluster = fbm(tx * .11, ty * .11, seed + 99203, 2);
  if (biome === BIOME.FOREST) {
    if (cluster > .57 && roll < .25) return OBSTACLE.TREE;
    if (roll < 0.12) return OBSTACLE.THICKET;
    if (roll < 0.17) return OBSTACLE.BRAMBLE;
    return OBSTACLE.NONE;
  }
  if (biome === BIOME.GRASS) {
    if (cluster > .66 && roll < .13) return OBSTACLE.TREE;
    if (roll < 0.05) return OBSTACLE.BRAMBLE;
    if (roll < 0.09) return OBSTACLE.BOULDER;
    return OBSTACLE.NONE;
  }
  if (biome === BIOME.PLAIN || biome === BIOME.SAND) {
    if (frontierRegionAt(tx, ty).index === 4 && cluster > .58 && roll < .18) return OBSTACLE.MOUNTAIN;
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

// ---- 지역 신호기 -----------------------------------------------------------
// 탐사의 주요 목표. 시작점에서 점점 먼 고리 위에 하나씩 놓인다.

export const LANDMARK_COUNT = 5;
const LANDMARK_RINGS = [20, 44, 72, 104, 140];

export const LANDMARK_NAMES = [
  "초원 신호기",
  "사막 신호기",
  "숲 신호기",
  "습지 신호기",
  "고원 신호기"
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

  const tx = cx * CREATURE_CELL + Math.floor(hashUnit(cx, cy, seed + 31) * CREATURE_CELL);
  const ty = cy * CREATURE_CELL + Math.floor(hashUnit(cx, cy, seed + 61) * CREATURE_CELL);

  const density = [0.38, 0.47, 0.52, 0.56, 0.60][frontierRegionAt(tx, ty).index];
  if (roll > density) return null;

  const biome = biomeAt(tx, ty, seed);
  if (isBiomeSolid(biome) || isWater(biome)) return null;
  if (Math.hypot(tx, ty) < 5) return null;

  return { tx, ty, biome, genomeSeed: hash2(cx, cy, seed + 909) };
}

/** 각 신호기 주변에는 지역 우두머리, 마지막 신호기에는 영역 지배자가 자리한다. */
export function bossPositions(seed) {
  return landmarkPositions(seed).map((mark, index) => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const angle = hashUnit(index, attempt, seed + 88001) * Math.PI * 2;
      const radius = 3 + (attempt % 4);
      const tx = mark.tx + Math.round(Math.cos(angle) * radius);
      const ty = mark.ty + Math.round(Math.sin(angle) * radius);
      const biome = biomeAt(tx, ty, seed);
      if (!isWater(biome) && !isBiomeSolid(biome) && !obstacleAt(tx, ty, seed)) {
        return { tx, ty, index, biome, rank: index === LANDMARK_COUNT - 1 ? "fieldboss" : "midboss" };
      }
    }
    return { tx: mark.tx, ty: mark.ty, index, biome: biomeAt(mark.tx, mark.ty, seed), rank: index === LANDMARK_COUNT - 1 ? "fieldboss" : "midboss" };
  });
}

export function villagePositions(seed) {
  const anchors = [{ tx: 3, ty: 2, index: 0, name: "첫불 마을" }, ...landmarkPositions(seed).slice(0, 4).map((m, i) => ({
    tx: m.tx, ty: m.ty, index: i + 1, name: `${REGION_THEMES[i + 1].name} 쉼터`
  }))];
  return anchors.map((anchor, index) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = hashUnit(index, attempt, seed + 61813) * Math.PI * 2;
      const radius = index === 0 ? attempt % 3 : 6 + attempt % 6;
      const tx = index === 0 ? anchor.tx : anchor.tx + Math.round(Math.cos(angle) * radius);
      const ty = index === 0 ? anchor.ty : anchor.ty + Math.round(Math.sin(angle) * radius);
      const biome = biomeAt(tx, ty, seed);
      if (!isWater(biome) && !isBiomeSolid(biome) && !obstacleAt(tx, ty, seed)) return { ...anchor, tx, ty, requiredMarks: index };
    }
    return { ...anchor, requiredMarks: index };
  });
}
