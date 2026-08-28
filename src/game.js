// Drawn Frontier — 그린 것이 곧 도구가 된다.
// 상태 기계, 입력, 시뮬레이션, 저장. 순수 로직은 이웃 모듈이 맡는다.

import { clamp, mulberry32, hashUnit } from "./rng.js";
import { analyzeStrokes, nameTool, resample } from "./geometry.js";
import {
  TILE, BIOME, biomeAt, obstacleAt, isWater, isBiomeSolid,
  OBSTACLE_RULE, WATER_RULE, landmarkPositions, LANDMARK_COUNT,
  creatureSeedAt, CREATURE_CELL, bossPositions, frontierRegionAt, regionRequiredMarksAt,
  REGION_THEMES, villagePositions
} from "./world.js";
import { buildGenome, catchThreshold } from "./creature.js";
import {
  WEAKNESS_LABELS, creatureMaxHp, bossWeakness, attackDamage, captureThresholdAtHp,
  inAttackArc, parryDisarmDuration, directionalWeaknessAllows,
  creatureAttackProfile, parryTiming, dodgeTiming
} from "./combat.js";
import {
  PROGRESSION_TIERS, tierForFragments, progressionEffects, craftingCost,
  rollInteractionReward, nextTierProgress
} from "./progression.js";
import { environmentAt, thermalState, noiseLabel } from "./environment.js";
import { creatureRewardProfile, scoreCreatureActions, scoreVillagerActions, scorePetActions, selectRewardAction } from "./behavior.js";
import { ROTATING_TIPS, challengeRows, challengeState, nextChallenge } from "./challenges.js";
import { handToolProfile, petToolStats, drawingLengthState, milestoneLengthBudget } from "./equipment.js?rev=6";
import { KEY_ACTIONS, DEFAULT_KEYMAP, normalizePreferences, rebindKey, actionForCode, keyLabel } from "./settings.js?rev=6";
import {
  drawTerrain, drawLandmark, drawCreature, drawPlayer, drawHeldTool, drawCraftingReveal, drawVignette,
  drawDeathDrops, drawParryEffect, drawAtmosphere, drawRevealEffect,
  drawVillage, drawVillager, drawSmokeEffects, drawSuccessEffects
} from "./render.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });
const W = canvas.width;
const H = canvas.height;
ctx.imageSmoothingEnabled = false;

const pad = document.getElementById("pad");
const padCtx = pad.getContext("2d");
const PAD_W = pad.width;
const PAD_H = pad.height;

const el = {
  stage: document.getElementById("stage"),
  paletteKey: document.getElementById("palette-key"),
  drawBox: document.getElementById("draw-box"),
  toolPanel: document.getElementById("tool-panel"),
  toolName: document.getElementById("tool-name"),
  toolDura: document.getElementById("tool-dura"),
  bars: document.getElementById("bars"),
  progress: document.getElementById("progress"),
  marks: document.getElementById("p-marks"),
  catalog: document.getElementById("p-catalog"),
  depth: document.getElementById("p-depth"),
  hint: document.getElementById("hint"),
  toast: document.getElementById("toast"),
  drawLayer: document.getElementById("draw-layer"),
  overlay: document.getElementById("overlay"),
  duraMeter: document.getElementById("dura-meter"),
  duraFill: document.getElementById("dura-fill"),
  vitals: document.getElementById("vitals"),
  hearts: document.getElementById("hearts"),
  resonance: document.getElementById("p-resonance"),
  fragments: document.getElementById("p-fragments"),
  mapPanel: document.getElementById("map-panel"),
  minimap: document.getElementById("minimap"),
  mapCoord: document.getElementById("map-coord"),
  goalText: document.getElementById("goal-text"),
  shoeName: document.getElementById("shoe-name"),
  captures: document.getElementById("p-captures"),
  ink: document.getElementById("p-ink"),
  drawTitle: document.getElementById("draw-title-text"),
  drawLegend: document.getElementById("draw-legend"),
  drawBudget: document.getElementById("draw-budget"),
  envTime: document.getElementById("env-time"),
  envWeather: document.getElementById("env-weather"),
  envTemp: document.getElementById("env-temp"),
  envNoise: document.getElementById("env-noise"),
  celebration: document.getElementById("celebration"),
  rewardFeed: document.getElementById("reward-feed"),
  deleteButton: Array.from(document.querySelectorAll('.draw-keys button[data-act="delete-toggle"]'))[0] ?? null
};
const mapCtx = el.minimap.getContext("2d");
mapCtx.imageSmoothingEnabled = false;

const SAVE_KEY = "drawn-frontier-v2";
const PREF_KEY = "drawn-frontier-settings-v1";
const PLAYER_SPEED = 58;      // 월드 픽셀 / 초
const TOOL_SCALE = 0.085;     // 그림 좌표 -> 월드 픽셀
const USE_RANGE = 24;

const HAND_STAT_DEFS = [
  { key: "edge", label: "파쇄력", color: "var(--edge)", tick: OBSTACLE_RULE.boulder.threshold },
  { key: "reach", label: "사거리", color: "var(--reach)", tick: OBSTACLE_RULE.thicket.threshold },
  { key: "buoy", label: "부력", color: "var(--buoy)", tick: WATER_RULE.threshold },
  { key: "grip", label: "포획력", color: "var(--grip)", tick: OBSTACLE_RULE.bramble.threshold }
];
const SHOE_STAT_DEFS = [
  { key: "speed", label: "질주", color: "var(--reach)", tick: 0.55 },
  { key: "stability", label: "안정", color: "var(--buoy)", tick: 0.48 },
  { key: "endurance", label: "내구도", color: "var(--grip)", tick: 0.45 },
  { key: "economy", label: "잉크 절약", color: "var(--edge)", tick: 0.45 }
];
const PET_STAT_DEFS = [
  { key: "power", label: "공격력", color: "var(--edge)", tick: .48 },
  { key: "range", label: "지원거리", color: "var(--reach)", tick: .50 },
  { key: "guard", label: "생존력", color: "var(--buoy)", tick: .45 },
  { key: "control", label: "제압력", color: "var(--grip)", tick: .45 }
];
const FRONTIER_LABELS = ["초심", "탐사자", "현장가", "숙련자", "정예", "개척자", "전설"];
const CAPTURE_MILESTONES = [2, 5, 9, 14];
const DROP_LIFETIME = 10;
const DEATH_DROP_LIFETIME = 60;
const WIRE_RANGE = 68;
const CRAFTING_DURATION = 1.15;
const TIP_ROTATION_MS = 5000;

const ITEM_DEFS = {
  stone: { name: "돌 조각", color: "#b9c2cf", source: "boulder" },
  fiber: { name: "질긴 섬유", color: "#8fd17b", source: "thicket" },
  resin: { name: "끈끈한 수지", color: "#e4a85f", source: "bramble" },
  essence: { name: "생체 결정", color: "#7ee0c0", source: "creature" },
  mirrorInk: { name: "반사 잉크", color: "#a9c9ff", source: "reflector" }
};

const TRAIT_COLOR = {
  edge: "#ff7b6b",
  reach: "#7fd0ff",
  buoy: "#7ee0c0",
  grip: "#ffd166"
};

// ---------------------------------------------------------------- 상태

let mode = "title";           // title | play | draw | dex | palette | win
let game = null;
let creatures = new Map();
let toastTimer = 0;
let saveTimer = 0;
let mapTimer = 0;
let dirty = false;
let last = 0;
let draftSlot = "hand";
let deleteMode = false;
let hoverStroke = -1;
let droppedItems = [];
let deathDrops = [];
let villagers = [];
let smokeEffects = [];
let successEffects = [];
let projectiles = [];
let wireState = null;
let deathState = null;
let revealEffect = null;
let celebrationTimer = 0;
let rewardNotices = [];
let lastWeatherSlot = null;
let lastDayPeriod = null;
let palettePage = "gear";
let rebindingAction = null;
let settingsReturn = "palette";
let craftingTimer = 0;
let craftingItem = null;

function loadPreferences() {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}")); }
  catch { return normalizePreferences(); }
}

let preferences = loadPreferences();

function savePreferences() {
  localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
  document.body?.classList?.toggle("limited-motion", preferences.animation === "limited");
  updateControlLabels();
}

const keys = new Set();

function newGame(seed) {
  return {
    seed,
    px: 0,
    py: 0,
    facing: 1,
    faceX: 1,
    faceY: 0,
    walking: false,
    running: false,
    swing: 0,
    attackFlash: 0,
    parryTimer: 0,
    parryCooldown: 0,
    parryFlash: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    dodgeLinkTimer: 0,
    dodgeX: 1,
    dodgeY: 0,
    bindTimer: 0,
    knockX: 0,
    knockY: 0,
    screenShake: 0,
    lockTargetKey: null,
    hp: 5,
    maxHp: 5,
    invuln: 0,
    hurt: 0,
    tool: null,
    shoes: null,
    gear: { hand: [], shoes: [] },
    gearSeq: 1,
    maxGear: 4,
    ink: 10,
    captures: 0,
    defeats: 0,
    bossesDefeated: 0,
    observations: 0,
    milestone: 0,
    fragments: 0,
    frontierTier: 0,
    inventory: { stone: 0, fiber: 0, resin: 0, essence: 0, mirrorInk: 0 },
    jumpTimer: 0,
    reflectorTimer: 0,
    pet: null,
    petTool: null,
    shoeWear: 0,
    cleared: new Set(),
    handled: new Set(),
    dex: new Map(),
    found: new Set(),
    bossStates: new Map(),
    depth: 0,
    time: 0,
    travelDistance: 0,
    temperature: 18,
    noise: 0,
    marks: landmarkPositions(seed),
    bosses: bossPositions(seed),
    villages: villagePositions(seed),
    villageInside: null,
    lastVillageIndex: 0
  };
}

// ---------------------------------------------------------------- 저장

function save() {
  if (!game) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 2,
      seed: game.seed,
      px: game.px, py: game.py,
      faceX: game.faceX, faceY: game.faceY,
      hp: game.hp, maxHp: game.maxHp,
      ink: game.ink,
      captures: game.captures,
      defeats: game.defeats,
      bossesDefeated: game.bossesDefeated,
      observations: game.observations,
      milestone: game.milestone,
      fragments: game.fragments,
      frontierTier: game.frontierTier,
      inventory: game.inventory,
      maxGear: game.maxGear,
      gearSeq: game.gearSeq,
      shoeWear: game.shoeWear,
      gear: game.gear,
      equipped: { hand: game.tool?.id ?? null, shoes: game.shoes?.id ?? null },
      depth: game.depth,
      travelDistance: game.travelDistance,
      temperature: game.temperature,
      lastVillageIndex: game.lastVillageIndex,
      cleared: [...game.cleared],
      handled: [...game.handled],
      found: [...game.found],
      bossStates: [...game.bossStates.entries()],
      dex: [...game.dex.entries()],
      tool: game.tool && {
        strokes: game.tool.strokes,
        rawStats: game.tool.rawStats,
        stats: game.tool.stats,
        toolType: game.tool.toolType,
        name: game.tool.name,
        color: game.tool.color,
        durability: game.tool.durability,
        maxDurability: game.tool.maxDurability
      },
      pet: game.pet ? {
        genome: game.pet.genome,
        hp: game.pet.hp,
        maxHp: game.pet.maxHp,
        hostile: game.pet.hostile,
        ranged: game.pet.ranged,
        x: game.pet.x,
        y: game.pet.y
      } : null,
      petTool: game.petTool && {
        strokes: game.petTool.strokes,
        rawStats: game.petTool.rawStats,
        stats: game.petTool.stats,
        petStats: game.petTool.petStats,
        name: game.petTool.name,
        color: game.petTool.color,
        durability: game.petTool.durability,
        maxDurability: game.petTool.maxDurability
      }
    }));
  } catch { /* 저장 실패는 플레이를 막지 않는다 */ }
}

/** 되돌릴 수 없는 사건은 미루지 않고 바로 기록한다. */
function saveNow() {
  save();
  dirty = false;
  saveTimer = 1.5;
}

function cleanCreatureName(name = "") {
  return name
    .replace(/^지행형 /, "다족형 ")
    .replace(/^갑각형 /, "갑충형 ")
    .replace(/^연체형 /, "장체형 ")
    .replace(/^껍질형 /, "등껍질형 ")
    .replace(/^포자형 /, "부유형 ")
    .replace(/^대개척자 /, "영역 지배자 ")
    .replace(/^문지기 /, "지역 우두머리 ");
}

function refreshSavedGearNames(g) {
  for (const item of g.gear.hand) {
    if (item?.stats) {
      const raw = item.rawStats ?? item.stats;
      const profile = handToolProfile(raw);
      item.rawStats = raw;
      item.stats = profile.stats;
      item.lengthBudget = drawingLengthState(raw, item.createdMilestone ?? g.milestone);
      item.toolType = profile.type;
      item.name = `${profile.type.label} ${nameTool(profile.stats, Math.round(raw.spanPx ?? 0))}`;
    }
  }
  for (const item of g.gear.shoes) {
    if (item?.stats) {
      const raw = item.rawStats ?? item.stats;
      item.rawStats = raw;
      item.stats = raw;
      item.lengthBudget = drawingLengthState(raw, item.createdMilestone ?? g.milestone);
      item.shoeStats = shoeStatsFrom(raw);
      item.name = nameShoes(item.shoeStats);
    }
  }
  if (g.petTool?.stats) {
    const raw = g.petTool.rawStats ?? g.petTool.stats;
    g.petTool.rawStats = raw;
    g.petTool.stats = raw;
    g.petTool.lengthBudget = drawingLengthState(raw, g.petTool.createdMilestone ?? g.milestone);
    g.petTool.petStats = petToolStats(raw);
    g.petTool.name = `동행 ${nameTool(raw, Math.round(raw.spanPx ?? 0))}`;
  }
  if (g.pet?.genome) g.pet.genome.name = cleanCreatureName(g.pet.genome.name);
  for (const entry of g.dex.values()) entry.name = cleanCreatureName(entry.name);
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 2 || !Number.isFinite(d.seed)) return null;

    const g = newGame(d.seed);
    g.px = d.px ?? 0;
    g.py = d.py ?? 0;
    g.faceX = d.faceX ?? 1;
    g.faceY = d.faceY ?? 0;
    g.facing = g.faceX < 0 ? -1 : 1;
    g.maxHp = d.maxHp ?? 5;
    g.hp = clamp(d.hp ?? g.maxHp, 1, g.maxHp);
    g.depth = d.depth ?? 0;
    g.travelDistance = d.travelDistance ?? 0;
    g.temperature = d.temperature ?? 18;
    g.cleared = new Set(d.cleared ?? []);
    g.handled = new Set(d.handled ?? []);
    g.found = new Set(d.found ?? []);
    g.lastVillageIndex = clamp(d.lastVillageIndex ?? 0, 0, Math.min(g.found.size, g.villages.length - 1));
    // 이어하기는 저장 좌표가 어디였든 마지막으로 방문한 안전 마을에서 재개한다.
    // 잠긴 지역이나 사망 직전 좌표를 그대로 불러오는 문제를 이 지점에서 끊는다.
    moveToLastVillage(g);
    g.bossStates = new Map(d.bossStates ?? []);
    g.dex = new Map(d.dex ?? []);
    g.ink = d.ink ?? 10;
    g.captures = d.captures ?? 0;
    g.defeats = d.defeats ?? 0;
    g.bossesDefeated = d.bossesDefeated ?? 0;
    g.observations = d.observations ?? 0;
    g.milestone = d.milestone ?? 0;
    g.fragments = d.fragments ?? 0;
    g.frontierTier = tierForFragments(g.fragments);
    g.inventory = { ...g.inventory, ...(d.inventory ?? {}) };
    g.maxGear = d.maxGear ?? (4 + g.milestone);
    g.gearSeq = d.gearSeq ?? 1;
    g.shoeWear = d.shoeWear ?? 0;
    g.gear = d.gear ?? { hand: [], shoes: [] };
    if (!g.gear.hand) g.gear.hand = [];
    if (!g.gear.shoes) g.gear.shoes = [];
    if (g.gear.hand.length === 0 && d.tool) {
      d.tool.id = d.tool.id ?? `hand-${g.gearSeq++}`;
      d.tool.slot = "hand";
      g.gear.hand.push(d.tool);
    }
    g.tool = g.gear.hand.find(item => item.id === d.equipped?.hand) ?? g.gear.hand[0] ?? null;
    g.shoes = g.gear.shoes.find(item => item.id === d.equipped?.shoes) ?? null;
    g.petTool = d.petTool ? { ...d.petTool, slot: "pet" } : null;
    if (d.pet?.genome) {
      const petGenome = d.pet.genome;
      g.pet = {
        x: d.pet.x ?? g.px + 18, y: d.pet.y ?? g.py + 12,
        homeX: g.px, homeY: g.py, vx: 0, vy: 0,
        genome: petGenome, hostile: false, ranged: false, rank: "normal",
        hp: Math.max(1, d.pet.hp ?? 3), maxHp: d.pet.maxHp ?? 3, stun: 0,
        facing: 1, moving: false, phase: 0, attackTimer: 0, invuln: 0, downTimer: 0
      };
    }
    refreshSavedGearNames(g);
    return g;
  } catch {
    return null;
  }
}

function lastVisitedVillage(g = game) {
  return g.villages.find(village => village.index === g.lastVillageIndex && village.requiredMarks <= g.found.size)
    ?? g.villages.filter(village => village.requiredMarks <= g.found.size).at(-1)
    ?? g.villages[0];
}

function moveToLastVillage(g = game) {
  const village = lastVisitedVillage(g);
  g.px = village.tx * TILE + TILE / 2;
  g.py = village.ty * TILE + TILE / 2 + 5;
  g.faceX = 0;
  g.faceY = 1;
  g.facing = 1;
  return village;
}

// ---------------------------------------------------------------- 지형 질의

function canFloat() {
  return !!game.tool && game.tool.stats.buoy >= WATER_RULE.threshold;
}

function blockedAt(wx, wy) {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  const biome = biomeAt(tx, ty, game.seed);

  if (isBiomeSolid(biome)) return "rock";
  if (isWater(biome)) {
    if (biome === "deep") return "deep";
    return canFloat() ? null : "water";
  }
  const ob = obstacleAt(tx, ty, game.seed);
  if (ob && !game.cleared.has(`${tx},${ty}`)) return ob;
  return null;
}

