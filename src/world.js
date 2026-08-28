// 시드와 좌표만으로 결정되는 세계.
// 지형은 좌표 함수라 어디서 계산해도 같은 풍경이 나오고, 한 번의 원정은 그중 경계 안을 개척한다.

import { fbm, hashUnit, hash2, clamp, lerp } from "./rng.js?rev=9";

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

// ---- 원정 경계 -------------------------------------------------------------
// 지형 계산은 무한하지만 한 번의 원정이 개척해야 할 땅은 이 반경 안이 전부다.
// 마지막 신호기 고리(140)보다 조금 넉넉하게 잡아 끝자락에도 걸을 여지를 남긴다.

export const WORLD_RADIUS = 150;

export function isInsideWorld(tx, ty) {
  return tx * tx + ty * ty <= WORLD_RADIUS * WORLD_RADIUS;
}

/** 아직 신호기가 모자라 들어갈 수 없는 타일인지. */
export function isLockedTile(tx, ty, foundCount) {
  return regionRequiredMarksAt(tx, ty) > foundCount;
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

function computeBiome(tx, ty, seed) {
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
function computeObstacle(tx, ty, seed) {
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

// ---- 타일 캐시 -------------------------------------------------------------
// 경계가 생긴 덕분에 세계 전체를 고정 크기 배열 두 개로 기억할 수 있다.
// 같은 타일을 프레임마다 다시 계산하던 비용이 첫 방문 한 번으로 줄어든다.

const CACHE_ORIGIN = WORLD_RADIUS + 1;
const CACHE_SPAN = CACHE_ORIGIN * 2 + 1;
const BIOME_ORDER = [BIOME.DEEP, BIOME.WATER, BIOME.SAND, BIOME.PLAIN, BIOME.GRASS, BIOME.FOREST, BIOME.ROCK];
const OBSTACLE_ORDER = [OBSTACLE.NONE, OBSTACLE.BOULDER, OBSTACLE.THICKET, OBSTACLE.BRAMBLE, OBSTACLE.TREE, OBSTACLE.MOUNTAIN];

let cacheSeed = null;
let biomeCache = null;
let obstacleCache = null;

/** 경계 안 정수 좌표만 캐시한다. 그 밖은 그때그때 계산한다. */
function cacheIndex(tx, ty, seed) {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return -1;
  const x = tx + CACHE_ORIGIN;
  const y = ty + CACHE_ORIGIN;
  if (x < 0 || y < 0 || x >= CACHE_SPAN || y >= CACHE_SPAN) return -1;

  if (seed !== cacheSeed) {
    cacheSeed = seed;
    if (biomeCache) { biomeCache.fill(0); obstacleCache.fill(0); }
    else {
      biomeCache = new Uint8Array(CACHE_SPAN * CACHE_SPAN);
      obstacleCache = new Uint8Array(CACHE_SPAN * CACHE_SPAN);
    }
  }
  return y * CACHE_SPAN + x;
}

export function biomeAt(tx, ty, seed) {
  const index = cacheIndex(tx, ty, seed);
  if (index < 0) return computeBiome(tx, ty, seed);
  const cached = biomeCache[index];
  if (cached) return BIOME_ORDER[cached - 1];
  const biome = computeBiome(tx, ty, seed);
  biomeCache[index] = BIOME_ORDER.indexOf(biome) + 1;
  return biome;
}

export function obstacleAt(tx, ty, seed) {
  const index = cacheIndex(tx, ty, seed);
  if (index < 0) return computeObstacle(tx, ty, seed);
  const cached = obstacleCache[index];
  if (cached) return OBSTACLE_ORDER[cached - 1];
  const obstacle = computeObstacle(tx, ty, seed);
  obstacleCache[index] = OBSTACLE_ORDER.indexOf(obstacle) + 1;
  return obstacle;
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

// ---- 개척 격자 -------------------------------------------------------------
// 개척률은 타일이 아니라 8x8 셀 단위로 센다.
// 분모는 경계 안에서 시작점과 이어지는 셀만 — 닿을 수 없는 땅은 애초에 세지 않는다.

export const EXPLORE_CELL = 8;
export const EXPLORE_MIN = -Math.ceil(WORLD_RADIUS / EXPLORE_CELL);
export const EXPLORE_SPAN = -EXPLORE_MIN * 2 + 1;

export function exploreCellOf(tx, ty) {
  return { cx: Math.floor(tx / EXPLORE_CELL), cy: Math.floor(ty / EXPLORE_CELL) };
}

/** 셀 좌표를 비트맵 인덱스로. 경계 밖이면 -1. */
export function exploreCellIndex(cx, cy) {
  const x = cx - EXPLORE_MIN;
  const y = cy - EXPLORE_MIN;
  if (x < 0 || y < 0 || x >= EXPLORE_SPAN || y >= EXPLORE_SPAN) return -1;
  return y * EXPLORE_SPAN + x;
}

/** 타일이 속한 셀의 비트맵 인덱스. */
export function exploreIndexAt(tx, ty) {
  const { cx, cy } = exploreCellOf(tx, ty);
  return exploreCellIndex(cx, cy);
}

/** 셀 중심의 타일 좌표. 나침반과 지도 표시에 쓴다. */
export function exploreCellCenter(cx, cy) {
  const half = EXPLORE_CELL >> 1;
  return { tx: cx * EXPLORE_CELL + half, ty: cy * EXPLORE_CELL + half };
}

const CELL_SAMPLES = [[4, 4], [1, 1], [6, 1], [1, 6], [6, 6]];

/** 셀 안에 설 수 있는 땅이 하나라도 있는지. 깊은 물과 바위는 설 수 없다. */
function cellPassable(cx, cy, seed) {
  const baseX = cx * EXPLORE_CELL;
  const baseY = cy * EXPLORE_CELL;
  for (const [ox, oy] of CELL_SAMPLES) {
    const tx = baseX + ox;
    const ty = baseY + oy;
    if (!isInsideWorld(tx, ty)) continue;
    if (!isBiomeSolid(biomeAt(tx, ty, seed))) return true;
  }
  return false;
}

const planCache = new Map();

/**
 * 시드마다 한 번만 계산하는 개척 대상 격자.
 * 시작 셀에서 사방으로 번져 나가며 통행 가능한 셀만 모으므로 100%가 항상 도달 가능하다.
 */
export function explorationPlan(seed) {
  const cached = planCache.get(seed);
  if (cached) return cached;

  const cells = new Uint8Array(EXPLORE_SPAN * EXPLORE_SPAN);
  const start = exploreCellIndex(0, 0);
  let total = 0;

  if (start >= 0 && cellPassable(0, 0, seed)) {
    const queue = [start];
    cells[start] = 1;
    total = 1;
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];
      const cx = (index % EXPLORE_SPAN) + EXPLORE_MIN;
      const cy = Math.floor(index / EXPLORE_SPAN) + EXPLORE_MIN;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextIndex = exploreCellIndex(cx + dx, cy + dy);
        if (nextIndex < 0 || cells[nextIndex]) continue;
        if (!cellPassable(cx + dx, cy + dy, seed)) continue;
        cells[nextIndex] = 1;
        total++;
        queue.push(nextIndex);
      }
    }
  }

  const plan = { cells, total };
  planCache.set(seed, plan);
  // 시드를 바꿔가며 놀아도 격자가 쌓이지 않도록 최근 것만 남긴다.
  if (planCache.size > 4) planCache.delete(planCache.keys().next().value);
  return plan;
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