function isAfloat() {
  const tx = Math.floor(game.px / TILE);
  const ty = Math.floor(game.py / TILE);
  return isWater(biomeAt(tx, ty, game.seed));
}

function refreshVillagers() {
  const activeIds = new Set(game.villages.filter(v => v.requiredMarks <= game.found.size).map(v => v.index));
  villagers = villagers.filter(npc => activeIds.has(npc.villageIndex));
  for (const village of game.villages) {
    if (!activeIds.has(village.index) || villagers.some(npc => npc.villageIndex === village.index)) continue;
    for (let i = 0; i < 3; i++) {
      const homeX = village.tx * TILE + TILE / 2 + (i - 1) * 12;
      const homeY = village.ty * TILE + TILE / 2 + 15 + (i % 2) * 7;
      villagers.push({
        id: `${village.index}:${i}`, villageIndex: village.index,
        x: homeX, y: homeY, homeX, homeY, vx: 0, vy: 0,
        facing: i % 2 ? -1 : 1, moving: false, phase: hashUnit(village.index, i, game.seed) * 8,
        wanderTimer: 0,
        color: ["#845ec2", "#cf6f8e", "#3f8f8c"][i],
        accent: ["#f1b5cf", "#ffd0a8", "#a9e1c6"][i],
        rewardProfile: {
          care: .72 + hashUnit(village.index, i, game.seed + 17) * .6,
          social: .5 + hashUnit(village.index, i, game.seed + 19) * .8,
          duty: .65 + hashUnit(village.index, i, game.seed + 23) * .5,
          curiosity: .3 + hashUnit(village.index, i, game.seed + 29) * .65,
          caution: .8 + hashUnit(village.index, i, game.seed + 31) * .5
        }
      });
    }
  }
}

function updateVillages(dt) {
  refreshVillagers();
  const entered = game.villages.find(v => v.requiredMarks <= game.found.size && Math.hypot(v.tx * TILE + TILE / 2 - game.px, v.ty * TILE + TILE / 2 - game.py) < 38);
  if (entered && game.villageInside !== entered.index) {
    const healed = game.hp < game.maxHp || (game.pet && game.pet.hp < game.pet.maxHp);
    game.hp = game.maxHp;
    if (game.pet) game.pet.hp = game.pet.maxHp;
    game.villageInside = entered.index;
    const firstVisitSinceSave = game.lastVillageIndex !== entered.index;
    game.lastVillageIndex = entered.index;
    if (firstVisitSinceSave) saveNow();
    toast(`${entered.name} 도착 · ${healed ? "체력과 펫 회복 완료" : "안전 구역"}`, "good");
  } else if (!entered) game.villageInside = null;

  for (const npc of villagers) {
    let threat = null;
    let threatDistance = Infinity;
    for (const c of creatures.values()) {
      if (!c.hostile) continue;
      const distance = Math.hypot(c.x - npc.x, c.y - npc.y);
      if (distance < threatDistance) { threat = c; threatDistance = distance; }
    }
    const playerDx = game.px - npc.x, playerDy = game.py - npc.y;
    const playerDistance = Math.hypot(playerDx, playerDy);
    const homeDx = npc.homeX - npc.x, homeDy = npc.homeY - npc.y;
    const homeDistance = Math.hypot(homeDx, homeDy);
    const action = selectRewardAction(scoreVillagerActions(npc.rewardProfile, {
      threatDistance, playerDistance, homeDistance, playerHurt: game.hp < game.maxHp
    }));
    let ax = 0, ay = 0;
    if (action === "avoid" && threatDistance > .01) { ax = (npc.x - threat.x) / threatDistance; ay = (npc.y - threat.y) / threatDistance; }
    else if ((action === "assist" || action === "greet") && playerDistance > 15) { ax = playerDx / playerDistance; ay = playerDy / playerDistance; }
    else if (action === "home" && homeDistance > .01) { ax = homeDx / homeDistance; ay = homeDy / homeDistance; }
    else if (action === "wander") {
      npc.wanderTimer -= dt;
      if (npc.wanderTimer <= 0) { const a = hashUnit(npc.villageIndex, Math.floor(game.time / 1800) + npc.phase, game.seed) * Math.PI * 2; npc.vx = Math.cos(a); npc.vy = Math.sin(a); npc.wanderTimer = 1.2; }
      ax = npc.vx; ay = npc.vy;
    }
    const speed = (action === "avoid" ? 28 : 15) * dt;
    const nextX = npc.x + ax * speed, nextY = npc.y + ay * speed;
    if (!creatureBlocked(nextX, npc.y)) npc.x = nextX;
    if (!creatureBlocked(npc.x, nextY)) npc.y = nextY;
    npc.moving = Math.abs(ax) + Math.abs(ay) > .05;
    if (Math.abs(ax) > .05) npc.facing = ax > 0 ? 1 : -1;
  }
}

// ---------------------------------------------------------------- 크리처

function refreshCreatures() {
  const pcx = Math.floor(game.px / TILE / CREATURE_CELL);
  const pcy = Math.floor(game.py / TILE / CREATURE_CELL);
  const R = 2;

  for (const [key, c] of creatures) {
    if (c.rank === "normal" && (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cy - pcy) > R + 1)) creatures.delete(key);
  }

  for (let cy = pcy - R; cy <= pcy + R; cy++) {
    for (let cx = pcx - R; cx <= pcx + R; cx++) {
      const key = `${cx},${cy}`;
      if (creatures.has(key)) continue;
      if (game.handled.has(key)) continue;
      const seedInfo = creatureSeedAt(cx, cy, game.seed);
      if (!seedInfo) continue;
      if (regionRequiredMarksAt(seedInfo.tx, seedInfo.ty) > game.found.size) continue;

      const region = frontierRegionAt(seedInfo.tx, seedInfo.ty);
      const genome = buildGenome(seedInfo.genomeSeed, seedInfo.biome, region.index);
      const hostileChance = [0.25, 0.55, 0.35, 0.48, 0.62][region.index];
      const rangedChance = [0.05, 0.42, 0.20, 0.68, 0.38][region.index];
      const hostile = hashUnit(cx, cy, game.seed + 99173) < hostileChance;
      const maxHp = creatureMaxHp(genome);
      const ranged = hostile && hashUnit(cx, cy, game.seed + 99179) < rangedChance;
      creatures.set(key, {
        cx, cy,
        homeX: seedInfo.tx * TILE + TILE / 2,
        homeY: seedInfo.ty * TILE + TILE / 2,
        x: seedInfo.tx * TILE + TILE / 2,
        y: seedInfo.ty * TILE + TILE / 2,
        vx: 0, vy: 0,
        genome,
        hostile,
        ranged,
        rewardProfile: creatureRewardProfile(genome, hostile, ranged, "normal"),
        region: region.index,
        rank: "normal",
        weakness: null,
        hp: maxHp,
        maxHp,
        shootTimer: 0.8 + hashUnit(cx, cy, game.seed + 99181) * 1.6,
        stun: 0,
        attackState: "idle",
        attackTimer: 0,
        attackHit: false,
        attackTarget: "player",
        attackDx: 0,
        attackDy: 0,
        facing: 1,
        assetFacing: 1,
        turnMomentum: 1,
        turnHold: 0,
        moving: false,
        phase: hashUnit(cx, cy, game.seed + 77) * 10,
        wanderTimer: 0
      });
    }
  }

  for (const boss of game.bosses) {
    const key = `boss:${boss.index}`;
    if (game.handled.has(key) || creatures.has(key)) continue;
    const x = boss.tx * TILE + TILE / 2;
    const y = boss.ty * TILE + TILE / 2;
    if (regionRequiredMarksAt(boss.tx, boss.ty) > game.found.size) continue;
    if (Math.hypot(x - game.px, y - game.py) > CREATURE_CELL * TILE * (R + 1)) continue;
    const rawGenome = buildGenome((game.seed + boss.index * 104729 + 44021) >>> 0, boss.biome, boss.index);
    const scale = boss.rank === "fieldboss" ? 2.25 : 1.7;
    const genome = {
      ...rawGenome,
      name: boss.rank === "fieldboss" ? `영역 지배자 ${rawGenome.name}` : `지역 우두머리 ${rawGenome.name}`,
      segments: Math.min(7, rawGenome.segments + (boss.rank === "fieldboss" ? 3 : 2)),
      bodyRadius: rawGenome.bodyRadius * scale,
      speed: rawGenome.speed * (boss.rank === "fieldboss" ? 0.72 : 0.82)
    };
    const maxHp = creatureMaxHp(genome, boss.rank);
    const partScale = boss.rank === "fieldboss" ? 1.25 : 1;
    const bossParts = [
      { id: "seal", label: "이동 봉인", ox: -24 * partScale, oy: -12 * partScale, hp: 4, maxHp: 4, active: true, destroyed: false },
      { id: "weapon", label: "투사 기관", ox: 24 * partScale, oy: -10 * partScale, hp: 5, maxHp: 5, active: false, destroyed: false },
      { id: "legs", label: "기동 기관", ox: 0, oy: 25 * partScale, hp: 5, maxHp: 5, active: false, destroyed: false }
    ];
    const weaknessDirection = ["north", "east", "south", "west"][(game.seed + boss.index) % 4];
    const savedBoss = game.bossStates.get(boss.index);
    if (savedBoss?.parts) {
      for (const part of bossParts) Object.assign(part, savedBoss.parts.find(candidate => candidate.id === part.id) ?? {});
    }
    creatures.set(key, {
      cx: Math.floor(boss.tx / CREATURE_CELL), cy: Math.floor(boss.ty / CREATURE_CELL),
      homeX: x, homeY: y, x, y, vx: 0, vy: 0,
      genome, hostile: true, ranged: true, region: boss.index,
      rank: boss.rank, weakness: bossWeakness(game.seed + boss.index * 17),
      weaknessDirection, weaknessExposed: savedBoss?.weaknessExposed ?? false, bossParts,
      disabledRewards: savedBoss?.disabledRewards ?? { chase: true, home: true, wander: true, shoot: true },
      rewardProfile: creatureRewardProfile(genome, true, true, boss.rank),
      bossIndex: boss.index,
      hp: savedBoss?.hp ?? maxHp, maxHp, facing: 1, assetFacing: 1, turnMomentum: 1, turnHold: 0, moving: false,
      phase: hashUnit(boss.index, 77, game.seed) * 10,
      wanderTimer: 0, shootTimer: 1.2, stun: 0,
      attackState: "idle", attackTimer: 0, attackHit: false, attackCycle: 0,
      attackTarget: "player", attackDx: 0, attackDy: 0
    });
  }
}

function updatePet(dt) {
  const pet = game.pet;
  if (!pet) return;
  pet.invuln = Math.max(0, (pet.invuln ?? 0) - dt);
  if (pet.downTimer > 0) {
    pet.downTimer = Math.max(0, pet.downTimer - dt);
    pet.moving = false;
    if (pet.downTimer === 0) {
      pet.hp = pet.maxHp;
      pet.x = game.px + 16;
      pet.y = game.py + 10;
      toast(`${pet.genome.name}이 회복해 다시 합류했다`, "good");
    }
    return;
  }
  pet.attackTimer = Math.max(0, (pet.attackTimer ?? 0) - dt);

  let target = null;
  const petGearStats = game.petTool?.petStats ?? (game.petTool ? petToolStats(game.petTool.rawStats ?? game.petTool.stats) : null);
  let targetDistance = petGearStats ? 54 + petGearStats.range * 46 : 62;
  for (const c of creatures.values()) {
    if (!c.hostile || c.hp <= 0 || c.rank !== "normal") continue;
    const distance = Math.hypot(c.x - pet.x, c.y - pet.y);
    if (distance < targetDistance) { target = c; targetDistance = distance; }
  }
  pet.rewardProfile ??= {
    bravery: .8 + pet.genome.speed * .25,
    loyalty: 1.15,
    curiosity: .55 + pet.genome.skittish * .25
  };
  const playerDistance = Math.hypot(game.px - pet.x, game.py - pet.y);
  const action = selectRewardAction(scorePetActions(pet.rewardProfile, {
    hasTarget: !!target, targetDistance, playerDistance
  }));
  if (action === "attack" && target && pet.attackTimer <= 0) {
    const damage = petGearStats ? Math.max(1, Math.round(1 + petGearStats.power * 3)) : 1;
    target.hp = Math.max(0, target.hp - damage);
    if (petGearStats?.control > .55) target.disarmed = Math.max(target.disarmed ?? 0, .35 + petGearStats.control * .65);
    pet.attackTimer = game.petTool ? 1.0 : 1.35;
    if (game.petTool) {
      game.petTool.durability -= 1;
      if (game.petTool.durability <= 0) {
        toast("펫 도구의 잉크가 모두 닳았다", "bad");
        game.petTool = null;
      }
    }
    pet.facing = target.x >= pet.x ? 1 : -1;
    if (target.hp <= 0) defeatCreature(target);
    else toast(`${pet.genome.name}이 함께 공격했다`, damage > 2 ? "good" : "");
  }

  const desiredX = action === "attack" && target
    ? target.x - Math.sign(target.x - pet.x || 1) * 13
    : game.px + Math.cos(game.time / 700 + pet.phase) * 24 - game.faceX * 10;
  const desiredY = action === "attack" && target
    ? target.y + 6
    : game.py + Math.sin(game.time / 620 + pet.phase) * 18 + 12;
  const dx = desiredX - pet.x;
  const dy = desiredY - pet.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 3) {
    const speed = distance > 42 ? 80 : 42;
    pet.x += dx / distance * Math.min(distance, speed * dt);
    pet.y += dy / distance * Math.min(distance, speed * dt);
    pet.moving = true;
    if (Math.abs(dx) > 1) pet.facing = dx > 0 ? 1 : -1;
  } else pet.moving = false;
}

function hurtPet(reason) {
  const pet = game.pet;
  if (!pet || pet.downTimer > 0 || pet.invuln > 0) return;
  pet.hp -= 1;
  const guard = game.petTool?.petStats?.guard ?? 0;
  pet.invuln = 1 + guard * .8;
  dirty = true;
  if (pet.hp > 0) {
    toast(`${pet.genome.name}이 ${reason}에 맞았다`, "bad");
    return;
  }
  pet.hp = 0;
  pet.downTimer = 8;
  toast(`${pet.genome.name}이 쓰러졌다 · 잠시 뒤 다시 합류`, "bad");
}

// 실제 이동 벡터는 즉시 바뀌어도 도트 에셋은 짧은 관성을 가진다.
// 그래서 좌우 입력이 흔들릴 때는 같은 방향 포즈를 유지하고, 반대 방향이
// 지속될 때만 중립 프레임을 거쳐 뒤집힌다.
function updateCreatureFacing(c, desiredFacing, dt) {
  const desired = desiredFacing >= 0 ? 1 : -1;
  c.assetFacing ??= c.facing ?? desired;
  c.turnMomentum ??= c.assetFacing;
  const wasIntent = c.turnIntent ?? c.assetFacing;
  c.turnIntent = desired;
  if (wasIntent !== desired) c.turnHold = 0;
  c.turnHold = (c.turnHold ?? 0) + dt;
  c.turnMomentum += (desired - c.turnMomentum) * Math.min(1, dt * 5.4);
  if (desired === c.assetFacing) c.turnHold = 0;
  if (desired !== c.assetFacing && c.turnHold >= .14 && Math.abs(c.turnMomentum) >= .48) {
    c.assetFacing = desired;
    c.turnHold = 0;
  }
  c.turning = desired !== c.assetFacing || Math.abs(c.turnMomentum) < .74;
  c.facing = desired;
}

function beginCreatureAttack(c, targetX, targetY, target = "player") {
  const profile = creatureAttackProfile(c.rank, c.ranged, c.genome.threat);
  const dx = targetX - c.x;
  const dy = targetY - c.y;
  const distance = Math.hypot(dx, dy) || 1;
  c.attackDx = dx / distance;
  c.attackDy = dy / distance;
  c.attackTarget = target;
  c.attackHit = false;
  const closeBoss = c.rank !== "normal" && distance < c.genome.bodyRadius + 34;
  if (closeBoss) {
    const cycle = c.attackCycle ?? 0;
    c.attackCycle = cycle + 1;
    c.bossMove = cycle % 2 === 0 ? "slam" : "bite";
    c.attackState = `${c.bossMove}-tell`;
  } else c.attackState = c.ranged ? "shoot-tell" : "tell";
  c.attackTimer = profile.tell;
  c.moving = false;
  if (Math.abs(c.attackDx) > .08) c.turnIntent = c.attackDx > 0 ? 1 : -1;
}

function updateCreatureAttack(c, creatureKey, dt) {
  const profile = creatureAttackProfile(c.rank, c.ranged, c.genome.threat);
  const targetIsPet = c.attackTarget === "pet" && game.pet?.downTimer <= 0;
  const target = targetIsPet ? game.pet : { x: game.px, y: game.py };
  if (!target) { c.attackState = "idle"; return true; }
  c.attackTimer -= dt;
  c.moving = false;
  if (Math.abs(c.attackDx) > .08) updateCreatureFacing(c, c.attackDx > 0 ? 1 : -1, dt);

  if (["tell", "shoot-tell", "slam-tell", "bite-tell"].includes(c.attackState)) {
    if (c.attackTimer > 0) return true;
    if (c.attackState === "shoot-tell") {
      const dx = target.x - c.x;
      const dy = target.y - c.y;
      const distance = Math.hypot(dx, dy) || 1;
      projectiles.push({ x: c.x, y: c.y - 3, vx: dx / distance * 88, vy: dy / distance * 88, owner: creatureKey, reflected: false, life: 3.2 });
      c.shootTimer = 2.0 + hashUnit(c.cx, c.cy, game.seed + Math.floor(game.time / 2000)) * 1.4;
      c.attackState = "recover";
      c.attackTimer = profile.recover;
      return true;
    }
    if (c.attackState === "slam-tell") {
      c.attackState = "slam";
      c.attackTimer = profile.slam;
    } else {
      c.attackState = "lunge";
      c.attackTimer = profile.lunge;
    }
    return true;
  }

  if (c.attackState === "slam") {
    if (!c.attackHit && Math.hypot(target.x - c.x, target.y - c.y) < c.genome.bodyRadius + 17) {
      c.attackHit = true;
      if (targetIsPet) hurtPet(`${c.genome.name}의 내려찍기`);
      else if (game.parryTimer > 0) {
        c.disarmed = parryDisarmDuration(c.rank);
        c.stun = .4;
        game.parryFlash = .42;
        successEffect(game.px, game.py, "parry");
        toast(`${c.genome.name}의 내려찍기를 정확히 패링했다`, "good");
      } else hurtPlayer(`${c.genome.name}의 내려찍기`, c, profile);
    }
    if (c.attackTimer <= 0) {
      c.attackState = "recover";
      c.attackTimer = profile.recover;
    }
    return true;
  }

  if (c.attackState === "lunge") {
    const nx = c.x + c.attackDx * profile.speed * dt;
    const ny = c.y + c.attackDy * profile.speed * dt;
    if (!creatureBlocked(nx, c.y)) c.x = nx;
    if (!creatureBlocked(c.x, ny)) c.y = ny;
    c.moving = true;
    if (!c.attackHit && Math.hypot(target.x - c.x, target.y - c.y) < c.genome.bodyRadius + 7) {
      c.attackHit = true;
      if (targetIsPet) hurtPet(`${c.genome.name}의 돌진`);
      else if (game.parryTimer > 0) {
        c.disarmed = parryDisarmDuration(c.rank);
        c.stun = .32;
        c.attackState = "recover";
        c.attackTimer = profile.recover;
        game.parryFlash = .35;
        successEffect(game.px, game.py, "parry");
        toast(`${c.genome.name}의 돌진을 정확히 패링했다 · 잠시 무장해제`, "good");
      } else {
        hurtPlayer(`${c.genome.name}의 돌진`, c, profile);
      }
    }
    if (c.attackTimer <= 0) {
      c.attackState = "recover";
      c.attackTimer = profile.recover;
    }
    return true;
  }

  if (c.attackState === "recover") {
    if (c.attackTimer <= 0) c.attackState = "idle";
    return true;
  }
  return false;
}

function updateCreatures(dt) {
  const env = currentEnvironment();
  const sightFactor = .72 + env.daylight * .38;
  const hostileAwareness = (48 + game.noise * 58) * sightFactor;
  const locked = game.lockTargetKey ? creatures.get(game.lockTargetKey) : null;
  if (!locked || !locked.hostile || locked.hp <= 0 || Math.hypot(locked.x - game.px, locked.y - game.py) > LOCK_RANGE * 1.08) game.lockTargetKey = null;
  for (const [creatureKey, c] of creatures) {
    if (regionRequiredMarksAt(Math.floor(c.x / TILE), Math.floor(c.y / TILE)) > game.found.size) continue;
    const dx = game.px - c.x;
    const dy = game.py - c.y;
    const dist = Math.hypot(dx, dy);
    const petActive = game.pet && game.pet.downTimer <= 0;
    const petDx = petActive ? game.pet.x - c.x : 0;
    const petDy = petActive ? game.pet.y - c.y : 0;
    const petDist = petActive ? Math.hypot(petDx, petDy) : Infinity;
    c.stun = Math.max(0, c.stun - dt);
    c.disarmed = Math.max(0, (c.disarmed ?? 0) - dt);
    c.hitFlash = Math.max(0, (c.hitFlash ?? 0) - dt);
    c.shootTimer -= dt;
    if (c.stun > 0 || c.disarmed > 0) { c.attackState = "idle"; c.moving = false; continue; }
    if (c.attackState && c.attackState !== "idle" && updateCreatureAttack(c, creatureKey, dt)) continue;

    const homeDx = c.homeX - c.x;
    const homeDy = c.homeY - c.y;
    const homeDistance = Math.hypot(homeDx, homeDy);
    const targetDistance = Math.min(dist, petDist);
    const profile = c.rewardProfile ?? creatureRewardProfile(c.genome, c.hostile, c.ranged, c.rank);
    c.rewardProfile = profile;
    const scores = scoreCreatureActions(profile, {
      targetDistance,
      awareness: c.hostile ? hostileAwareness : 26 + c.genome.skittish * 42 + game.noise * 34,
      homeDistance,
      canShoot: c.ranged && c.shootTimer <= 0
    }, c.disabledRewards ?? {});
    const action = selectRewardAction(scores);
    let ax = 0;
    let ay = 0;

    if (action === "shoot" && dist > .01) {
      beginCreatureAttack(c, game.px, game.py);
      continue;
    }
    if (action === "chase" && targetDistance > .01) {
      const targetsPet = petDist < dist && petDist < 48;
      const chaseDx = targetsPet ? petDx : dx;
      const chaseDy = targetsPet ? petDy : dy;
      const chaseDist = targetsPet ? petDist : dist;
      ax = chaseDx / chaseDist;
      ay = chaseDy / chaseDist;
      if (chaseDist < c.genome.bodyRadius + 14) {
        beginCreatureAttack(c, targetsPet ? game.pet.x : game.px, targetsPet ? game.pet.y : game.py, targetsPet ? "pet" : "player");
        continue;
      }
    } else if (action === "retreat" && dist > .01) {
      ax = -dx / dist;
      ay = -dy / dist;
    } else if (action === "home" && homeDistance > .01) {
      ax = homeDx / homeDistance;
      ay = homeDy / homeDistance;
    } else if (action === "wander") {
      c.wanderTimer -= dt;
      if (c.wanderTimer <= 0) {
        c.wanderTimer = .8 + Math.random() * 1.6;
        const angle = Math.random() * Math.PI * 2;
        c.vx = Math.cos(angle);
        c.vy = Math.sin(angle);
      }
      ax = c.vx;
      ay = c.vy;
    }

    const speed = c.genome.speed * 26 * dt;
    const nx = c.x + ax * speed;
    const ny = c.y + ay * speed;
    if (!creatureBlocked(nx, c.y)) c.x = nx;
    if (!creatureBlocked(c.x, ny)) c.y = ny;
    c.moving = Math.abs(ax) + Math.abs(ay) > .05;
    if (Math.abs(ax) > .05) updateCreatureFacing(c, ax >= 0 ? 1 : -1, dt);
  }
}

/** 크리처는 물과 바위를 피한다. 장애물은 통과한다 (몸집이 작다). */
function creatureBlocked(wx, wy) {
  const b = biomeAt(Math.floor(wx / TILE), Math.floor(wy / TILE), game.seed);
  return isBiomeSolid(b) || isWater(b);
}

// ---------------------------------------------------------------- 해금 능력과 투사체

function tryJump() {
  if (!progressionEffects(game.frontierTier).jump) {
    toast("점프 기술을 먼저 해금해야 한다", "bad");
    return;
  }
  if (game.jumpTimer > 0) return; // 공중 재입력을 무시해 2단 점프를 막는다.
  game.jumpTimer = 0.62;
}

function useReflector() {
  if (!progressionEffects(game.frontierTier).reflector) {
    toast("반사 방벽 기술을 먼저 해금해야 한다", "bad");
    return;
  }
  if (!game.tool) {
    toast("반사 방벽의 모양을 정할 손도구가 필요하다", "bad");
    return;
  }
  if (game.inventory.mirrorInk <= 0) {
    toast("반사 잉크가 없다 — 상호작용 보상에서 다시 찾을 수 있다", "bad");
    return;
  }
  game.inventory.mirrorInk -= 1;
  game.reflectorTimer = 1.45;
  saveNow();
  toast("손도구의 모양을 따라 반사 방벽을 펼쳤다", "good");
}

function useWire() {
  if (!progressionEffects(game.frontierTier).wire) {
    toast("와이어 기술을 먼저 해금해야 한다", "bad");
    return;
  }
  if (wireState) return;
  const faceLength = Math.hypot(game.faceX, game.faceY) || 1;
  const fx = game.faceX / faceLength;
  const fy = game.faceY / faceLength;

  let targetCreature = null;
  let bestDistance = WIRE_RANGE;
  for (const [key, c] of creatures) {
    const dx = c.x - game.px;
    const dy = c.y - game.py;
    const distance = Math.hypot(dx, dy);
    const facing = distance > 0 ? (dx * fx + dy * fy) / distance : 0;
    if (distance < bestDistance && facing > 0.42) {
      bestDistance = distance;
      targetCreature = { key, c };
    }
  }
  if (targetCreature) {
    if (targetCreature.c.rank !== "normal") {
      if (targetCreature.c.weaknessExposed && game.dodgeLinkTimer > 0) {
        const vectors = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
        const [wx, wy] = vectors[targetCreature.c.weaknessDirection] ?? [1, 0];
        const offset = targetCreature.c.genome.bodyRadius + 18;
        wireState = {
          type: "weakness", key: targetCreature.key, time: .38,
          x: targetCreature.c.x + wx * offset,
          y: targetCreature.c.y + wy * offset
        };
        game.dodgeLinkTimer = 0;
        toast("회피 연결 성공 — 와이어가 열린 약점 쪽으로 끌어당긴다", "good");
        return;
      }
      toast(`${targetCreature.c.genome.name}은 너무 거대해 와이어로 당길 수 없다`, "bad");
      return;
    }
    wireState = { type: "creature", key: targetCreature.key, time: 0.46 };
    toast(`${targetCreature.c.genome.name}에게 와이어를 걸었다`);
    return;
  }

  for (let distance = 18; distance <= WIRE_RANGE; distance += 7) {
    const x = game.px + fx * distance;
    const y = game.py + fy * distance;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (regionRequiredMarksAt(tx, ty) > game.found.size) {
      toast("아직 열리지 않은 구역에는 와이어를 걸 수 없다", "bad");
      return;
    }
    const biome = biomeAt(tx, ty, game.seed);
    const obstacle = obstacleAt(tx, ty, game.seed);
    if (isBiomeSolid(biome) || isWater(biome) || (obstacle && !game.cleared.has(`${tx},${ty}`))) {
      wireState = { type: "anchor", x, y, time: 0.42 };
      toast("지형에 와이어를 걸고 몸을 당긴다");
      return;
    }
  }
  toast("와이어를 걸 대상이 사거리 안에 없다", "bad");
}

function updateWire(dt) {
  if (!wireState) return;
  wireState.time -= dt;
  if (wireState.type === "creature") {
    const creature = creatures.get(wireState.key);
    if (!creature) { wireState = null; return; }
    const dx = game.px - creature.x;
    const dy = game.py - creature.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 12) {
      const step = Math.min(distance - 12, 145 * dt);
      creature.x += (dx / distance) * step;
      creature.y += (dy / distance) * step;
    }
  } else if (wireState.type === "weakness") {
    const creature = creatures.get(wireState.key);
    if (!creature) { wireState = null; return; }
    const dx = wireState.x - game.px;
    const dy = wireState.y - game.py;
    const distance = Math.hypot(dx, dy);
    if (distance > 7) {
      const step = Math.min(distance - 7, 205 * dt);
      game.px += dx / distance * step;
      game.py += dy / distance * step;
      dirty = true;
    }
  } else {
    const dx = wireState.x - game.px;
    const dy = wireState.y - game.py;
    const distance = Math.hypot(dx, dy);
    if (distance > 8) {
      const step = Math.min(distance - 8, 150 * dt);
      game.px += (dx / distance) * step;
      game.py += (dy / distance) * step;
      dirty = true;
    }
  }
  if (wireState.time <= 0) wireState = null;
}

function updateProjectiles(dt) {
  const kept = [];
  for (const projectile of projectiles) {
    projectile.life -= dt;
    if (projectile.life <= 0) continue;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    const playerDistance = Math.hypot(projectile.x - game.px, projectile.y - game.py);
    if (!projectile.reflected && (game.parryTimer > 0 || game.reflectorTimer > 0) && playerDistance < 16 + (game.tool?.stats.reach ?? 0) * 10) {
      const owner = creatures.get(projectile.owner);
      const dx = (owner?.x ?? (game.px - projectile.vx)) - projectile.x;
      const dy = (owner?.y ?? (game.py - projectile.vy)) - projectile.y;
      const distance = Math.hypot(dx, dy) || 1;
      projectile.vx = (dx / distance) * 112;
      projectile.vy = (dy / distance) * 112;
      projectile.reflected = true;
      projectile.parried = game.parryTimer > 0;
      game.parryFlash = game.parryTimer > 0 ? 0.35 : game.parryFlash;
      if (game.parryTimer > 0) successEffect(game.px, game.py, "parry");
      if (game.parryTimer > 0) toast("패링 성공 — 투사체를 되돌렸다", "good");
      kept.push(projectile);
      continue;
    }
    if (!projectile.reflected && playerDistance < 6) {
      if (game.jumpTimer <= 0) hurtPlayer("투사체");
      continue;
    }
    if (projectile.reflected) {
      const target = creatures.get(projectile.owner);
      if (target && Math.hypot(projectile.x - target.x, projectile.y - target.y) < 8) {
        if (projectile.parried) {
          target.hp = Math.max(0, target.hp - 2);
          target.disarmed = parryDisarmDuration(target.rank);
          target.hitFlash = 0.3;
          if (target.hp <= 0) defeatCreature(target);
          else toast(`${target.genome.name}에게 투사체 반사 · 무장해제`, "good");
        } else {
          target.stun = 2.6;
          toast(`${target.genome.name}의 투사체를 되돌려 기절시켰다`, "good");
        }
        continue;
      }
    }
    const biome = biomeAt(Math.floor(projectile.x / TILE), Math.floor(projectile.y / TILE), game.seed);
    if (regionRequiredMarksAt(Math.floor(projectile.x / TILE), Math.floor(projectile.y / TILE)) > game.found.size) continue;
    if (isBiomeSolid(biome)) continue;
    kept.push(projectile);
  }
  projectiles = kept;
}

// ---------------------------------------------------------------- 도구

function shoeStatsFrom(stats) {
  const speed = clamp(0.18 + stats.reach * 0.82, 0, 1);
  const stability = clamp(stats.buoy * 0.55 + stats.grip * 0.45, 0, 1);
  // 빠른 신발일수록 같은 잉크량으로 얻는 수명은 줄어든다.
  const endurance = clamp((stats.ink * 0.72 + stats.grip * 0.28) * (1 - speed * 0.48), 0, 1);
  const economy = clamp(1 - Math.max(0, stats.strokeCount - 1) / 7, 0, 1);
  return { speed, stability, endurance, economy };
}

function nameShoes(stats) {
  if (stats.speed > 0.72) return "바람걸음";
  if (stats.stability > 0.62) return "뿌리장화";
  if (stats.endurance > 0.55) return "긴길신";
  return "탐사화";
}

function buildGear(strokes, slot = "hand") {
  const rawStats = analyzeStrokes(strokes, PAD_W, PAD_H);
  if (rawStats.durability === 0) return null;

  // 그림을 중심에 맞추고 월드 크기로 줄인다.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const normalized = strokes
    .filter(s => s.length >= 2)
    .map(s => resample(s, 5).map(p => ({
      x: (p.x - cx) * TOOL_SCALE,
      y: (p.y - cy) * TOOL_SCALE
    })));

  const dominant = HAND_STAT_DEFS
    .map(d => [d.key, rawStats[d.key]])
    .sort((a, b) => b[1] - a[1])[0][0];

  const resonanceBonus = game?.found?.size ?? 0;
  const handProfile = handToolProfile(rawStats);
  const shoeStats = shoeStatsFrom(rawStats);
  const companionStats = petToolStats(rawStats);
  const stats = slot === "hand" ? handProfile.stats : rawStats;
  const durability = slot === "shoes"
    ? Math.round(5 + shoeStats.endurance * 18) + resonanceBonus
    : rawStats.durability + resonanceBonus + (slot === "hand" ? Math.round(handProfile.stats.efficiency * 3) : 0);
  return {
    id: `${slot}-${game.gearSeq++}`,
    slot,
    strokes: normalized,
    rawStats,
    stats,
    createdMilestone: game.milestone,
    lengthBudget: drawingLengthState(rawStats, game.milestone),
    shoeStats,
    petStats: companionStats,
    toolType: handProfile.type,
    name: slot === "shoes" ? nameShoes(shoeStats) : slot === "pet" ? `동행 ${nameTool(rawStats, Math.round(rawStats.spanPx))}` : `${handProfile.type.label} ${nameTool(stats, Math.round(rawStats.spanPx))}`,
    color: TRAIT_COLOR[dominant],
    durability,
    maxDurability: durability
  };
}

function spendTool() {
  game.tool.durability -= 1;
  if (game.tool.durability <= 0) {
    const name = game.tool.name;
    const id = game.tool.id;
    game.tool = null;
    game.gear.hand = game.gear.hand.filter(item => item.id !== id);
    toast(`${name}의 잉크가 모두 닳았다`, "bad");
  }
  dirty = true;   // 위치와 함께 다음 주기에 반영된다
}

function totalGear() {
  return game.gear.hand.length + game.gear.shoes.length;
}

function wearShoes(distance) {
  if (!game.shoes || !game.running) return;
  const endurance = game.shoes.shoeStats?.endurance ?? 0;
  game.shoeWear += distance / TILE / (1 + endurance * 2.2);
  if (game.shoeWear < 7) return;
  game.shoeWear -= 7;
  game.shoes.durability -= 1;
  dirty = true;
  if (game.shoes.durability > 0) return;
  const broken = game.shoes;
  game.gear.shoes = game.gear.shoes.filter(item => item.id !== broken.id);
  game.shoes = null;
  toast(`${broken.name}이 닳았다 — 기본 장화로 달린다`, "bad");
}

function hurtPlayer(reason, attacker = null, attackProfile = null) {
  if (game.invuln > 0) return;
  if (game.dodgeTimer > 0) {
    game.dodgeLinkTimer = dodgeTiming().wireLink;
    game.parryFlash = Math.max(game.parryFlash, .18);
    successEffect(game.px, game.py, "dodge");
    toast(`${reason}을 회피했다 — 약점 쪽 와이어 연결이 잠깐 열렸다`, "good");
    return;
  }
  game.hp -= 1;
  game.invuln = 1.1;
  game.hurt = 1;
  const dx = game.px - (attacker?.x ?? game.px - game.faceX);
  const dy = game.py - (attacker?.y ?? game.py - game.faceY);
  const distance = Math.hypot(dx, dy) || 1;
  const profile = attackProfile ?? creatureAttackProfile(attacker?.rank, attacker?.ranged, attacker?.genome?.threat);
  game.knockX = dx / distance * profile.knockback;
  game.knockY = dy / distance * profile.knockback;
  game.bindTimer = Math.max(game.bindTimer, profile.bind);
  game.screenShake = Math.max(game.screenShake, .42);
  dirty = true;

  if (game.hp > 0) {
    toast(`${reason}에 맞았다 — 밀려나고 잠시 경직`, "bad");
    return;
  }

  beginDeath();
}

function beginDeath() {
  if (deathState) return;
  const x = game.px;
  const y = game.py;
  for (const [itemKey, count] of Object.entries(game.inventory)) {
    for (let i = 0; i < count; i++) deathDrops.push({ type: "item", itemKey, x: x + (Math.random() - .5) * 24, y: y + (Math.random() - .5) * 18, expiresAt: game.time + DROP_LIFETIME * 1000 });
  }
  for (const item of [game.tool, game.shoes, game.petTool]) {
    if (item) deathDrops.push({ type: "gear", item, x: x + (Math.random() - .5) * 28, y: y + (Math.random() - .5) * 22, expiresAt: game.time + DROP_LIFETIME * 1000 });
  }
  game.inventory = { stone: 0, fiber: 0, resin: 0, essence: 0, mirrorInk: 0 };
  game.tool = null;
  game.shoes = null;
  game.petTool = null;
  game.gear = { hand: [], shoes: [] };
  deathState = { x, y, timer: 1.15, opened: false };
  dirty = true;
  toast("탐험가가 쓰러졌다 — 장비와 수집품이 흩어졌다", "bad");
}

function showRespawn() {
  if (!deathState || deathState.opened) return;
  deathState.opened = true;
  mode = "death";
  el.overlay.hidden = false;
  const village = lastVisitedVillage();
  el.overlay.innerHTML = `<div class="death-dialog"><h1>탐험가가 쓰러졌다</h1><p class="sub">장비와 수집품은 쓰러진 자리에 잠시 남습니다.<br>진행을 유지하면 마지막으로 방문한 <b>${village.name}</b>에서 다시 시작합니다.</p><div class="row"><button data-act="respawn">진행 유지 · ${village.name}에서 재시작</button><button class="danger" data-act="reset-expedition">모든 진행 초기화</button></div><p class="reset-warning">초기화하면 신호기, 도감, 포획, 보스, 기술, 펫, 장비, 수집품이 모두 사라집니다.</p></div>`;
}

function respawnPlayer() {
  const village = moveToLastVillage();
  game.hp = game.maxHp; game.invuln = 1.8;
  game.pet = game.pet ? { ...game.pet, x: game.px + 18, y: game.py + 12, hp: game.pet.maxHp, attackTimer: 0, invuln: 0, downTimer: 0 } : null;
  for (const drop of deathDrops) {
    droppedItems.push({
      ...drop,
      id: `death-${drop.itemKey ?? drop.item?.id}-${game.time}-${droppedItems.length}`,
      readyAt: game.time,
      lifetimeMs: DEATH_DROP_LIFETIME * 1000,
      expiresAt: game.time + DEATH_DROP_LIFETIME * 1000
    });
  }
  deathDrops = [];
  deathState = null;
  creatures.clear(); projectiles = []; wireState = null;
  saveNow(); hideOverlay();
  toast(`${village.name}에서 다시 시작했다 — 잃은 물건은 현장에 남아 있다`, "good");
}

function resetExpeditionAfterDeath() {
  const seed = game.seed;
  game = newGame(seed);
  creatures.clear();
  projectiles = [];
  droppedItems = [];
  deathDrops = [];
  villagers = [];
  smokeEffects = [];
  wireState = null;
  deathState = null;
  clearPresentationEffects();
  dirty = true;
  saveNow();
  hideOverlay();
  toast("같은 세계의 원정 진행을 처음부터 다시 시작했다", "good");
}

// ---------------------------------------------------------------- 상호작용

function nearestObstacle() {
  const tx = Math.floor(game.px / TILE);
  const ty = Math.floor(game.py / TILE);
  let best = null;
  let bestDist = USE_RANGE + progressionEffects(game.frontierTier).rangeBonus;

  for (let y = ty - 2; y <= ty + 2; y++) {
    for (let x = tx - 2; x <= tx + 2; x++) {
      const key = `${x},${y}`;
      if (game.cleared.has(key)) continue;
      const ob = obstacleAt(x, y, game.seed);
      if (!ob) continue;
      const dx = x * TILE + TILE / 2 - game.px;
      const dy = y * TILE + TILE / 2 - game.py;
      const d = Math.hypot(dx, dy);
      if (!inAttackArc(dx, dy, game.faceX, game.faceY, bestDist, 4)) continue;
      if (d < bestDist) {
        bestDist = d;
        best = { x, y, kind: ob, key };
      }
    }
  }
  return best;
}

function nearestCreature() {
  let best = null;
  let bestDist = USE_RANGE + 6 + progressionEffects(game.frontierTier).rangeBonus;
  for (const c of creatures.values()) {
    const d = Math.hypot(c.x - game.px, c.y - game.py);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

const LOCK_RANGE = 150;

function lockCandidates() {
  return [...creatures.values()]
    .filter(c => c.hostile && c.hp > 0 && Math.hypot(c.x - game.px, c.y - game.py) <= LOCK_RANGE)
    .sort((a, b) => Math.hypot(a.x - game.px, a.y - game.py) - Math.hypot(b.x - game.px, b.y - game.py));
}

function toggleLockOn() {
  const candidates = lockCandidates();
  if (candidates.length === 0) {
    game.lockTargetKey = null;
    toast("주변에 락온할 상대가 없다");
    return;
  }
  const current = candidates.findIndex(c => creatureKey(c) === game.lockTargetKey);
  const next = candidates[(current + 1 + candidates.length) % candidates.length];
  game.lockTargetKey = creatureKey(next);
  updateLockedFacing();
  toast(`${next.rank === "normal" ? "상대" : "우두머리"} 포커싱`, "good");
}

function updateLockedFacing() {
  const target = game.lockTargetKey ? creatures.get(game.lockTargetKey) : null;
  if (!target || !target.hostile || target.hp <= 0) return false;
  const dx = target.x - game.px;
  const dy = target.y - game.py;
  const length = Math.hypot(dx, dy);
  if (length <= 0 || length > LOCK_RANGE * 1.08) return false;
  game.faceX = dx / length;
  game.faceY = dy / length;
  if (Math.abs(game.faceX) > .12) game.facing = game.faceX < 0 ? -1 : 1;
  return true;
}

function attackTarget() {
  if (!game) return null;
  const reach = 23 + (game.tool?.stats.reach ?? 0) * 19;
  const fx = game.faceX || 0;
  const fy = game.faceY || 0;
  let best = null;
  let bestDistance = Infinity;
  const locked = game.lockTargetKey ? creatures.get(game.lockTargetKey) : null;
  const ordered = locked ? [locked, ...creatures.values()].filter((c, index, all) => all.indexOf(c) === index) : [...creatures.values()];
  for (const c of ordered) {
    if (!c.hostile || c.hp <= 0) continue;
    if (c.bossParts) {
      const part = c.bossParts.find(candidate => candidate.active && !candidate.destroyed);
      if (part) {
        const px = c.x + part.ox, py = c.y + part.oy;
        const dx = px - game.px, dy = py - game.py;
        const distance = Math.hypot(dx, dy);
        if (inAttackArc(dx, dy, fx, fy, reach, 7) && distance < bestDistance) {
          best = { kind: "bossPart", creature: c, part };
          bestDistance = distance;
        }
        continue;
      }
    }
    const dx = c.x - game.px;
    const dy = c.y - game.py;
    const distance = Math.hypot(dx, dy);
    if (!inAttackArc(dx, dy, fx, fy, reach, c.genome.bodyRadius)) continue;
    if (distance < bestDistance) { best = { kind: "creature", creature: c }; bestDistance = distance; }
  }
  return best;
}

function tryParry() {
  if (game.parryCooldown > 0 || game.parryTimer > 0) return;
  const guard = game.tool?.stats.guard ?? 0;
  const timing = parryTiming(guard);
  game.parryTimer = timing.window;
  game.parryCooldown = timing.cooldown;
  game.parryFlash = 0.24;
  game.noise = clamp(game.noise + .08, 0, 1);
  toast("짧은 패링 자세 — 공격이 닿는 순간에 맞추자");
}

function tryDodge() {
  const timing = dodgeTiming();
  if (game.dodgeCooldown > 0 || game.bindTimer > 0 || deathState) return;
  const dx = game.faceX || game.facing || 1;
  const dy = game.faceY || 0;
  const length = Math.hypot(dx, dy) || 1;
  game.dodgeX = dx / length;
  game.dodgeY = dy / length;
  game.dodgeTimer = timing.window;
  game.dodgeCooldown = timing.cooldown;
  game.parryFlash = Math.max(game.parryFlash, .12);
  game.noise = clamp(game.noise + .05, 0, 1);
}

function repairEquippedGear() {
  let repaired = false;
  for (const item of [game.tool, game.shoes, game.petTool]) {
    if (!item || item.durability >= item.maxDurability) continue;
    item.durability += 1;
    repaired = true;
  }
  return repaired;
}

function grantInteractionReward(source, x, y) {
  const reward = rollInteractionReward(source, x, y, game.seed, game.frontierTier);
  if (!reward.dropped) return "";

  const beforeTier = game.frontierTier;
  game.fragments += 1;
  game.ink += 1;
  game.frontierTier = tierForFragments(game.fragments);

  const material = source === "boulder" ? "stone"
    : source === "mountain" ? "stone"
    : source === "thicket" ? "fiber"
      : source === "tree" ? "fiber"
      : source === "bramble" ? "resin" : "essence";
  game.inventory[material] += 1;

  const repaired = progressionEffects(game.frontierTier).fieldRepair && repairEquippedGear();
  const unlocked = game.frontierTier > beforeTier ? PROGRESSION_TIERS[game.frontierTier - 1] : null;
  const parts = ["기술 조각을 찾았다", "잉크를 얻었다", `${ITEM_DEFS[material].name} 발견`];
  if (repaired) parts.push("장비를 수선했다");
  if (unlocked) {
    parts.push(`${unlocked.name} 사용 가능`);
    celebrate(`새 기술: ${unlocked.name}`, unlocked.description);
    if (game.frontierTier === 5) {
      game.inventory.mirrorInk += 2;
      parts.push("반사 잉크 발견");
    }
  } else if (progressionEffects(game.frontierTier).reflector && hashUnit(x, y, game.seed + 79001) < 0.28) {
    game.inventory.mirrorInk += 1;
    parts.push("반사 잉크 발견");
  }
  rewardNotice(parts.join(" · "));
  return ` · ${parts.join(" · ")}`;
}

function grantCreatureReward(creature, first) {
  if (creature.hostile) {
    game.captures += 1;
    game.ink += first ? 3 : 2;
    while (game.milestone < CAPTURE_MILESTONES.length &&
      game.captures >= CAPTURE_MILESTONES[game.milestone]) {
      game.milestone += 1;
      game.maxGear += 1;
      game.ink += 4;
    }
  } else {
    game.observations += 1;
    game.ink += first ? 2 : 1;
  }
}

function interactCreature(c) {
  if (c.rank !== "normal") {
    toast("우두머리는 포획할 수 없다. 표시된 약점으로 쓰러뜨리자", "bad");
    return;
  }
  const baseNeed = catchThreshold(c.genome) * (c.stun > 0 ? 0.55 : 1);
  const need = c.hostile ? captureThresholdAtHp(baseNeed, c.hp, c.maxHp, c.rank) : baseNeed;
  const have = game.tool.stats.grip;
  if (!Number.isFinite(need)) {
    toast("아직 기운이 넘친다 · 먼저 공격해 약화시키자", "bad");
    return;
  }
  if (have < need) {
    toast("포획력이 부족하다 · 더 약화된 뒤 다시 시도하자", "bad");
    dirty = true;
    return;
  }

  const first = !game.dex.has(c.genome.species);
  game.dex.set(c.genome.species, { name: c.genome.name, biome: c.genome.biome, hostile: c.hostile, ranged: c.ranged });
  game.handled.add(`${c.cx},${c.cy}`);
  creatures.delete(`${c.cx},${c.cy}`);
  const becamePet = !game.pet;
  if (becamePet) {
    game.pet = {
      x: game.px + 18, y: game.py + 12, homeX: game.px, homeY: game.py,
      vx: 0, vy: 0, genome: c.genome, hostile: false, ranged: false,
      rank: "normal", hp: 3, maxHp: 3, stun: 0, facing: 1,
      moving: false, phase: hashUnit(c.cx, c.cy, game.seed + 181), attackTimer: 0,
      invuln: 0, downTimer: 0
    };
    toast(`${c.genome.name}이 펫으로 따라온다`, "good");
  }
  const dropText = grantInteractionReward(c.hostile ? "hostile" : "peaceful", c.cx, c.cy);
  spendTool();
  const beforeMilestone = game.milestone;
  grantCreatureReward(c, first);
  if (first) {
    game.hp = Math.min(game.maxHp, game.hp + 1);
    if (game.tool) game.tool.durability = Math.min(game.tool.maxDurability, game.tool.durability + 1);
  }
  const reward = c.hostile ? (first ? 3 : 2) : (first ? 2 : 1);
  const milestoneText = game.milestone > beforeMilestone
    ? " · 포획 보너스! 장비 공간과 설계 길이 한도가 늘었다"
    : "";
  toast(c.hostile
    ? `적대 크리처 포획 · ${c.genome.name} · 잉크 +${reward}${dropText}${milestoneText}`
    : `온순한 크리처 길들이기 · ${c.genome.name} · 잉크 +${reward}${dropText}`, "good");
  rewardNotice(`잉크 +${reward}${becamePet ? " · 동행 펫 합류" : ""}`);
  saveNow();
}

function creatureKey(c) {
  return c.rank === "normal" ? `${c.cx},${c.cy}` : `boss:${c.bossIndex}`;
}

function defeatCreature(c) {
  const key = creatureKey(c);
  game.handled.add(key);
  creatures.delete(key);
  if (c.rank !== "normal") game.bossStates.delete(c.bossIndex);
  smokeEffects.push({ x: c.x, y: c.y, time: c.rank === "normal" ? 1.1 : 2.1, duration: c.rank === "normal" ? 1.1 : 2.1, count: c.rank === "normal" ? 8 : 22, big: c.rank !== "normal" });
  game.defeats += 1;
  game.dex.set(c.genome.species, {
    name: c.genome.name, biome: c.genome.biome, hostile: true, ranged: c.ranged,
    defeated: true, rank: c.rank
  });

  const isFieldBoss = c.rank === "fieldboss";
  const isBoss = c.rank !== "normal";
  const fragmentReward = isFieldBoss ? 6 : isBoss ? 3 : 0;
  const essenceReward = isFieldBoss ? 12 : isBoss ? 6 : 2;
  const inkReward = isFieldBoss ? 16 : isBoss ? 8 : 2;
  const randomDrop = isBoss ? "" : grantInteractionReward("hostile", c.cx, c.cy);
  const beforeTier = game.frontierTier;
  game.fragments += fragmentReward;
  game.frontierTier = tierForFragments(game.fragments);
  game.inventory.essence += essenceReward;
  game.ink += inkReward;
  if (isBoss) {
    game.bossesDefeated += 1;
    game.maxGear += 1;
  }
  if (beforeTier < 5 && game.frontierTier >= 5) game.inventory.mirrorInk += 2;
  const rankLabel = isFieldBoss ? "영역 지배자" : isBoss ? "지역 우두머리" : "적대 크리처";
  const unlock = game.frontierTier > beforeTier ? ` · ${PROGRESSION_TIERS[game.frontierTier - 1].name} 사용 가능` : "";
  toast(`${rankLabel} 처치 · ${c.genome.name} · 보상을 얻었다${isBoss ? " · 장비 공간 확장" : ""}${randomDrop}${unlock}`, "good");
  rewardNotice(`생체 결정과 잉크를 얻었다${fragmentReward ? " · 기술 조각 발견" : ""}`);
  if (game.frontierTier > beforeTier) {
    const tier = PROGRESSION_TIERS[game.frontierTier - 1];
    celebrate(`새 기술: ${tier.name}`, tier.description);
  }
  saveNow();
}

function persistBossState(c) {
  if (c.rank === "normal") return;
  game.bossStates.set(c.bossIndex, {
    hp: c.hp,
    parts: c.bossParts.map(part => ({ ...part })),
    weaknessExposed: c.weaknessExposed,
    disabledRewards: { ...c.disabledRewards }
  });
}

function attackBossPart(c, part) {
  const damage = Math.max(1, Math.round(1 + game.tool.stats.edge * 1.7 + game.tool.stats.reach * .7 + (game.tool.stats.impact ?? 0) * 1.4));
  part.hp = Math.max(0, part.hp - damage);
  c.hitFlash = .24;
  game.noise = clamp(game.noise + .3, 0, 1);
  spendTool();
  if (part.hp > 0) {
    persistBossState(c);
    saveNow();
    toast(`${part.label}에 타격 · 아직 버티고 있다`);
    return;
  }
  part.destroyed = true;
  part.active = false;
  smokeEffects.push({ x: c.x + part.ox, y: c.y + part.oy, time: 1, duration: 1, count: 10, big: false });
  const next = c.bossParts.find(candidate => !candidate.destroyed);
  if (part.id === "seal") {
    c.disabledRewards.chase = false;
    c.disabledRewards.home = false;
    c.disabledRewards.wander = false;
  } else if (part.id === "weapon") c.disabledRewards.shoot = true;
  else if (part.id === "legs") {
    c.disabledRewards.chase = true;
    c.disabledRewards.home = true;
    c.disabledRewards.wander = true;
    c.weaknessExposed = true;
  }
  if (part.id === "seal") c.disabledRewards.shoot = false;
  if (next) next.active = true;
  const directions = { north: "북쪽", east: "동쪽", south: "남쪽", west: "서쪽" };
  if (c.weaknessExposed) {
    celebrate("우두머리 완전 제압", `${directions[c.weaknessDirection]}에서만 약점을 공격할 수 있습니다`);
  } else {
    toast(`${part.label} 파괴 · ${next.label}이 드러났다`, "good");
  }
  dirty = true;
  persistBossState(c);
  saveNow();
}

function attackCreature(c) {
  if (!c.hostile) {
    toast(`온순한 크리처다 · ${binding("capture")}로 ${c.genome.name}을 길들이자`);
    return;
  }
  if (c.rank !== "normal") {
    const remaining = c.bossParts?.find(part => !part.destroyed);
    if (remaining) {
      toast(`${remaining.label}이 본체를 보호한다 · 빛나는 연결 부위를 노리자`, "bad");
      return;
    }
    if (!c.weaknessExposed) return;
    const dx = game.px - c.x, dy = game.py - c.y;
    if (!directionalWeaknessAllows(dx, dy, c.weaknessDirection)) {
      const directions = { north: "북쪽", east: "동쪽", south: "남쪽", west: "서쪽" };
      toast(`약점은 ${directions[c.weaknessDirection]}에서만 열린다`, "bad");
      return;
    }
  }
  const damage = attackDamage(game.tool.stats, c.weakness, c.rank);
  c.hp = Math.max(0, c.hp - damage);
  persistBossState(c);
  c.hitFlash = 0.24;
  game.noise = clamp(game.noise + .28, 0, 1);
  game.swing = 1;
  game.attackFlash = 0.22;
  spendTool();
  if (c.hp <= 0) {
    defeatCreature(c);
    return;
  }
  const weaknessText = c.weakness ? ` · 약점 ${WEAKNESS_LABELS[c.weakness]}` : "";
  const captureText = c.rank === "normal" && c.hp / c.maxHp <= 0.38 ? ` · ${binding("capture")}로 포획 가능` : "";
    toast(`${c.genome.name}에게 ${damage >= 4 ? "강한 타격" : "타격"}${weaknessText}${captureText}`, damage >= 4 ? "good" : "");
  dirty = true;
}

function captureNearbyCreature() {
  if (!game.tool) {
    toast(`포획에 쓸 손도구가 없다 · ${binding("draw")}로 포획력이 높은 도구를 그리자`, "bad");
    return;
  }
  game.noise = clamp(game.noise + .16, 0, 1);
  const creature = nearestCreature();
  if (!creature) {
    toast("포획하거나 길들일 크리처가 가까이 없다");
    return;
  }
  interactCreature(creature);
}

function useTool() {
  if (pickupNearbyDrop()) return;
  if (!game.tool) {
    toast(`손도구가 없다 · ${binding("draw")}로 필요한 성능의 도구를 그리자`, "bad");
    return;
  }
  game.swing = 1;

  const combatTarget = attackTarget();
  if (combatTarget) {
    if (combatTarget.kind === "bossPart") attackBossPart(combatTarget.creature, combatTarget.part);
    else attackCreature(combatTarget.creature);
    return;
  }

  const nearbyCreature = nearestCreature();
  if (nearbyCreature?.hostile) {
    toast(`공격 대상이 사거리나 방향 밖에 있다 — 바라보고 ${binding("attack")}`, "bad");
    return;
  }

  const ob = nearestObstacle();
  if (ob) {
    const rule = OBSTACLE_RULE[ob.kind];
    const have = game.tool.stats[rule.stat];
    if (have >= rule.threshold) {
      game.cleared.add(ob.key);
      game.noise = clamp(game.noise + .34, 0, 1);
      const dropText = grantInteractionReward(ob.kind, ob.x, ob.y);
      toast(`길을 열었다 — ${rule.label}${dropText}`, "good");
      spendTool();
      saveNow();
    } else {
      toast(`${rule.need}이 모자란다 — 더 강한 도구가 필요하다`, "bad");
    }
    dirty = true;
    return;
  }

  const c = nearbyCreature;
  if (c) {
    toast(`◇ ${c.genome.name} · ${binding("capture")}로 길들일 수 있다`);
    return;
  }

  toast("지금 도구에 반응하는 대상이 없다");
}

function checkLandmarks() {
  for (const m of game.marks) {
    if (game.found.has(m.index)) continue;
    const d = Math.hypot(m.tx * TILE + TILE / 2 - game.px, m.ty * TILE + TILE / 2 - game.py);
    if (d < 22) {
      if (!game.handled.has(`boss:${m.index}`)) {
        if (el.toast.hidden) toast(`${m.name} 앞을 우두머리가 막고 있다 · 먼저 쓰러뜨리자`, "bad");
        continue;
      }
      game.found.add(m.index);
      game.hp = game.maxHp;
      for (const item of [game.tool, game.shoes, game.petTool]) {
        if (item) item.durability = item.maxDurability;
      }
      if (game.pet) game.pet.hp = game.pet.maxHp;
      revealEffect = { x: m.tx * TILE + TILE / 2, y: m.ty * TILE + TILE / 2, time: 3.4, duration: 3.4 };
      const nextRegion = REGION_THEMES[game.found.size];
      celebrate(`${m.name} 활성화`, nextRegion ? `${nextRegion.name} 지역이 지도에 공개되었습니다` : "모든 지역이 공개되었습니다");
      rewardNotice("체력·장착 장비 완전 회복");
      toast(`${m.name} 활성화 · 체력과 장착 장비 완전 회복`, "good");
      saveNow();
      if (game.found.size >= LANDMARK_COUNT) showWin();
    }
  }
}

// ---------------------------------------------------------------- 수집품

function dropInventoryItem(itemKey) {
  const def = ITEM_DEFS[itemKey];
  if (!def || (game.inventory[itemKey] ?? 0) <= 0) return false;
  game.inventory[itemKey] -= 1;
  const side = droppedItems.length % 2 === 0 ? 1 : -1;
  droppedItems.push({
    id: `${itemKey}-${game.time}-${droppedItems.length}`,
    itemKey,
    x: game.px + side * 13,
    y: game.py + 5,
    readyAt: game.time + 650,
    expiresAt: game.time + DROP_LIFETIME * 1000
  });
  saveNow();
  return true;
}

function updateDroppedItems() {
  const kept = [];
  for (const drop of droppedItems) {
    if (game.time >= drop.expiresAt) continue;
    const distance = Math.hypot(drop.x - game.px, drop.y - game.py);
    if (game.time >= drop.readyAt && distance < 9) {
      collectDroppedItem(drop);
      continue;
    }
    kept.push(drop);
  }
  droppedItems = kept;
}

function collectDroppedItem(drop) {
  if (drop.type === "gear") {
    const item = drop.item;
    if (item.slot === "pet") game.petTool = item;
    else {
      game.gear[item.slot].push(item);
      if (item.slot === "hand" && !game.tool) game.tool = item;
      if (item.slot === "shoes" && !game.shoes) game.shoes = item;
    }
    toast(`${item.name}을 되찾아 다시 장착했다`, "good");
    saveNow();
    return;
  }
  game.inventory[drop.itemKey] = (game.inventory[drop.itemKey] ?? 0) + 1;
  toast(`${ITEM_DEFS[drop.itemKey].name}을 다시 주웠다`, "good");
  saveNow();
}

function pickupNearbyDrop() {
  const index = droppedItems.findIndex(drop =>
    Math.hypot(drop.x - game.px, drop.y - game.py) < 18
  );
  if (index < 0) return false;
  const [drop] = droppedItems.splice(index, 1);
  collectDroppedItem(drop);
  return true;
}

function drawDroppedItems(camX, camY) {
  for (const drop of droppedItems) {
    const sx = Math.round(drop.x - camX);
    const sy = Math.round(drop.y - camY);
    const remaining = clamp((drop.expiresAt - game.time) / (drop.lifetimeMs ?? (DROP_LIFETIME * 1000)), 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fillRect(sx - 4, sy + 3, 8, 2);
    ctx.fillStyle = drop.type === "gear" ? (drop.item.color ?? "#ffd166") : ITEM_DEFS[drop.itemKey].color;
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    ctx.fillStyle = "#eef6ff";
    ctx.fillRect(sx - 1, sy - 2, 2, 2);
    ctx.fillStyle = "rgba(126,224,192,.85)";
    ctx.fillRect(sx - 5, sy + 6, Math.round(10 * remaining), 1);
  }
}

// ---------------------------------------------------------------- 그리기 모드

let strokes = [];
let current = null;
let drawing = false;

function openDraw(slot = "hand") {
  draftSlot = slot;
  strokes = [];
  current = null;
  drawing = false;
  deleteMode = false;
  hoverStroke = -1;
  mode = "draw";
  el.drawBox?.classList?.remove("crafting");
  el.drawLayer.hidden = false;
  el.toolPanel.classList.add("live");
  el.drawTitle.textContent = slot === "shoes" ? "탐사 신발 설계" : slot === "pet" ? "펫 도구 설계" : "손도구 설계";
  el.drawLegend.innerHTML = slot === "shoes"
    ? `<span><i class="k">길게</i> 달리기</span><span><i class="k">둥글게</i> 안정성</span><span><i class="k">촘촘히</i> 내구도</span><span><i class="k">적은 획</i> 잉크 절약</span>`
    : slot === "pet"
      ? `<span><i class="k">뾰족하게</i> 공격력</span><span><i class="k">길게</i> 지원거리</span><span><i class="k">닫아서</i> 생존력</span><span><i class="k">여러 획</i> 제압력</span>`
      : `<span><i class="k">뾰족하게</i> 파쇄력</span><span><i class="k">길게</i> 사거리</span><span><i class="k">닫아서</i> 부력</span><span><i class="k">여러 획</i> 포획력</span>`;
  updateDeleteButton();
  renderPad();
  updateHud();
}

function closeDraw() {
  deleteMode = false;
  hoverStroke = -1;
  mode = "play";
  el.drawLayer.hidden = true;
  el.toolPanel.classList.remove("live");
  el.drawBox?.classList?.remove("crafting");
  updateHud();
}

function updateDeleteButton() {
  if (!el.deleteButton) return;
  el.deleteButton.classList.toggle("active", deleteMode);
  el.deleteButton.textContent = deleteMode ? "그리기 모드" : "획 지우기";
  el.deleteButton.setAttribute?.("aria-pressed", String(deleteMode));
  pad.classList.toggle("delete-mode", deleteMode);
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function strokeAt(point) {
  let best = -1;
  let bestDistance = 11;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    for (let j = 1; j < stroke.length; j++) {
      const distance = pointToSegmentDistance(point, stroke[j - 1], stroke[j]);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function removeStrokeAt(point) {
  const index = strokeAt(point);
  if (index < 0) return false;
  strokes.splice(index, 1);
  hoverStroke = -1;
  renderPad();
  updateHud();
  return true;
}

function gearCost() {
  const strokeCount = strokes.filter(s => s.length >= 2).length;
  return craftingCost(strokeCount, game.frontierTier);
}

function confirmDraw() {
  if (mode !== "draw") return;
  const cost = gearCost();
  if (cost > game.ink) {
    toast("잉크가 부족하다 · 수집품을 더 찾아보자", "bad");
    return;
  }
  if (draftSlot !== "pet" && totalGear() >= game.maxGear) {
    toast(`장비 가방이 가득 찼다 · Tab에서 장비를 정리하자`, "bad");
    return;
  }
  const length = drawingLengthState(analyzeStrokes(strokes, PAD_W, PAD_H), game.milestone);
  if (length.exceeded) {
    toast("설계 길이 한도를 넘었다 · 획을 줄여 보자", "bad");
    return;
  }
  const gear = buildGear(strokes, draftSlot);
  if (!gear) {
    toast("획이 너무 짧아 — 조금 더 길게 그려 보자", "bad");
    return;
  }
  game.ink -= cost;
  if (draftSlot === "pet") game.petTool = gear;
  else {
    game.gear[draftSlot].push(gear);
    if (draftSlot === "shoes") game.shoes = gear;
    else game.tool = gear;
  }
  saveNow();
  mode = "crafting";
  craftingTimer = CRAFTING_DURATION;
  craftingItem = gear;
  el.drawLayer.hidden = true;
  el.toolPanel.classList.remove("live");
  updateHud();
}

function finishCrafting() {
  const equipped = craftingItem ?? (draftSlot === "pet" ? game.petTool : draftSlot === "shoes" ? game.shoes : game.tool);
  craftingItem = null;
  closeDraw();
  toast(`${equipped?.name ?? "도구"} 제작 및 장착 완료`, "good");
}

function padPoint(e) {
  const r = pad.getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) * (PAD_W / r.width), 0, PAD_W),
    y: clamp((e.clientY - r.top) * (PAD_H / r.height), 0, PAD_H)
  };
}

pad.addEventListener("pointerdown", e => {
  if (mode !== "draw") return;
  e.preventDefault();
  if (deleteMode) {
    removeStrokeAt(padPoint(e));
    return;
  }
  pad.setPointerCapture?.(e.pointerId);
  drawing = true;
  current = [padPoint(e)];
  strokes.push(current);
  renderPad();
  updateHud();
});

pad.addEventListener("pointermove", e => {
  if (mode !== "draw") return;
  e.preventDefault();
  if (deleteMode) {
    const nextHover = strokeAt(padPoint(e));
    if (nextHover !== hoverStroke) {
      hoverStroke = nextHover;
      renderPad();
    }
    return;
  }
  if (!drawing || !current) return;
  const p = padPoint(e);
  const tail = current[current.length - 1];
  const segment = Math.hypot(p.x - tail.x, p.y - tail.y);
  if (segment < 1.5) return;
  const length = drawingLengthState(analyzeStrokes(strokes, PAD_W, PAD_H), game.milestone);
  if (length.remaining <= 1) {
    drawing = false;
    toast(`${length.label} 설계 길이 여유를 모두 사용했다`);
    return;
  }
  if (segment > length.remaining) {
    const ratio = length.remaining / segment;
    current.push({ x: tail.x + (p.x - tail.x) * ratio, y: tail.y + (p.y - tail.y) * ratio });
    drawing = false;
    toast(`${length.label} 설계 길이 여유를 모두 사용했다`);
  } else current.push(p);
  renderPad();
  updateHud();
});

function endStroke() {
  if (!drawing) return;
  drawing = false;
  if (current && current.length < 2) strokes.pop();
  current = null;
  renderPad();
  updateHud();
}

pad.addEventListener("pointerup", endStroke);
pad.addEventListener("pointercancel", endStroke);
pad.addEventListener("pointerleave", endStroke);

function renderPad() {
  padCtx.clearRect(0, 0, PAD_W, PAD_H);

  // 모눈 — 크기 감각을 준다
  padCtx.strokeStyle = "rgba(120,150,190,0.16)";
  padCtx.lineWidth = 1;
  for (let x = 20; x < PAD_W; x += 20) {
    padCtx.beginPath();
    padCtx.moveTo(x + 0.5, 0);
    padCtx.lineTo(x + 0.5, PAD_H);
    padCtx.stroke();
  }
  for (let y = 20; y < PAD_H; y += 20) {
    padCtx.beginPath();
    padCtx.moveTo(0, y + 0.5);
    padCtx.lineTo(PAD_W, y + 0.5);
    padCtx.stroke();
  }

  padCtx.strokeStyle = "#1b2634";
  padCtx.lineWidth = 4;
  padCtx.lineCap = "round";
  padCtx.lineJoin = "round";
  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
    const s = strokes[strokeIndex];
    padCtx.strokeStyle = strokeIndex === hoverStroke ? "#d85b51" : "#1b2634";
    if (s.length < 2) {
      if (s.length === 1) {
        padCtx.fillStyle = "#1b2634";
        padCtx.fillRect(s[0].x - 2, s[0].y - 2, 4, 4);
      }
      continue;
    }
    padCtx.beginPath();
    padCtx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length; i++) padCtx.lineTo(s[i].x, s[i].y);
    padCtx.stroke();
  }
}

document.querySelectorAll(".draw-keys button").forEach(btn => {
  btn.addEventListener("click", () => {
    const act = btn.dataset.act;
    if (act === "confirm") confirmDraw();
    else if (act === "delete-toggle") {
      deleteMode = !deleteMode;
      current = null;
      drawing = false;
      hoverStroke = -1;
      updateDeleteButton();
      renderPad();
      updateHud();
    } else if (act === "clear") {
      strokes = [];
      current = null;
      hoverStroke = -1;
      renderPad();
      updateHud();
    }
    else closeDraw();
  });
});

// ---------------------------------------------------------------- HUD

const barRows = Array.from({ length: 4 }, () => {
  const row = document.createElement("div");
  row.className = "bar-row";
  row.innerHTML =
    `<span class="lbl"></span>` +
    `<span class="track"><i class="fill"></i>` +
    `<i class="tick"></i></span>` +
    `<span class="val">0</span>`;
  el.bars.appendChild(row);
  return { row, label: row.querySelector(".lbl"), fill: row.querySelector(".fill"), tick: row.querySelector(".tick"), val: row.querySelector(".val") };
});

function statsForHud() {
  if (mode === "draw") {
    const base = analyzeStrokes(strokes, PAD_W, PAD_H);
    if (draftSlot === "shoes") return shoeStatsFrom(base);
    if (draftSlot === "pet") return petToolStats(base);
    return handToolProfile(base).stats;
  }
  return game?.tool?.stats ?? null;
}

function updateHud() {
  if (!game) return;
  const stats = statsForHud();
  const defs = mode === "draw" && draftSlot === "shoes" ? SHOE_STAT_DEFS
    : mode === "draw" && draftSlot === "pet" ? PET_STAT_DEFS : HAND_STAT_DEFS;

  for (let i = 0; i < barRows.length; i++) {
    const b = barRows[i];
    const def = defs[i];
    const v = stats ? stats[def.key] : 0;
    b.label.textContent = def.label;
    b.fill.style.background = def.color;
    b.tick.style.left = `${(def.tick * 100).toFixed(1)}%`;
    b.fill.style.width = `${(v * 100).toFixed(1)}%`;
    b.val.textContent = v.toFixed(2);
    b.row.classList.toggle("met", v >= def.tick);
  }

  if (mode === "draw") {
    const base = analyzeStrokes(strokes, PAD_W, PAD_H);
    const length = drawingLengthState(base, game.milestone);
    const d = draftSlot === "shoes"
      ? Math.round(5 + shoeStatsFrom(base).endurance * 18) + game.found.size
      : base.durability;
    el.toolName.textContent = d > 0
      ? (draftSlot === "shoes" ? nameShoes(shoeStatsFrom(base))
        : draftSlot === "pet" ? `동행 ${nameTool(base, Math.round(base.spanPx))}`
          : `${handToolProfile(base).type.label} ${nameTool(base, Math.round(base.spanPx))}`)
      : "성능 계산 중";
    el.toolDura.textContent = d > 0 ? `사용 ${d}회` : "";
    el.toolDura.classList.remove("low");
    const strokeCount = strokes.filter(s => s.length >= 2).length;
    const cost = gearCost();
    const lengthCue = length.remaining <= length.budget * .12 ? "길이 여유 거의 없음"
      : length.remaining <= length.budget * .34 ? "길이 여유 보통" : "길이 여유 충분";
    const inkCue = cost > game.ink ? "잉크가 부족함" : "잉크 여유 있음";
    el.drawBudget.textContent = deleteMode
      ? "지울 획을 클릭하세요 · 설계 길이를 가볍게 조정합니다"
      : `설계 중 · ${lengthCue} · ${inkCue}`;
  } else if (game.tool) {
    el.toolName.textContent = game.tool.name;
    el.toolDura.textContent = `사용 ${game.tool.durability}/${game.tool.maxDurability}`;
    el.toolDura.classList.toggle("low", game.tool.durability <= 2);
    el.duraMeter.hidden = false;
    el.duraFill.style.width = `${(game.tool.durability / game.tool.maxDurability * 100).toFixed(1)}%`;
    el.duraFill.classList.toggle("low", game.tool.durability <= 2);
  } else {
    el.toolName.textContent = "도구 없음";
    el.toolDura.textContent = "Q — 설계";
    el.toolDura.classList.remove("low");
    el.duraMeter.hidden = true;
  }

  el.marks.textContent = game.found.size;
  el.catalog.textContent = game.dex.size;
  el.depth.textContent = game.depth;
  el.captures.textContent = game.captures;
  el.ink.textContent = game.ink;
  el.shoeName.textContent = game.shoes ? game.shoes.name : "기본 장화";
  el.hearts.innerHTML = Array.from({ length: game.maxHp }, (_, i) =>
    `<i class="heart ${i < game.hp ? "full" : "empty"}" aria-hidden="true">♥</i>`
  ).join("");
  el.hearts.setAttribute?.("aria-label", `체력 ${game.hp}/${game.maxHp}`);
  const frontier = nextTierProgress(game.fragments);
  el.resonance.textContent = FRONTIER_LABELS[frontier.tier] ?? "개척자";
  el.fragments.textContent = frontier.next ? "다음 기술 준비 중" : "모든 기술 완성";
  const env = currentEnvironment();
  const thermal = thermalState(game.temperature);
  el.envTime.textContent = env.period;
  el.envWeather.textContent = env.weather.name;
  el.envTemp.textContent = thermal.name;
  el.envNoise.textContent = noiseLabel(game.noise);
}

const MAP_COLORS = {
  [BIOME.DEEP]: "#123a55", [BIOME.WATER]: "#2f7fa8", [BIOME.SAND]: "#d9c48a",
  [BIOME.PLAIN]: "#9dbf62", [BIOME.GRASS]: "#6faa50", [BIOME.FOREST]: "#44804a",
  [BIOME.ROCK]: "#8d8f96"
};

function compassDirection(dx, dy) {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return "도착";
  const dirs = ["동", "남동", "남", "남서", "서", "북서", "북", "북동"];
  const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  return dirs[Math.round(angle / (Math.PI / 4)) % 8];
}

function updateMap() {
  const tx = Math.floor(game.px / TILE);
  const ty = Math.floor(game.py / TILE);
  const cols = 22;
  const rows = 16;
  const cell = 4;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = tx + x - Math.floor(cols / 2);
      const wy = ty + y - Math.floor(rows / 2);
      const locked = regionRequiredMarksAt(wx, wy) > game.found.size;
      mapCtx.fillStyle = MAP_COLORS[biomeAt(wx, wy, game.seed)] ?? "#9dbf62";
      mapCtx.fillRect(x * cell, y * cell, cell, cell);
      if (locked) {
        mapCtx.fillStyle = `rgba(20,31,43,${((x + y + Math.floor(game.time / 420)) % 3 === 0 ? .62 : .48)})`;
        mapCtx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  const target = game.marks
    .filter(m => !game.found.has(m.index))
    .sort((a, b) => Math.hypot(a.tx - tx, a.ty - ty) - Math.hypot(b.tx - tx, b.ty - ty))[0];

  if (target) {
    const rx = target.tx - tx;
    const ry = target.ty - ty;
    const mx = clamp(Math.floor(cols / 2) + rx, 1, cols - 2);
    const my = clamp(Math.floor(rows / 2) + ry, 1, rows - 2);
    mapCtx.fillStyle = "#ffd166";
    mapCtx.fillRect(mx * cell, my * cell, cell, cell);
    mapCtx.fillStyle = "#fff4bd";
    mapCtx.fillRect(mx * cell + 1, my * cell + 1, 2, 2);
    el.goalText.textContent = `${compassDirection(rx, ry)}쪽 · ${target.name}`;
  } else {
    el.goalText.textContent = "모든 신호기 활성화 완료 · 자유 탐사 중";
  }

  mapCtx.fillStyle = "#fff";
  mapCtx.fillRect(Math.floor(cols / 2) * cell + 1, Math.floor(rows / 2) * cell + 1, 2, 2);
  mapCtx.strokeStyle = "#172033";
  mapCtx.strokeRect(Math.floor(cols / 2) * cell, Math.floor(rows / 2) * cell, cell, cell);
  el.mapCoord.textContent = frontierRegionAt(tx, ty).name;
}

function updateHint() {
  if (mode !== "play") { el.hint.hidden = true; return; }

  const nearbyCreature = nearestCreature();
  if (nearbyCreature?.hostile) {
    const c = nearbyCreature;
    const rank = c.rank === "fieldboss" ? "◆ 영역 지배자" : c.rank === "midboss" ? "◆ 지역 우두머리" : "⚠ 적대 크리처";
    const activePart = c.bossParts?.find(part => part.active && !part.destroyed);
    const directions = { north: "북쪽", east: "동쪽", south: "남쪽", west: "서쪽" };
    const weakness = c.weakness && (c.rank === "normal" || c.weaknessExposed)
      ? ` · ${c.weaknessExposed ? `${directions[c.weaknessDirection]} 전용 ` : ""}약점 <b>${WEAKNESS_LABELS[c.weakness]}</b>`
      : activePart ? ` · 파괴 대상 <b>${activePart.label}</b>` : "";
    const capturable = c.rank === "normal" && c.hp / c.maxHp <= 0.38 ? ` · <b>${binding("capture")}</b> 포획 가능` : "";
    const disarmed = c.disarmed > 0 ? " · <b>무장해제 중</b>" : "";
    el.hint.innerHTML = `${rank} ${c.genome.name}${weakness}${disarmed} — <b>${binding("attack")}</b> 공격 · <b>${binding("parry")}</b> 패링${capturable}`;
    el.hint.hidden = false;
    return;
  }

  const ob = nearestObstacle();
  if (ob) {
    const rule = OBSTACLE_RULE[ob.kind];
    const have = game.tool ? game.tool.stats[rule.stat] : 0;
    const ok = have >= rule.threshold;
    el.hint.innerHTML = ok
      ? `${rule.label} — <b>${binding("attack")}</b>로 길 열기`
      : `${rule.label} — ${rule.need} <b>도구 성능이 더 필요하다</b>`;
    el.hint.hidden = false;
    return;
  }

  const c = nearbyCreature;
  if (c) {
    const need = catchThreshold(c.genome);
    const have = game.tool ? game.tool.stats.grip : 0;
    el.hint.innerHTML = have >= need
      ? `◇ 온순한 크리처 ${c.genome.name} · <b>${binding("capture")}</b>로 길들이기`
      : `◇ 온순한 크리처 ${c.genome.name} · <b>포획력이 더 필요하다</b>`;
    el.hint.hidden = false;
    return;
  }

  if (!canFloat() && nearWater()) {
    el.hint.innerHTML = "깊은 물 · 부력형 손도구가 필요하다";
    el.hint.hidden = false;
    return;
  }
  const thermal = thermalState(game.temperature);
  if (thermal.key !== "comfortable") {
    el.hint.innerHTML = `${thermal.name} 상태 · 이동 속도 감소${game.running ? " · 달리기로 체온 조절 중" : ""}`;
    el.hint.hidden = false;
    return;
  }
  el.hint.hidden = true;
}

function nearWater() {
  const tx = Math.floor(game.px / TILE);
  const ty = Math.floor(game.py / TILE);
  for (let y = ty - 1; y <= ty + 1; y++) {
    for (let x = tx - 1; x <= tx + 1; x++) {
      if (biomeAt(x, y, game.seed) === "water") return true;
    }
  }
  return false;
}

function toast(text, kind = "") {
  el.toast.textContent = text;
  el.toast.className = `toast ${kind}`;
  el.toast.hidden = false;
  toastTimer = 2.2;
}

function currentEnvironment() {
  const biome = biomeAt(Math.floor(game.px / TILE), Math.floor(game.py / TILE), game.seed);
  return environmentAt(game.seed, game.travelDistance, biome);
}

function gradeInGameUi(env) {
  const grade = {
    clear: [45, 82], wind: [182, 50], rain: [210, 54], fog: [174, 30], heat: [30, 74]
  }[env.weather.key] ?? [45, 72];
  const daylight = clamp(env.daylight, 0, 1);
  const light = Math.round(88 + daylight * 10);
  const alpha = (.79 + daylight * .13).toFixed(3);
  const stage = el.stage;
  if (!stage?.style?.setProperty) return;
  stage.dataset.uiGrade = env.period;
  stage.style.setProperty("--hud-panel", `hsla(${grade[0]}, ${grade[1]}%, ${light}%, ${alpha})`);
  stage.style.setProperty("--hud-stroke", daylight < .28 ? "#526a87" : "#44556d");
  stage.style.setProperty("--hud-ink", daylight < .28 ? "#26384f" : "#243044");
  stage.style.setProperty("--hud-dim", daylight < .28 ? "#5e7189" : "#667085");
  stage.style.setProperty("--hud-shadow", daylight < .28 ? "rgba(7,19,39,.30)" : "rgba(51,65,92,.20)");
}

function celebrate(title, subtitle = "") {
  el.celebration.innerHTML = `<b>${title}</b>${subtitle ? `<span>${subtitle}</span>` : ""}`;
  el.celebration.hidden = false;
  celebrationTimer = 3.2;
}

function rewardNotice(text) {
  rewardNotices.unshift({ text, time: 3.4 });
  rewardNotices = rewardNotices.slice(0, 4);
  el.rewardFeed.hidden = false;
  el.rewardFeed.innerHTML = rewardNotices.map(n => `<div class="reward-chip">+ ${n.text}</div>`).join("");
}

function clearPresentationEffects() {
  revealEffect = null;
  successEffects = [];
  craftingTimer = 0;
  craftingItem = null;
  celebrationTimer = 0;
  rewardNotices = [];
  el.celebration.hidden = true;
  el.rewardFeed.hidden = true;
  el.celebration.innerHTML = "";
  el.rewardFeed.innerHTML = "";
  lastWeatherSlot = null;
  lastDayPeriod = null;
}

function successEffect(x, y, kind) {
  successEffects.push({ x, y, kind, time: kind === "dodge" ? .42 : .58, duration: kind === "dodge" ? .42 : .58 });
  successEffects = successEffects.slice(-8);
}

function updateEnvironment(dt) {
  const env = currentEnvironment();
  gradeInGameUi(env);
  if (lastWeatherSlot === null) lastWeatherSlot = env.weatherSlot;
  else if (lastWeatherSlot !== env.weatherSlot) {
    lastWeatherSlot = env.weatherSlot;
    toast(`날씨 변화 · ${env.weather.name}`);
  }
  if (lastDayPeriod === null) lastDayPeriod = env.period;
  else if (lastDayPeriod !== env.period) {
    lastDayPeriod = env.period;
    toast(`${env.period}이 되었다 · 시야와 체온이 달라진다`);
  }
  const runningHeat = game.running ? 3 : 0;
  const nextTemperature = env.targetTemperature + runningHeat;
  game.temperature += (nextTemperature - game.temperature) * Math.min(1, dt * .45);
  game.noise = clamp(game.noise - dt * .11, 0, 1);

  for (const notice of rewardNotices) notice.time -= dt;
  rewardNotices = rewardNotices.filter(n => n.time > 0);
  el.rewardFeed.hidden = rewardNotices.length === 0;
  if (rewardNotices.length) el.rewardFeed.innerHTML = rewardNotices.map(n => `<div class="reward-chip">+ ${n.text}</div>`).join("");

  if (celebrationTimer > 0) {
    celebrationTimer -= dt;
    if (celebrationTimer <= 0) el.celebration.hidden = true;
  }
}

// ---------------------------------------------------------------- 화면

function binding(action) {
  return keyLabel(preferences.keymap[action] ?? DEFAULT_KEYMAP[action]);
}

function updateControlLabels() {
  if (!el.paletteKey) return;
  el.paletteKey.innerHTML = `<kbd>${binding("attack")}</kbd> 공격 · <kbd>${binding("parry")}</kbd> 패링 · <kbd>${binding("dodge")}</kbd> 전방 대시 · <kbd>${binding("lockOn")}</kbd> 조준 락온 · <kbd>${binding("capture")}</kbd> 포획 · <kbd>${binding("challenges")}</kbd> 도전 · <kbd>${binding("map")}</kbd> 지도`;
}

function settingsKeysHtml() {
  return KEY_ACTIONS.map(action => `
    <div class="setting-key-row">
      <span>${action.label}</span>
      <button data-act="rebind" data-key-action="${action.id}" class="${rebindingAction === action.id ? "listening" : "ghost"}">${rebindingAction === action.id ? "새 키 입력…" : `<kbd>${binding(action.id)}</kbd>`}</button>
    </div>`).join("");
}

function showSettings(returnTo = settingsReturn) {
  settingsReturn = returnTo;
  mode = "settings";
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div class="settings-wrap">
      <div class="palette-heading"><div><h1>환경설정</h1><p class="sub">조작과 화면 움직임을 플레이 방식에 맞게 조정합니다.</p></div><button class="ghost compact-close" data-act="settings-return">돌아가기 <kbd>Esc</kbd></button></div>
      <div class="settings-layout">
        <section class="settings-section">
          <h2>키 설정 <span>키가 겹치면 기존 키와 서로 교환됩니다.</span></h2>
          <div class="settings-key-list">${settingsKeysHtml()}</div>
          <button class="ghost" data-act="reset-keys">기본 키로 되돌리기</button>
        </section>
        <section class="settings-section settings-options">
          <h2>최적화</h2>
          <div class="setting-option"><div><b>제한된 애니메이션</b><span>카메라 흔들림과 장식 애니메이션을 줄입니다.</span></div><button data-act="toggle-animation">${preferences.animation === "limited" ? "켜짐" : "꺼짐"}</button></div>
          <div class="cache-box"><b>원정 저장 캐시</b><p>현재 저장된 원정만 삭제하며 키 설정은 유지합니다.</p><button class="danger" data-act="reset-cache">캐시 초기화</button></div>
        </section>
      </div>
    </div>`;
}

function showTitle() {
  mode = "title";
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  el.overlay.hidden = false;
  el.toolPanel.hidden = true;
  el.progress.hidden = true;
  el.vitals.hidden = true;
  el.mapPanel.hidden = true;
  el.hint.hidden = true;
  el.overlay.innerHTML = `
    <div class="title-card">
      <h1 class="crayon-title" aria-label="Drawn Frontier"><span>Drawn</span> <span>Frontier</span></h1>
      <p class="title-challenge">그림으로 <b>도구</b>를 만들고 <b>개척</b>하기! ✨</p>
      <p class="mission">화면에 그은 획의 길이, 꺾인 각도, 감싼 넓이, 갈래의 수가 그대로 장비의 성능이 되는 절차 생성 도트 탐험 게임.<br><b>일정 크기의 랜덤 맵을 모두 개척하는 것이 목표!</b></p>
      <div class="row">
        <button data-act="new">새 원정</button>
        ${hasSave ? `<button class="ghost" data-act="continue">원정 계속</button>` : ""}
        <button class="ghost" data-act="settings">환경설정</button>
      </div>
      <p class="keys">
        <b>${binding("up")}${binding("left")}${binding("down")}${binding("right")}</b> 이동 · <b>${binding("sprint")}</b> 달리기 · <b>${binding("dodge")}</b> 회피 · <b>${binding("inventory")}</b> 장비 가방 · <b>${binding("challenges")}</b> 도전과제 · <b>${binding("map")}</b> 지도 · <b>${binding("attack")}</b> 방향 공격·사용 · <b>${binding("parry")}</b> 짧은 패링 · <b>${binding("capture")}</b> 포획·길들이기 · <b>${binding("dex")}</b> 크리처 도감<br>
        해금 기술: <b>${binding("jump")}</b> 점프 · <b>${binding("wire")}</b> 와이어 · <b>${binding("reflector")}</b> 반사 방벽 · <b>${binding("lockOn")}</b> 조준 방향 고정<br>
        회피: <b>${binding("dodge")}</b> 바라보는 방향으로 대시 · 락온 중에도 이동은 자유<br>
        손도구: 파쇄력·사거리·부력·포획력 · 신발: 달리기·안정성·내구도
      </p>
    </div>`;
}

function showWin() {
  mode = "win";
  save();
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div>
      <h1>모든 신호기를 활성화했다</h1>
      <p class="sub">모든 신호기와 크리처 기록을 완성했습니다</p>
      <p class="mission">다섯 지역이 모두 지도에 연결되었습니다.<br>이후에도 세계를 계속 탐사하고 새로운 크리처와 장비를 발견할 수 있습니다.</p>
      <div class="row">
        <button data-act="new">다른 시드로 출발</button>
        <button class="ghost" data-act="keep">계속 탐사하기</button>
      </div>
    </div>`;
}

function showDex() {
  mode = "dex";
  const entries = [...game.dex.values()];
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div>
      <h1>크리처 도감</h1>
      <p class="sub">발견한 크리처 기록</p>
      ${entries.length
        ? `<div class="dex">${entries.map(e =>
            `<div class="dex-entry"><div class="nm">${e.hostile ? "⚠ " : "◇ "}${e.name}</div><div class="bi">${e.rank === "fieldboss" ? "영역 지배자 처치" : e.rank === "midboss" ? "지역 우두머리 처치" : e.defeated ? "적대 크리처 처치" : e.ranged ? "원거리 크리처 포획" : e.hostile ? "적대 크리처 포획" : "온순한 크리처 길들임"} · ${e.biome}</div></div>`
          ).join("")}</div>`
        : `<p class="dex-empty">아직 발견한 크리처가 없습니다. 포획력이 높은 도구를 만들고 가까이 다가가 보세요.</p>`}
      <div class="row"><button data-act="keep">원정으로 돌아가기 <kbd>Esc</kbd></button></div>
    </div>`;
}

function showWorldMap() {
  mode = "map";
  const playerTx = Math.floor(game.px / TILE);
  const playerTy = Math.floor(game.py / TILE);
  const currentRegion = frontierRegionAt(playerTx, playerTy);
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div class="world-map-wrap">
      <h1>세계 지도</h1>
      <p class="sub">${currentRegion.name} · 신호기와 지형을 확인하세요</p>
      <canvas id="world-map" width="256" height="176" aria-label="세계 지도"></canvas>
      <div class="row"><button class="ghost" data-act="keep">지도 닫기 <kbd>${binding("map")}</kbd></button></div>
    </div>`;

  const worldMap = document.getElementById("world-map");
  const worldCtx = worldMap.getContext("2d");
  worldCtx.imageSmoothingEnabled = false;
  const cell = 4;
  const cols = worldMap.width / cell;
  const rows = worldMap.height / cell;
  const tx = playerTx;
  const ty = playerTy;
  const left = tx - Math.floor(cols / 2);
  const top = ty - Math.floor(rows / 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = left + x;
      const wy = top + y;
      const locked = regionRequiredMarksAt(wx, wy) > game.found.size;
      worldCtx.fillStyle = MAP_COLORS[biomeAt(wx, wy, game.seed)] ?? "#9dbf62";
      worldCtx.fillRect(x * cell, y * cell, cell, cell);
      if (locked) {
        worldCtx.fillStyle = (x + y + Math.floor(game.time / 500)) % 3 === 0 ? "rgba(20,32,44,.65)" : "rgba(13,23,33,.48)";
        worldCtx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  for (const mark of game.marks) {
    if (regionRequiredMarksAt(mark.tx, mark.ty) > game.found.size) continue;
    const mx = mark.tx - left;
    const my = mark.ty - top;
    if (mx < 0 || my < 0 || mx >= cols || my >= rows) continue;
    worldCtx.fillStyle = game.found.has(mark.index) ? "#7ee0c0" : "#ffd166";
    worldCtx.fillRect(mx * cell - 1, my * cell - 1, cell + 2, cell + 2);
  }
  for (const boss of game.bosses) {
    if (game.handled.has(`boss:${boss.index}`)) continue;
    if (regionRequiredMarksAt(boss.tx, boss.ty) > game.found.size) continue;
    const bx = boss.tx - left;
    const by = boss.ty - top;
    if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
    worldCtx.fillStyle = boss.rank === "fieldboss" ? "#ff4f68" : "#d98cff";
    worldCtx.fillRect(bx * cell - 2, by * cell - 2, cell + 4, cell + 4);
  }
  for (const village of game.villages) {
    if (village.requiredMarks > game.found.size) continue;
    const vx = village.tx - left, vy = village.ty - top;
    if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue;
    worldCtx.fillStyle = "#fff0a8";
    worldCtx.fillRect(vx * cell - 1, vy * cell - 1, cell + 2, cell + 2);
    worldCtx.fillStyle = "#7ee0c0";
    worldCtx.fillRect(vx * cell, vy * cell, 2, 2);
  }
  worldCtx.fillStyle = "#fff";
  worldCtx.fillRect(Math.floor(cols / 2) * cell - 1, Math.floor(rows / 2) * cell - 1, 6, 6);
  worldCtx.strokeStyle = "#172033";
  worldCtx.strokeRect(Math.floor(cols / 2) * cell - 2, Math.floor(rows / 2) * cell - 2, 8, 8);
}

function gearStatText(item) {
  const length = item.lengthBudget ?? drawingLengthState(item.rawStats ?? item.stats, item.createdMilestone ?? 0);
  const budgetText = `설계 길이 ${Math.round(length.used)}/${length.budget}px`;
  if (item.slot === "shoes") {
    const s = item.shoeStats ?? shoeStatsFrom(item.stats);
    return `달리기 ${Math.round(s.speed * 100)} · 안정성 ${Math.round(s.stability * 100)} · ${budgetText} · 내구도 ${item.durability}/${item.maxDurability}`;
  }
  if (item.slot === "pet") {
    const s = item.petStats ?? petToolStats(item.rawStats ?? item.stats);
    return `공격 ${Math.round(s.power * 100)} · 지원거리 ${Math.round(s.range * 100)} · 생존 ${Math.round(s.guard * 100)} · 제압 ${Math.round(s.control * 100)} · ${budgetText}`;
  }
  return `${item.toolType?.label ?? "손도구"} · 파쇄 ${Math.round(item.stats.edge * 100)} · 사거리 ${Math.round(item.stats.reach * 100)} · 부력 ${Math.round(item.stats.buoy * 100)} · 포획 ${Math.round(item.stats.grip * 100)} · 충격 ${Math.round((item.stats.impact ?? 0) * 100)} · 방어 ${Math.round((item.stats.guard ?? 0) * 100)} · ${budgetText}`;
}

function gearCards(slot) {
  const active = slot === "hand" ? game.tool : game.shoes;
  if (game.gear[slot].length === 0) return `<p class="gear-empty">아직 만든 장비가 없다.</p>`;
  return `<div class="gear-list">${game.gear[slot].map(item => `
    <div class="gear-card ${active?.id === item.id ? "equipped" : ""}">
      <div class="gear-name">${active?.id === item.id ? "● " : ""}${item.name}</div>
      <div class="gear-stat">${gearStatText(item)}</div>
      <div class="gear-actions">
        <button data-act="equip" data-slot="${slot}" data-id="${item.id}">장착</button>
        <button class="drop" data-act="drop" data-slot="${slot}" data-id="${item.id}">분해</button>
      </div>
    </div>`).join("")}</div>`;
}

function inventoryCards() {
  const visible = Object.entries(ITEM_DEFS)
    .filter(([key]) => key !== "mirrorInk" || progressionEffects(game.frontierTier).reflector || game.inventory[key] > 0);
  return visible.map(([key, def]) => `
    <div class="item-card">
      <i style="background:${def.color}"></i>
      <span>${def.name}</span>
      <b>${game.inventory[key] ?? 0}</b>
      <button class="drop" data-act="drop-item" data-item="${key}" ${(game.inventory[key] ?? 0) <= 0 ? "disabled" : ""}>1개 버리기</button>
    </div>`).join("");
}

function rotatingTipHtml() {
  const index = Math.floor((game?.time ?? 0) / TIP_ROTATION_MS) % ROTATING_TIPS.length;
  return `<div class="rotating-tip"><b>TIP</b><span id="rotating-tip">${ROTATING_TIPS[index]}</span></div>`;
}

function updateRotatingTip() {
  const tip = document.getElementById("rotating-tip");
  if (!tip || !game) return;
  tip.textContent = ROTATING_TIPS[Math.floor(game.time / TIP_ROTATION_MS) % ROTATING_TIPS.length];
}

function showChallenges() {
  mode = "challenges";
  const state = challengeState(game);
  const next = nextChallenge(state);
  const completed = challengeRows(state).filter(row => row.completed);
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div class="challenge-wrap">
      <h1>도전과제</h1>
      <p class="sub">한 번에 바로 다음 목표만 안내합니다. 완료 기록은 아래에서 언제든 확인할 수 있습니다.</p>
      <table class="challenge-table">
        <thead><tr><th>다음 도전과제</th><th>진행</th><th>해금 보상</th></tr></thead>
      <tbody>${next ? `<tr><td><b>${next.title}</b></td><td>진행 중</td><td>${next.reward}</td></tr>` : `<tr><td colspan="3"><b>모든 핵심 도전과제 완료</b> · 자유 탐사 중</td></tr>`}</tbody>
      </table>
      <details class="completed-challenges" ${completed.length ? "" : "open"}>
        <summary>해금 완료 목록</summary>
        ${completed.length ? `<ul>${completed.map(row => `<li><span>${row.title}</span><b>${row.reward}</b></li>`).join("")}</ul>` : `<p>아직 완료한 도전과제가 없습니다.</p>`}
      </details>
      ${rotatingTipHtml()}
      <div class="row"><button class="ghost" data-act="keep">돌아가기 <kbd>${binding("challenges")}</kbd></button></div>
    </div>`;
}

function showPalette(page = palettePage) {
  if (page === "settings") {
    palettePage = "settings";
    showSettings("palette");
    return;
  }
  palettePage = ["gear", "items", "companion"].includes(page) ? page : "gear";
  mode = "palette";
  const next = CAPTURE_MILESTONES[game.milestone];
  const frontier = nextTierProgress(game.fragments);
  const activeUnlock = frontier.tier > 0 ? PROGRESSION_TIERS[frontier.tier - 1] : null;
  const gearPage = `
    <div class="ability-strip">
      <span class="ready"><kbd>${binding("map")}</kbd> 확장 지도</span>
      <span class="ready"><kbd>${binding("parry")}</kbd> 짧은 패링</span>
      <span class="ready"><kbd>${binding("dodge")}</kbd> 회피 · 약점 와이어</span>
      <span class="ready"><kbd>${binding("lockOn")}</kbd> 가까운 상대 락온</span>
      <span class="${progressionEffects(game.frontierTier).jump ? "ready" : "locked"}"><kbd>${binding("jump")}</kbd> 점프 · 해금 기술</span>
      <span class="${progressionEffects(game.frontierTier).wire ? "ready" : "locked"}"><kbd>${binding("wire")}</kbd> 와이어 · 해금 기술</span>
      <span class="${progressionEffects(game.frontierTier).reflector ? "ready" : "locked"}"><kbd>${binding("reflector")}</kbd> 반사 방벽 · 해금 기술</span>
    </div>
    <div class="gear-sections">
      <section class="gear-section">
        <h2>손도구 <span>전투·채집·포획</span></h2>
        ${gearCards("hand")}
        <button data-act="draw-gear" data-slot="hand">+ 손도구 그리기</button>
      </section>
      <section class="gear-section">
        <h2>신발 <span>이동·안정성·내구도</span></h2>
        ${gearCards("shoes")}
        <button data-act="draw-gear" data-slot="shoes">+ 신발 그리기</button>
      </section>
    </div>`;
  const itemsPage = `
    <section class="inventory-section page-section">
      <h2>수집품 <span>버린 물건은 10초 동안 월드에 남습니다.</span></h2>
      <div class="item-list">${inventoryCards()}</div>
    </section>
    <div class="milestone-strip page-section">
      <p><b>탐사 등급 ${frontier.tier}${activeUnlock ? ` · ${activeUnlock.name}` : ""}</b>${activeUnlock ? ` — ${activeUnlock.description}` : ""}</p>
      <p>${frontier.next ? `기술 조각 <b>${frontier.remaining}개</b>를 더 모으면 ${frontier.next.name} 사용 가능` : `<b>모든 탐사 기술 사용 가능</b>`}</p>
      <p>${next ? `적대 크리처 <b>${next - game.captures}마리</b> 추가 포획 → 장비칸 +1 · 잉크 +4` : `<b>모든 포획 보너스 획득</b>`}</p>
    </div>`;
  const companionPage = `
    <section class="gear-section pet-section page-section">
      <h2>동행 펫 <span>${game.pet ? `${game.pet.genome.name} · 체력 ${Math.ceil(game.pet.hp)}/${game.pet.maxHp}${game.pet.downTimer > 0 ? ` · 복귀 ${game.pet.downTimer.toFixed(1)}초` : ""}` : "포획한 크리처 1마리를 동행"}</span></h2>
      ${game.pet ? `<div class="gear-card equipped"><div class="gear-name">● ${game.pet.genome.name}</div><div class="gear-stat">주변을 자유롭게 따라다니며 적을 함께 공격합니다.</div></div>${game.petTool ? `<div class="gear-card"><div class="gear-name">${game.petTool.name}</div><div class="gear-stat">${gearStatText(game.petTool)} · 사용 ${game.petTool.durability}/${game.petTool.maxDurability}</div></div>` : ""}<div class="pet-actions"><button data-act="draw-gear" data-slot="pet">${game.petTool ? "펫 도구 다시 그리기" : "+ 펫 도구 그리기"}</button><button class="danger" data-act="release-pet">펫 방생</button></div>` : `<p class="gear-empty">크리처를 포획하면 첫 포획종이 이곳에 합류합니다.${game.petTool ? `<br>보관 중인 펫 도구: <b>${game.petTool.name}</b>` : ""}</p>`}
    </section>`;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div class="palette-wrap">
      <div class="palette-heading"><div><h1>장비 가방</h1><p class="sub">장비, 수집품, 동행 정보를 페이지별로 확인합니다.${game.pet ? " 펫 방생은 동행 페이지에서 할 수 있습니다." : ""}</p></div><button class="ghost compact-close" data-act="keep">닫기 <kbd>${binding("inventory")}</kbd></button></div>
      <div class="palette-summary">
        <span>잉크 <b>${game.ink}</b></span><span>기술 조각 <b>${game.fragments}</b></span>
        <span>탐사 등급 <b>${frontier.tier}/${PROGRESSION_TIERS.length}</b></span><span>장비 <b>${totalGear()}/${game.maxGear}</b></span>
      </div>
      <nav class="palette-tabs" aria-label="가방 페이지">
        <button class="${palettePage === "gear" ? "active" : ""}" data-act="palette-page" data-page="gear">장비</button>
        <button class="${palettePage === "items" ? "active" : ""}" data-act="palette-page" data-page="items">수집품</button>
        <button class="${palettePage === "companion" ? "active" : ""}" data-act="palette-page" data-page="companion">동행</button>
        <button data-act="palette-page" data-page="settings">설정</button>
      </nav>
      <div class="palette-page">
        ${palettePage === "gear" ? gearPage : palettePage === "items" ? itemsPage : companionPage}
      </div>
      ${rotatingTipHtml()}
    </div>`;
}

function hideOverlay() {
  el.overlay.hidden = true;
  el.overlay.innerHTML = "";
  el.toolPanel.hidden = false;
  el.progress.hidden = false;
  el.vitals.hidden = false;
  el.mapPanel.hidden = false;
  mode = "play";
  updateHud();
}

el.overlay.addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === "settings") {
    showSettings("title");
    return;
  }
  if (act === "settings-return") {
    rebindingAction = null;
    if (settingsReturn === "title") showTitle();
    else showPalette("gear");
    return;
  }
  if (act === "rebind") {
    rebindingAction = btn.dataset.keyAction;
    showSettings(settingsReturn);
    return;
  }
  if (act === "reset-keys") {
    preferences = { ...preferences, keymap: { ...DEFAULT_KEYMAP } };
    rebindingAction = null;
    savePreferences();
    showSettings(settingsReturn);
    return;
  }
  if (act === "toggle-animation") {
    preferences = { ...preferences, animation: preferences.animation === "limited" ? "full" : "limited" };
    savePreferences();
    showSettings(settingsReturn);
    return;
  }
  if (act === "reset-cache") {
    mode = "cache-confirm";
    el.overlay.innerHTML = `<div class="death-dialog"><h1>원정 저장을 초기화할까요?</h1><p class="sub">현재 원정, 장비, 도감 진행이 삭제됩니다.<br>키 설정과 애니메이션 설정은 유지됩니다.</p><div class="row"><button class="danger" data-act="confirm-reset-cache">초기화</button><button class="ghost" data-act="cancel-reset-cache">취소</button></div></div>`;
    return;
  }
  if (act === "confirm-reset-cache") {
    localStorage.removeItem(SAVE_KEY);
    game = newGame((Math.random() * 2 ** 31) >>> 0);
    creatures.clear();
    projectiles = [];
    rebindingAction = null;
    showTitle();
    return;
  }
  if (act === "cancel-reset-cache") {
    showSettings(settingsReturn);
    return;
  }
  if (act === "palette-page") {
    showPalette(btn.dataset.page);
    return;
  }
  if (act === "draw-gear") {
    el.overlay.hidden = true;
    el.overlay.innerHTML = "";
    openDraw(["hand", "shoes", "pet"].includes(btn.dataset.slot) ? btn.dataset.slot : "hand");
    return;
  }
  if (act === "respawn") {
    respawnPlayer();
    return;
  }
  if (act === "reset-expedition") {
    resetExpeditionAfterDeath();
    return;
  }
  if (act === "release-pet") {
    mode = "release-confirm";
    el.overlay.innerHTML = `<div class="death-dialog"><h1>펫을 방생할까요?</h1><p class="sub"><b>${game.pet?.genome.name ?? "동행 펫"}</b>은 자연으로 돌아가며 다시 포획하기 전까지 동행하지 않습니다.<br>그려 둔 펫 도구는 다음 펫을 위해 보관됩니다.</p><div class="row"><button class="danger" data-act="confirm-release-pet">방생하기</button><button class="ghost" data-act="cancel-release-pet">취소</button></div></div>`;
    return;
  }
  if (act === "confirm-release-pet") {
    const name = game.pet?.genome.name ?? "펫";
    game.pet = null;
    saveNow();
    showPalette();
    toast(`${name}을 자연으로 돌려보냈다`);
    return;
  }
  if (act === "cancel-release-pet") {
    showPalette();
    return;
  }
  if (act === "drop-item") {
    const itemKey = btn.dataset.item;
    if (dropInventoryItem(itemKey)) {
      hideOverlay();
      toast(`${ITEM_DEFS[itemKey].name}을 내려놓았다 · 잠시 동안 다시 주울 수 있다`);
    }
    return;
  }
  if (act === "equip") {
    const slot = btn.dataset.slot;
    const item = game.gear[slot]?.find(g => g.id === btn.dataset.id);
    if (item) {
      if (slot === "shoes") game.shoes = item;
      else game.tool = item;
      saveNow();
      showPalette();
    }
    return;
  }
  if (act === "drop") {
    const slot = btn.dataset.slot;
    const item = game.gear[slot]?.find(g => g.id === btn.dataset.id);
    if (item) {
      game.gear[slot] = game.gear[slot].filter(g => g.id !== item.id);
      if (slot === "shoes" && game.shoes?.id === item.id) game.shoes = null;
      if (slot === "hand" && game.tool?.id === item.id) game.tool = null;
      game.ink += Math.max(1, Math.floor((item.stats?.strokeCount ?? 1) / 2));
      saveNow();
      showPalette();
    }
    return;
  }

  if (act === "new") {
    game = newGame((Math.random() * 2 ** 31) >>> 0);
    creatures.clear();
    projectiles = [];
    droppedItems = [];
    deathDrops = [];
    villagers = [];
    smokeEffects = [];
    deathState = null;
    clearPresentationEffects();
    wireState = null;
    dirty = true;
    save();
    hideOverlay();
    toast(`첫 길을 살펴보고 ${binding("draw")}로 필요한 도구를 설계하자`);
  } else if (act === "continue") {
    game = loadSave() ?? newGame((Math.random() * 2 ** 31) >>> 0);
    creatures.clear();
    projectiles = [];
    droppedItems = [];
    deathDrops = [];
    villagers = [];
    smokeEffects = [];
    deathState = null;
    clearPresentationEffects();
    wireState = null;
    saveNow();
    hideOverlay();
  } else if (act === "keep") {
    hideOverlay();
  }
});

// ---------------------------------------------------------------- 입력

const MOVE_ACTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function moveVectorForCode(code) {
  return MOVE_ACTIONS[actionForCode(preferences.keymap, code)] ?? null;
}

function actionHeld(action) {
  return [...keys].some(code => actionForCode(preferences.keymap, code) === action);
}

window.addEventListener("keydown", e => {
  const action = actionForCode(preferences.keymap, e.code);
  if (action || ["Escape", "Enter", "Backspace"].includes(e.code)) e.preventDefault();

  if (mode === "settings") {
    if (rebindingAction) {
      if (e.code === "Escape") rebindingAction = null;
      else preferences = { ...preferences, keymap: rebindKey(preferences.keymap, rebindingAction, e.code) };
      rebindingAction = null;
      savePreferences();
      showSettings(settingsReturn);
    } else if (e.code === "Escape") {
      if (settingsReturn === "title") showTitle();
      else showPalette("gear");
    }
    return;
  }
  keys.add(e.code);
  if (e.repeat) return;

  if (mode === "crafting") {
    if (e.code === "Escape" || e.code === "Enter") finishCrafting();
    else if (action === "inventory") {
      finishCrafting();
      showPalette("gear");
    }
    return;
  }

  if (mode === "draw") {
    if (e.code === "Enter") confirmDraw();
    else if (e.code === "Escape") closeDraw();
    else if (e.code === "Backspace") {
      strokes = [];
      current = null;
      hoverStroke = -1;
      renderPad();
      updateHud();
    }
    return;
  }

  if (mode === "dex") {
    if (e.code === "Escape" || action === "dex") hideOverlay();
    return;
  }

  if (mode === "map") {
    if (e.code === "Escape" || action === "map") hideOverlay();
    return;
  }

  if (mode === "palette") {
    if (e.code === "Escape" || action === "inventory") hideOverlay();
    return;
  }

  if (mode === "challenges") {
    if (e.code === "Escape" || action === "challenges") hideOverlay();
    return;
  }

  if (mode === "release-confirm") {
    if (e.code === "Escape") showPalette();
    return;
  }

  if (mode === "cache-confirm") {
    if (e.code === "Escape") showSettings(settingsReturn);
    return;
  }

  if (mode !== "play") return;

  if (action === "draw") openDraw("hand");
  else if (action === "attack") useTool();
  else if (action === "parry") tryParry();
  else if (action === "capture") captureNearbyCreature();
  else if (action === "dex") showDex();
  else if (action === "inventory") showPalette();
  else if (action === "map") showWorldMap();
  else if (action === "challenges") showChallenges();
  else if (action === "jump") tryJump();
  else if (action === "dodge") tryDodge();
  else if (action === "wire") useWire();
  else if (action === "reflector") useReflector();
  else if (action === "lockOn") toggleLockOn();
});

window.addEventListener("keyup", e => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

// ---------------------------------------------------------------- 루프

function updateImpact(dt) {
  if (Math.abs(game.knockX) + Math.abs(game.knockY) < .5) return;
  const nx = game.px + game.knockX * dt;
  const ny = game.py + game.knockY * dt;
  const lockX = regionRequiredMarksAt(Math.floor(nx / TILE), Math.floor(game.py / TILE)) > game.found.size;
  const lockY = regionRequiredMarksAt(Math.floor(game.px / TILE), Math.floor(ny / TILE)) > game.found.size;
  if (!lockX && !blockedAt(nx, game.py)) game.px = nx;
  else game.knockX *= -.18;
  if (!lockY && !blockedAt(game.px, ny)) game.py = ny;
  else game.knockY *= -.18;
  game.knockX *= Math.max(0, 1 - dt * 8);
  game.knockY *= Math.max(0, 1 - dt * 8);
  dirty = true;
}

function movePlayer(dt) {
  const lockedFacing = updateLockedFacing();
  if (game.bindTimer > 0) {
    game.walking = false;
    game.running = false;
    return;
  }
  let dx = 0;
  let dy = 0;
  if (game.dodgeTimer > 0) {
    dx = game.dodgeX;
    dy = game.dodgeY;
  } else {
    for (const code of keys) {
      const v = moveVectorForCode(code);
      if (v) { dx += v[0]; dy += v[1]; }
    }
  }

  game.walking = dx !== 0 || dy !== 0;
  game.running = game.walking && actionHeld("sprint");
  if (!game.walking) return;

  const len = Math.hypot(dx, dy) || 1;
  if (!lockedFacing && game.dodgeTimer <= 0) {
    game.faceX = dx / len;
    game.faceY = dy / len;
    if (dx !== 0) game.facing = dx > 0 ? 1 : -1;
  }
  const shoe = game.shoes?.shoeStats ?? null;
  const frontierBoost = progressionEffects(game.frontierTier).sprintBonus;
  const thermal = thermalState(game.temperature);
  const moveMultiplier = game.running
    ? 1.42 + (shoe?.speed ?? 0) * 0.42 + frontierBoost
    : 1 + (shoe?.stability ?? 0) * 0.08;
  const dodgeBoost = game.dodgeTimer > 0 ? dodgeTiming().speed : 1;
  const step = PLAYER_SPEED * moveMultiplier * dodgeBoost * thermal.speed * dt;
  const beforeX = game.px;
  const beforeY = game.py;
  const nx = game.px + (dx / len) * step;
  const ny = game.py + (dy / len) * step;

  // 축을 나눠 검사하면 벽을 따라 미끄러진다.
  const lockX = regionRequiredMarksAt(Math.floor(nx / TILE), Math.floor(game.py / TILE)) > game.found.size;
  const lockY = regionRequiredMarksAt(Math.floor(game.px / TILE), Math.floor(ny / TILE)) > game.found.size;
  const blockX = lockX ? "frontier" : game.jumpTimer > 0 ? null : blockedAt(nx, game.py);
  const blockY = lockY ? "frontier" : game.jumpTimer > 0 ? null : blockedAt(game.px, ny);
  if (!blockX) game.px = nx;
  if (!blockY) game.py = ny;
  if (game.jumpTimer <= 0 && (blockX === "bramble" || blockY === "bramble")) hurtPlayer("가시덩굴");
  if ((blockX === "frontier" || blockY === "frontier") && el.toast.hidden) {
    toast("다음 지역은 아직 잠겨 있다 · 앞선 신호기를 먼저 활성화하자", "bad");
  }
  const moved = Math.hypot(game.px - beforeX, game.py - beforeY);
  wearShoes(moved);
  if (moved > 0) {
    const env = currentEnvironment();
    const tiles = moved / TILE;
    game.travelDistance += tiles;
    const generatedNoise = tiles * (game.running ? .24 : .07) * env.weather.noise * thermal.noise;
    game.noise = clamp(game.noise + generatedNoise, 0, 1);
    dirty = true;
  }

  const depth = Math.round(Math.hypot(game.px, game.py) / TILE);
  if (depth > game.depth) { game.depth = depth; dirty = true; }
}

function drawProjectiles(camX, camY) {
  for (const projectile of projectiles) {
    const sx = Math.round(projectile.x - camX);
    const sy = Math.round(projectile.y - camY);
    ctx.fillStyle = projectile.reflected ? "#b7e8ff" : "#ff866f";
    ctx.fillRect(sx - 2, sy - 2, 5, 5);
    ctx.fillStyle = "#fff1c7";
    ctx.fillRect(sx, sy - 1, 2, 2);
  }
}

function drawWire(camX, camY) {
  if (!wireState) return;
  const target = wireState.type === "creature" ? creatures.get(wireState.key) : wireState;
  if (!target) return;
  ctx.save();
  ctx.strokeStyle = "rgba(218,244,255,.82)";
  ctx.lineWidth = 1;
  ctx.setLineDash?.([3, 2]);
  ctx.beginPath();
  ctx.moveTo(Math.round(game.px - camX), Math.round(game.py - camY - 4));
  ctx.lineTo(Math.round(target.x - camX), Math.round(target.y - camY - 3));
  ctx.stroke();
  ctx.restore();
}

function drawReflectorWard(sx, sy) {
  if (game.reflectorTimer <= 0 || !game.tool) return;
  const alpha = clamp(game.reflectorTimer / 1.45, 0.18, 0.85);
  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy - 4));
  ctx.rotate(game.time / 430);
  ctx.scale(1.25, 1.25);
  ctx.strokeStyle = `rgba(169,220,255,${alpha.toFixed(3)})`;
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of game.tool.strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  const limited = preferences.animation === "limited";
  const visualTime = limited ? Math.floor(game.time / 240) * 240 : game.time;
  const reveal = mode === "crafting" ? Math.sin((CRAFTING_DURATION - craftingTimer) / CRAFTING_DURATION * Math.PI) : 0;
  const zoom = 1 + reveal * .16;
  const shake = limited ? 0 : game.screenShake > 0 ? game.screenShake * 5 : 0;
  const camX = Math.round(game.px - W / (2 * zoom) + Math.sin(visualTime * .085) * shake);
  const camY = Math.round(game.py - H / (2 * zoom) + Math.cos(visualTime * .13) * shake);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);

  drawTerrain(ctx, camX, camY, W, H, game.seed, game.cleared, game.found.size, visualTime);
  drawDroppedItems(camX, camY);
  drawDeathDrops(ctx, deathDrops, camX, camY, visualTime);
  drawProjectiles(camX, camY);
  drawWire(camX, camY);

  for (const m of game.marks) {
    if (regionRequiredMarksAt(m.tx, m.ty) > game.found.size) continue;
    const sx = m.tx * TILE + TILE / 2 - camX;
    const sy = m.ty * TILE + TILE / 2 - camY;
    if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
    drawLandmark(ctx, Math.round(sx), Math.round(sy), game.found.has(m.index), visualTime);
  }
  for (const village of game.villages) {
    if (village.requiredMarks > game.found.size) continue;
    drawVillage(ctx, village, camX, camY, visualTime);
  }

  drawRevealEffect(ctx, revealEffect, camX, camY);

  const drawables = [...creatures.values()]
    .filter(c => regionRequiredMarksAt(Math.floor(c.x / TILE), Math.floor(c.y / TILE)) <= game.found.size)
    .map(c => ({ kind: "creature", y: c.y, c }))
    .concat(villagers.map(c => ({ kind: "villager", y: c.y, c })))
    .concat(game.pet ? [{ kind: "pet", y: game.pet.y, c: game.pet }] : [])
    .concat([{ kind: "player", y: game.py }])
    .sort((a, b) => a.y - b.y);

  for (const d of drawables) {
    if (d.kind === "creature" || d.kind === "pet") {
      const sx = d.c.x - camX;
      const sy = d.c.y - camY;
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      drawCreature(ctx, { ...d.c, isPet: d.kind === "pet", lockedTarget: d.kind === "creature" && game.lockTargetKey === creatureKey(d.c) }, Math.round(sx), Math.round(sy), visualTime);
    } else if (d.kind === "villager") {
      drawVillager(ctx, d.c, d.c.x - camX, d.c.y - camY, visualTime);
    } else {
      const sx = game.px - camX;
      const jumpProgress = game.jumpTimer > 0 ? 1 - game.jumpTimer / 0.62 : 0;
      const jumpOffset = game.jumpTimer > 0 ? Math.sin(jumpProgress * Math.PI) * 9 : 0;
      const sy = game.py - camY - jumpOffset;
      const deathProgress = deathState ? clamp(1 - deathState.timer / 1.15, 0, 1) : 0;
      const craftingProgress = mode === "crafting" ? clamp(1 - craftingTimer / CRAFTING_DURATION, 0, 1) : 0;
      drawPlayer(ctx, sx, sy, game.faceX, game.faceY, game.walking, visualTime, game.jumpTimer <= 0 && isAfloat(), game.running, game.shoes, game.hurt, deathProgress, game.bindTimer, game.dodgeTimer, craftingProgress);
      if (mode === "crafting") drawCraftingReveal(ctx, craftingItem, sx, sy, craftingProgress);
      else drawHeldTool(ctx, game.tool, sx, sy, game.faceX, game.faceY, game.swing);
      drawParryEffect(ctx, sx, sy, game.faceX, game.faceY, game.parryTimer, game.parryCooldown, game.parryFlash);
      drawReflectorWard(sx, sy);
    }
  }

  drawSmokeEffects(ctx, smokeEffects, camX, camY);
  drawSuccessEffects(ctx, successEffects, camX, camY);

  ctx.restore();

  drawAtmosphere(ctx, W, H, currentEnvironment(), visualTime);
  drawVignette(ctx, W, H, game.hurt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) el.toast.hidden = true;
  }

  if (!game) return;
  game.time = now;
  successEffects = successEffects.filter(effect => (effect.time -= dt) > 0);
  updateRotatingTip();

  if (deathState && !deathState.opened) {
    deathState.timer -= dt;
    if (deathState.timer <= 0) showRespawn();
  }

  if (mode === "play" && !deathState) {
    updateImpact(dt);
    movePlayer(dt);
    updateEnvironment(dt);
    updateWire(dt);
    refreshCreatures();
    updateCreatures(dt);
    updateVillages(dt);
    updatePet(dt);
    updateProjectiles(dt);
    updateDroppedItems();
    checkLandmarks();
    game.swing = Math.max(0, game.swing - dt * 5);
    game.attackFlash = Math.max(0, game.attackFlash - dt * 4);
    game.parryTimer = Math.max(0, game.parryTimer - dt);
    game.parryCooldown = Math.max(0, game.parryCooldown - dt);
    game.parryFlash = Math.max(0, game.parryFlash - dt * 3);
    game.dodgeTimer = Math.max(0, game.dodgeTimer - dt);
    game.dodgeCooldown = Math.max(0, game.dodgeCooldown - dt);
    game.dodgeLinkTimer = Math.max(0, game.dodgeLinkTimer - dt);
    game.bindTimer = Math.max(0, game.bindTimer - dt);
    game.screenShake = Math.max(0, game.screenShake - dt * 2.8);
    game.jumpTimer = Math.max(0, game.jumpTimer - dt);
    game.reflectorTimer = Math.max(0, game.reflectorTimer - dt);
    game.invuln = Math.max(0, game.invuln - dt);
    game.hurt = Math.max(0, game.hurt - dt * 2.8);
    if (revealEffect) {
      revealEffect.time -= dt;
      if (revealEffect.time <= 0) revealEffect = null;
    }
    smokeEffects = smokeEffects.filter(effect => (effect.time -= dt) > 0);
    updateHint();
    updateHud();
    mapTimer -= dt;
    if (mapTimer <= 0) {
      updateMap();
      mapTimer = 0.12;
    }

    saveTimer -= dt;
    if (dirty && saveTimer <= 0) { save(); dirty = false; saveTimer = 1.5; }
  } else if (mode === "crafting") {
    craftingTimer -= dt;
    if (craftingTimer <= 0) finishCrafting();
  }

  render();
}

/** ?seed=1234 로 같은 세계를 그대로 다시 열 수 있다. 공유와 검증에 쓴다. */
function seedFromUrl() {
  try {
    const raw = new URLSearchParams(location.search).get("seed");
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? (n >>> 0) : null;
  } catch {
    return null;
  }
}

function devUnlocksFromUrl() {
  try {
    return new URLSearchParams(location.search).get("dev") === "1";
  } catch {
    return false;
  }
}

function bossPreviewFromUrl() {
  try {
    const value = Number.parseInt(new URLSearchParams(location.search).get("boss"), 10);
    return Number.isInteger(value) && value >= 0 && value < LANDMARK_COUNT ? value : null;
  } catch {
    return null;
  }
}

const urlSeed = seedFromUrl();
game = newGame(urlSeed ?? ((Math.random() * 2 ** 31) >>> 0));
savePreferences();
if (devUnlocksFromUrl()) {
  game.fragments = PROGRESSION_TIERS.at(-1).fragments;
  game.frontierTier = PROGRESSION_TIERS.length;
  game.ink = 30;
  game.maxGear = 8;
  game.inventory = { stone: 5, fiber: 5, resin: 5, essence: 5, mirrorInk: 5 };
  const previewBoss = bossPreviewFromUrl();
  if (previewBoss !== null) {
    for (let index = 0; index < previewBoss; index++) {
      game.handled.add(`boss:${index}`);
      game.found.add(index);
    }
    game.bossesDefeated = previewBoss;
    const boss = game.bosses[previewBoss];
    game.px = (boss.tx - 4) * TILE + TILE / 2;
    game.py = boss.ty * TILE + TILE / 2;
  }
}

if (urlSeed !== null) {
  el.overlay.hidden = true;
  el.toolPanel.hidden = false;
  el.progress.hidden = false;
  el.vitals.hidden = false;
  el.mapPanel.hidden = false;
  mode = "play";
} else {
  showTitle();
}
renderPad();
updateHud();
requestAnimationFrame(now => { last = now; frame(now); });
