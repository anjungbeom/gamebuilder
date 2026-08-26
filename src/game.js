// Drawn Frontier — 그린 것이 곧 도구가 된다.
// 상태 기계, 입력, 시뮬레이션, 저장. 순수 로직은 이웃 모듈이 맡는다.

import { clamp, mulberry32, hashUnit } from "./rng.js";
import { analyzeStrokes, nameTool, resample } from "./geometry.js";
import {
  TILE, BIOME, biomeAt, obstacleAt, isWater, isBiomeSolid,
  OBSTACLE_RULE, WATER_RULE, landmarkPositions, LANDMARK_COUNT,
  creatureSeedAt, CREATURE_CELL
} from "./world.js";
import { buildGenome, catchThreshold } from "./creature.js";
import {
  drawTerrain, drawLandmark, drawCreature, drawPlayer, drawHeldTool, drawVignette
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
  mapPanel: document.getElementById("map-panel"),
  minimap: document.getElementById("minimap"),
  mapCoord: document.getElementById("map-coord"),
  goalText: document.getElementById("goal-text"),
  shoeName: document.getElementById("shoe-name"),
  captures: document.getElementById("p-captures"),
  ink: document.getElementById("p-ink"),
  drawTitle: document.getElementById("draw-title-text"),
  drawLegend: document.getElementById("draw-legend"),
  drawBudget: document.getElementById("draw-budget")
};
const mapCtx = el.minimap.getContext("2d");
mapCtx.imageSmoothingEnabled = false;

const SAVE_KEY = "drawn-frontier-v2";
const PLAYER_SPEED = 58;      // 월드 픽셀 / 초
const TOOL_SCALE = 0.085;     // 그림 좌표 -> 월드 픽셀
const USE_RANGE = 24;

const HAND_STAT_DEFS = [
  { key: "edge", label: "바위", color: "var(--edge)", tick: OBSTACLE_RULE.boulder.threshold },
  { key: "reach", label: "거리", color: "var(--reach)", tick: OBSTACLE_RULE.thicket.threshold },
  { key: "buoy", label: "물길", color: "var(--buoy)", tick: WATER_RULE.threshold },
  { key: "grip", label: "포획", color: "var(--grip)", tick: OBSTACLE_RULE.bramble.threshold }
];
const SHOE_STAT_DEFS = [
  { key: "speed", label: "질주", color: "var(--reach)", tick: 0.55 },
  { key: "stability", label: "안정", color: "var(--buoy)", tick: 0.48 },
  { key: "endurance", label: "수명", color: "var(--grip)", tick: 0.45 },
  { key: "economy", label: "절약", color: "var(--edge)", tick: 0.45 }
];
const CAPTURE_MILESTONES = [2, 5, 9, 14];

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
    observations: 0,
    milestone: 0,
    shoeWear: 0,
    cleared: new Set(),
    handled: new Set(),
    dex: new Map(),
    found: new Set(),
    depth: 0,
    time: 0,
    marks: landmarkPositions(seed)
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
      observations: game.observations,
      milestone: game.milestone,
      maxGear: game.maxGear,
      gearSeq: game.gearSeq,
      shoeWear: game.shoeWear,
      gear: game.gear,
      equipped: { hand: game.tool?.id ?? null, shoes: game.shoes?.id ?? null },
      depth: game.depth,
      cleared: [...game.cleared],
      handled: [...game.handled],
      found: [...game.found],
      dex: [...game.dex.entries()],
      tool: game.tool && {
        strokes: game.tool.strokes,
        stats: game.tool.stats,
        name: game.tool.name,
        color: game.tool.color,
        durability: game.tool.durability,
        maxDurability: game.tool.maxDurability
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
    g.cleared = new Set(d.cleared ?? []);
    g.handled = new Set(d.handled ?? []);
    g.found = new Set(d.found ?? []);
    g.dex = new Map(d.dex ?? []);
    g.ink = d.ink ?? 10;
    g.captures = d.captures ?? 0;
    g.observations = d.observations ?? 0;
    g.milestone = d.milestone ?? 0;
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
    return g;
  } catch {
    return null;
  }
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

// ---------------------------------------------------------------- 크리처

function refreshCreatures() {
  const pcx = Math.floor(game.px / TILE / CREATURE_CELL);
  const pcy = Math.floor(game.py / TILE / CREATURE_CELL);
  const R = 2;

  for (const [key, c] of creatures) {
    if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cy - pcy) > R + 1) creatures.delete(key);
  }

  for (let cy = pcy - R; cy <= pcy + R; cy++) {
    for (let cx = pcx - R; cx <= pcx + R; cx++) {
      const key = `${cx},${cy}`;
      if (creatures.has(key)) continue;
      if (game.handled.has(key)) continue;
      const seedInfo = creatureSeedAt(cx, cy, game.seed);
      if (!seedInfo) continue;

      const genome = buildGenome(seedInfo.genomeSeed, seedInfo.biome);
      creatures.set(key, {
        cx, cy,
        homeX: seedInfo.tx * TILE + TILE / 2,
        homeY: seedInfo.ty * TILE + TILE / 2,
        x: seedInfo.tx * TILE + TILE / 2,
        y: seedInfo.ty * TILE + TILE / 2,
        vx: 0, vy: 0,
        genome,
        hostile: hashUnit(cx, cy, game.seed + 99173) < 0.38,
        facing: 1,
        moving: false,
        phase: hashUnit(cx, cy, game.seed + 77) * 10,
        wanderTimer: 0
      });
    }
  }
}

function updateCreatures(dt) {
  for (const c of creatures.values()) {
    const dx = game.px - c.x;
    const dy = game.py - c.y;
    const dist = Math.hypot(dx, dy);
    const fleeRange = 30 + c.genome.skittish * 46;

    let ax = 0;
    let ay = 0;

    if (c.hostile && dist < 72 && dist > 0.01) {
      ax = dx / dist;
      ay = dy / dist;
      if (dist < 9) hurtPlayer(`${c.genome.name}의 돌진`);
    } else if (!c.hostile && dist < fleeRange && dist > 0.01) {
      // 겁 많은 생물은 도망친다. 도감에 넣으려면 따라잡아야 한다.
      ax = -dx / dist;
      ay = -dy / dist;
    } else {
      c.wanderTimer -= dt;
      if (c.wanderTimer <= 0) {
        c.wanderTimer = 0.8 + Math.random() * 1.6;
        const hx = c.homeX - c.x;
        const hy = c.homeY - c.y;
        const hd = Math.hypot(hx, hy);
        const angle = Math.random() * Math.PI * 2;
        // 집에서 멀어지면 돌아가려는 성향이 강해진다.
        const pull = clamp(hd / 90, 0, 1);
        c.vx = Math.cos(angle) * (1 - pull) + (hd > 0.01 ? (hx / hd) * pull : 0);
        c.vy = Math.sin(angle) * (1 - pull) + (hd > 0.01 ? (hy / hd) * pull : 0);
      }
      ax = c.vx;
      ay = c.vy;
    }

    const speed = c.genome.speed * 26 * dt;
    const nx = c.x + ax * speed;
    const ny = c.y + ay * speed;

    if (!creatureBlocked(nx, c.y)) c.x = nx;
    if (!creatureBlocked(c.x, ny)) c.y = ny;

    c.moving = Math.abs(ax) + Math.abs(ay) > 0.05;
    if (Math.abs(ax) > 0.05) c.facing = ax >= 0 ? 1 : -1;
  }
}

/** 크리처는 물과 바위를 피한다. 장애물은 통과한다 (몸집이 작다). */
function creatureBlocked(wx, wy) {
  const b = biomeAt(Math.floor(wx / TILE), Math.floor(wy / TILE), game.seed);
  return isBiomeSolid(b) || isWater(b);
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
  const stats = analyzeStrokes(strokes, PAD_W, PAD_H);
  if (stats.durability === 0) return null;

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
    .map(d => [d.key, stats[d.key]])
    .sort((a, b) => b[1] - a[1])[0][0];

  const resonanceBonus = game?.found?.size ?? 0;
  const shoeStats = shoeStatsFrom(stats);
  const durability = slot === "shoes"
    ? Math.round(5 + shoeStats.endurance * 18) + resonanceBonus
    : stats.durability + resonanceBonus;
  return {
    id: `${slot}-${game.gearSeq++}`,
    slot,
    strokes: normalized,
    stats,
    shoeStats,
    name: slot === "shoes" ? nameShoes(shoeStats) : nameTool(stats, Math.round(stats.spanPx)),
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

function hurtPlayer(reason) {
  if (game.invuln > 0) return;
  game.hp -= 1;
  game.invuln = 1.1;
  game.hurt = 1;
  dirty = true;

  if (game.hp > 0) {
    toast(`${reason}에 다쳤다 — 가시가 없는 쪽으로 우회하자`, "bad");
    return;
  }

  game.px = 0;
  game.py = 0;
  game.hp = game.maxHp;
  game.invuln = 1.8;
  toast("조난 구조 — 출발 야영지에서 다시 깨어났다", "bad");
  saveNow();
}

// ---------------------------------------------------------------- 상호작용

function nearestObstacle() {
  const tx = Math.floor(game.px / TILE);
  const ty = Math.floor(game.py / TILE);
  let best = null;
  let bestDist = USE_RANGE;

  for (let y = ty - 2; y <= ty + 2; y++) {
    for (let x = tx - 2; x <= tx + 2; x++) {
      const key = `${x},${y}`;
      if (game.cleared.has(key)) continue;
      const ob = obstacleAt(x, y, game.seed);
      if (!ob) continue;
      const d = Math.hypot(x * TILE + TILE / 2 - game.px, y * TILE + TILE / 2 - game.py);
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
  let bestDist = USE_RANGE + 6;
  for (const c of creatures.values()) {
    const d = Math.hypot(c.x - game.px, c.y - game.py);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
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
  const need = catchThreshold(c.genome);
  const have = game.tool.stats.grip;
  if (have < need) {
    toast(`포획 성능이 모자란다 — ${have.toFixed(2)} / ${need.toFixed(2)}`, "bad");
    dirty = true;
    return;
  }

  const first = !game.dex.has(c.genome.species);
  game.dex.set(c.genome.species, { name: c.genome.name, biome: c.genome.biome, hostile: c.hostile });
  game.handled.add(`${c.cx},${c.cy}`);
  creatures.delete(`${c.cx},${c.cy}`);
  spendTool();
  const beforeMilestone = game.milestone;
  grantCreatureReward(c, first);
  if (first) {
    game.hp = Math.min(game.maxHp, game.hp + 1);
    if (game.tool) game.tool.durability = Math.min(game.tool.maxDurability, game.tool.durability + 1);
  }
  const reward = c.hostile ? (first ? 3 : 2) : (first ? 2 : 1);
  const milestoneText = game.milestone > beforeMilestone
    ? ` · 이정표 ${game.milestone}단계! 장비칸 +1·보너스 획 +4`
    : "";
  toast(c.hostile
    ? `위협 포획 — ${c.genome.name} · 획 +${reward}${milestoneText}`
    : `평온종 관찰 — ${c.genome.name} · 획 +${reward}`, "good");
  saveNow();
}

function useTool() {
  if (!game.tool) {
    toast("도구가 없다 — Q로 지금 필요한 형질을 그려 보자", "bad");
    return;
  }
  game.swing = 1;

  const nearbyCreature = nearestCreature();
  if (nearbyCreature?.hostile) {
    interactCreature(nearbyCreature);
    return;
  }

  const ob = nearestObstacle();
  if (ob) {
    const rule = OBSTACLE_RULE[ob.kind];
    const have = game.tool.stats[rule.stat];
    if (have >= rule.threshold) {
      game.cleared.add(ob.key);
      toast(`길을 열었다 — ${rule.label}`, "good");
      spendTool();
      saveNow();
    } else {
      toast(`${rule.need}이 모자란다 — ${have.toFixed(2)} / ${rule.threshold.toFixed(2)}`, "bad");
    }
    dirty = true;
    return;
  }

  const c = nearbyCreature;
  if (c) {
    interactCreature(c);
    return;
  }

  toast("지금 도구에 반응하는 대상이 없다");
}

function checkLandmarks() {
  for (const m of game.marks) {
    if (game.found.has(m.index)) continue;
    const d = Math.hypot(m.tx * TILE + TILE / 2 - game.px, m.ty * TILE + TILE / 2 - game.py);
    if (d < 22) {
      game.found.add(m.index);
      game.hp = game.maxHp;
      if (game.tool) game.tool.durability = game.tool.maxDurability;
      toast(`맥점 연결 — ${m.name} · 체력과 도구 회복 · 다음 제작 +1회`, "good");
      saveNow();
      if (game.found.size >= LANDMARK_COUNT) showWin();
    }
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
  mode = "draw";
  el.drawLayer.hidden = false;
  el.toolPanel.classList.add("live");
  el.drawTitle.textContent = slot === "shoes" ? "탐사 신발 설계" : "손도구 설계";
  el.drawLegend.innerHTML = slot === "shoes"
    ? `<span><i class="k">길게</i> 질주</span><span><i class="k">둥글게</i> 안정</span><span><i class="k">촘촘히</i> 수명</span><span><i class="k">적은 획</i> 절약</span>`
    : `<span><i class="k">뾰족하게</i> 바위</span><span><i class="k">길게</i> 거리</span><span><i class="k">닫아서</i> 물길</span><span><i class="k">여러 획</i> 포획</span>`;
  renderPad();
  updateHud();
}

function closeDraw() {
  mode = "play";
  el.drawLayer.hidden = true;
  el.toolPanel.classList.remove("live");
  updateHud();
}

function confirmDraw() {
  const cost = strokes.filter(s => s.length >= 2).length;
  if (cost > game.ink) {
    toast(`획 조각이 모자란다 — 필요 ${cost} / 보유 ${game.ink}`, "bad");
    return;
  }
  if (totalGear() >= game.maxGear) {
    toast(`장비 가방이 가득 찼다 — Tab에서 장비를 정리하자`, "bad");
    return;
  }
  const gear = buildGear(strokes, draftSlot);
  if (!gear) {
    toast("형태가 너무 짧다 — 획을 조금 더 이어 보자", "bad");
    return;
  }
  game.ink -= cost;
  game.gear[draftSlot].push(gear);
  if (draftSlot === "shoes") game.shoes = gear;
  else game.tool = gear;
  saveNow();
  closeDraw();
  toast(`${gear.name} 제작·장착 — 획 ${cost} 사용`, "good");
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
  pad.setPointerCapture?.(e.pointerId);
  drawing = true;
  current = [padPoint(e)];
  strokes.push(current);
  renderPad();
  updateHud();
});

pad.addEventListener("pointermove", e => {
  if (mode !== "draw" || !drawing || !current) return;
  e.preventDefault();
  const p = padPoint(e);
  const tail = current[current.length - 1];
  if (Math.hypot(p.x - tail.x, p.y - tail.y) < 1.5) return;
  current.push(p);
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
  for (const s of strokes) {
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
    else if (act === "clear") { strokes = []; current = null; renderPad(); updateHud(); }
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
    return draftSlot === "shoes" ? shoeStatsFrom(base) : base;
  }
  return game?.tool?.stats ?? null;
}

function updateHud() {
  if (!game) return;
  const stats = statsForHud();
  const defs = mode === "draw" && draftSlot === "shoes" ? SHOE_STAT_DEFS : HAND_STAT_DEFS;

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
    const d = draftSlot === "shoes"
      ? Math.round(5 + shoeStatsFrom(base).endurance * 18) + game.found.size
      : base.durability;
    el.toolName.textContent = d > 0
      ? (draftSlot === "shoes" ? nameShoes(shoeStatsFrom(base)) : nameTool(base, Math.round(base.spanPx)))
      : "형질 분석 중";
    el.toolDura.textContent = d > 0 ? `사용 ${d}회` : "";
    el.toolDura.classList.remove("low");
    const cost = strokes.filter(s => s.length >= 2).length;
    el.drawBudget.textContent = `이번 설계 ${cost}획 · 보유 ${game.ink}획`;
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
  el.shoeName.textContent = game.shoes
    ? `${game.shoes.name} ${game.shoes.durability}/${game.shoes.maxDurability}`
    : "기본 장화";
  el.hearts.innerHTML = Array.from({ length: game.maxHp }, (_, i) =>
    `<i class="heart ${i < game.hp ? "full" : "empty"}" aria-hidden="true">♥</i>`
  ).join("");
  el.hearts.setAttribute?.("aria-label", `체력 ${game.hp}/${game.maxHp}`);
  el.resonance.textContent = game.found.size;
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
      mapCtx.fillStyle = MAP_COLORS[biomeAt(wx, wy, game.seed)] ?? "#9dbf62";
      mapCtx.fillRect(x * cell, y * cell, cell, cell);
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
    const distance = Math.round(Math.hypot(rx, ry));
    el.goalText.textContent = `${compassDirection(rx, ry)}쪽 ${distance}칸 · ${target.name}`;
  } else {
    el.goalText.textContent = "첫 개척망 완성 · 더 먼 생태를 탐사하자";
  }

  mapCtx.fillStyle = "#fff";
  mapCtx.fillRect(Math.floor(cols / 2) * cell + 1, Math.floor(rows / 2) * cell + 1, 2, 2);
  mapCtx.strokeStyle = "#172033";
  mapCtx.strokeRect(Math.floor(cols / 2) * cell, Math.floor(rows / 2) * cell, cell, cell);
  el.mapCoord.textContent = `${tx} · ${ty}`;
}

function updateHint() {
  if (mode !== "play") { el.hint.hidden = true; return; }

  const ob = nearestObstacle();
  if (ob) {
    const rule = OBSTACLE_RULE[ob.kind];
    const have = game.tool ? game.tool.stats[rule.stat] : 0;
    const ok = have >= rule.threshold;
    el.hint.innerHTML = ok
      ? `${rule.label} — <b>Space</b>로 길 열기`
      : `${rule.label} — ${rule.need} <b>${rule.threshold.toFixed(2)}</b> (현재 ${have.toFixed(2)})`;
    el.hint.hidden = false;
    return;
  }

  const c = nearestCreature();
  if (c) {
    const need = catchThreshold(c.genome);
    const have = game.tool ? game.tool.stats.grip : 0;
    el.hint.innerHTML = have >= need
      ? `${c.hostile ? "⚠ 위협종" : "◇ 평온종"} ${c.genome.name} — <b>Space</b>로 ${c.hostile ? "포획" : "관찰"}`
      : `${c.hostile ? "⚠ 위협종" : "◇ 평온종"} ${c.genome.name} — 포획 <b>${need.toFixed(2)}</b> (현재 ${have.toFixed(2)})`;
    el.hint.hidden = false;
    return;
  }

  if (!canFloat() && nearWater()) {
    el.hint.innerHTML = `깊은 물길 — 물길 성능 <b>${WATER_RULE.threshold.toFixed(2)}</b> 이상이면 건널 수 있다`;
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

// ---------------------------------------------------------------- 화면

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
    <div>
      <h1>Drawn Frontier</h1>
      <p class="sub">길이 없으면, 그려서 연다.<br>
      이름이 아니라 획의 형질이 세계의 규칙에 닿는다.</p>
      <p class="mission">서로 멀리 잠든 다섯 개의 개척 맥점을 잇고, 그 사이에서 만난 생태를 기록하라.<br>정답 도구는 없다. 지금 막힌 길에 필요한 성질만 만들면 된다.</p>
      <div class="row">
        <button data-act="new">새 원정</button>
        ${hasSave ? `<button class="ghost" data-act="continue">원정 계속</button>` : ""}
      </div>
      <p class="keys">
        <b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>Tab</b> 장비 · <b>Space</b> 사용 · <b>C</b> 생태 기록<br>
        손도구는 바위·거리·물길·포획, 신발은 질주·안정·수명의 선택이 된다
      </p>
    </div>`;
}

function showWin() {
  mode = "win";
  save();
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div>
      <h1>첫 개척망이 이어졌다</h1>
      <p class="sub">맥점 ${game.found.size}/${LANDMARK_COUNT} · 생태 ${game.dex.size}종 · 최장 거리 ${game.depth}</p>
      <p class="mission">다섯 빛이 하나의 길이 되었다. 세계는 여기서 끝나지 않는다.<br>더 먼 좌표에도 새로운 지형과 생명이 계속 자란다.</p>
      <div class="row">
        <button data-act="new">다른 시드로 출발</button>
        <button class="ghost" data-act="keep">이 세계 계속 개척</button>
      </div>
    </div>`;
}

function showDex() {
  mode = "dex";
  const entries = [...game.dex.values()];
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div>
      <h1>생태 기록</h1>
      <p class="sub">${entries.length}종의 흔적을 남겼다</p>
      ${entries.length
        ? `<div class="dex">${entries.map(e =>
            `<div class="dex-entry"><div class="nm">${e.hostile ? "⚠ " : "◇ "}${e.name}</div><div class="bi">${e.hostile ? "위협 포획" : "평온 관찰"} · ${e.biome}</div></div>`
          ).join("")}</div>`
        : `<p class="dex-empty">아직 기록이 없다. 갈래가 많은 도구로 크리처의 움직임을 붙잡아 관찰해 보자.</p>`}
      <div class="row"><button data-act="keep">원정으로 돌아가기 <kbd>Esc</kbd></button></div>
    </div>`;
}

function gearStatText(item) {
  if (item.slot === "shoes") {
    const s = item.shoeStats ?? shoeStatsFrom(item.stats);
    return `질주 ${Math.round(s.speed * 100)} · 안정 ${Math.round(s.stability * 100)} · 수명 ${item.durability}/${item.maxDurability}`;
  }
  return `바위 ${Math.round(item.stats.edge * 100)} · 거리 ${Math.round(item.stats.reach * 100)} · 물길 ${Math.round(item.stats.buoy * 100)} · 포획 ${Math.round(item.stats.grip * 100)}`;
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

function showPalette() {
  mode = "palette";
  const next = CAPTURE_MILESTONES[game.milestone];
  el.overlay.hidden = false;
  el.overlay.innerHTML = `
    <div class="palette-wrap">
      <h1>개척 팔레트</h1>
      <p class="sub">획을 모아 장비를 설계하고, 상황에 맞춰 바로 바꿔 든다.</p>
      <div class="palette-summary">
        <span>획 조각 <b>${game.ink}</b></span><span>장비 <b>${totalGear()}/${game.maxGear}</b></span>
        <span>위협 포획 <b>${game.captures}</b></span><span>평온 관찰 <b>${game.observations}</b></span>
      </div>
      <div class="gear-sections">
        <section class="gear-section">
          <h2>손도구 <span>지형·포획</span></h2>
          ${gearCards("hand")}
          <button data-act="draw-gear" data-slot="hand">+ 손도구 그리기</button>
        </section>
        <section class="gear-section">
          <h2>신발 <span>달리기·수명</span></h2>
          ${gearCards("shoes")}
          <button data-act="draw-gear" data-slot="shoes">+ 신발 그리기</button>
        </section>
      </div>
      <p class="milestone-strip">${next
        ? `다음 이정표: 위협종 <b>${next - game.captures}마리</b> 더 포획 → 장비칸 +1, 획 +4`
        : `<b>모든 포획 이정표 달성</b> · 남은 세계를 자유롭게 개척 중`}</p>
      <div class="row"><button class="ghost" data-act="keep">돌아가기 <kbd>Tab</kbd></button></div>
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

  if (act === "draw-gear") {
    el.overlay.hidden = true;
    el.overlay.innerHTML = "";
    openDraw(btn.dataset.slot === "shoes" ? "shoes" : "hand");
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
    dirty = true;
    save();
    hideOverlay();
    toast("첫 길을 살펴보고 Q로 필요한 도구를 설계하자");
  } else if (act === "continue") {
    game = loadSave() ?? newGame((Math.random() * 2 ** 31) >>> 0);
    creatures.clear();
    hideOverlay();
  } else if (act === "keep") {
    hideOverlay();
  }
});

// ---------------------------------------------------------------- 입력

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0]
};

window.addEventListener("keydown", e => {
  if (e.code in MOVE_KEYS || ["Space", "KeyQ", "KeyC", "Tab", "Escape", "Enter", "Backspace"].includes(e.code)) {
    e.preventDefault();
  }
  keys.add(e.code);
  if (e.repeat) return;

  if (mode === "draw") {
    if (e.code === "Enter") confirmDraw();
    else if (e.code === "Escape") closeDraw();
    else if (e.code === "Backspace") { strokes = []; current = null; renderPad(); updateHud(); }
    return;
  }

  if (mode === "dex") {
    if (e.code === "Escape" || e.code === "KeyC") hideOverlay();
    return;
  }

  if (mode === "palette") {
    if (e.code === "Escape" || e.code === "Tab") hideOverlay();
    return;
  }

  if (mode !== "play") return;

  if (e.code === "KeyQ") openDraw("hand");
  else if (e.code === "Space") useTool();
  else if (e.code === "KeyC") showDex();
  else if (e.code === "Tab") showPalette();
});

window.addEventListener("keyup", e => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

// ---------------------------------------------------------------- 루프

function movePlayer(dt) {
  let dx = 0;
  let dy = 0;
  for (const code of keys) {
    const v = MOVE_KEYS[code];
    if (v) { dx += v[0]; dy += v[1]; }
  }

  game.walking = dx !== 0 || dy !== 0;
  game.running = game.walking && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
  if (!game.walking) return;

  const len = Math.hypot(dx, dy) || 1;
  const shoe = game.shoes?.shoeStats ?? null;
  const moveMultiplier = game.running
    ? 1.42 + (shoe?.speed ?? 0) * 0.42
    : 1 + (shoe?.stability ?? 0) * 0.08;
  const step = PLAYER_SPEED * moveMultiplier * dt;
  const beforeX = game.px;
  const beforeY = game.py;
  const nx = game.px + (dx / len) * step;
  const ny = game.py + (dy / len) * step;

  game.faceX = Math.sign(dx);
  game.faceY = Math.sign(dy);
  if (dx !== 0) game.facing = dx > 0 ? 1 : -1;

  // 축을 나눠 검사하면 벽을 따라 미끄러진다.
  const blockX = blockedAt(nx, game.py);
  const blockY = blockedAt(game.px, ny);
  if (!blockX) game.px = nx;
  if (!blockY) game.py = ny;
  if (blockX === "bramble" || blockY === "bramble") hurtPlayer("가시덩굴");
  wearShoes(Math.hypot(game.px - beforeX, game.py - beforeY));

  const depth = Math.round(Math.hypot(game.px, game.py) / TILE);
  if (depth > game.depth) { game.depth = depth; dirty = true; }
}

function render() {
  const camX = Math.round(game.px - W / 2);
  const camY = Math.round(game.py - H / 2);

  drawTerrain(ctx, camX, camY, W, H, game.seed, game.cleared);

  for (const m of game.marks) {
    const sx = m.tx * TILE + TILE / 2 - camX;
    const sy = m.ty * TILE + TILE / 2 - camY;
    if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
    drawLandmark(ctx, Math.round(sx), Math.round(sy), game.found.has(m.index), game.time);
  }

  const drawables = [...creatures.values()]
    .map(c => ({ kind: "creature", y: c.y, c }))
    .concat([{ kind: "player", y: game.py }])
    .sort((a, b) => a.y - b.y);

  for (const d of drawables) {
    if (d.kind === "creature") {
      const sx = d.c.x - camX;
      const sy = d.c.y - camY;
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      drawCreature(ctx, d.c, Math.round(sx), Math.round(sy), game.time);
    } else {
      const sx = game.px - camX;
      const sy = game.py - camY;
      drawPlayer(ctx, sx, sy, game.faceX, game.faceY, game.walking, game.time, isAfloat(), game.running, game.shoes, game.hurt);
      drawHeldTool(ctx, game.tool, sx, sy, game.faceX, game.faceY, game.swing);
    }
  }

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

  if (mode === "play") {
    movePlayer(dt);
    refreshCreatures();
    updateCreatures(dt);
    checkLandmarks();
    game.swing = Math.max(0, game.swing - dt * 5);
    game.invuln = Math.max(0, game.invuln - dt);
    game.hurt = Math.max(0, game.hurt - dt * 2.8);
    updateHint();
    updateHud();
    mapTimer -= dt;
    if (mapTimer <= 0) {
      updateMap();
      mapTimer = 0.12;
    }

    saveTimer -= dt;
    if (dirty && saveTimer <= 0) { save(); dirty = false; saveTimer = 1.5; }
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

const urlSeed = seedFromUrl();
game = newGame(urlSeed ?? ((Math.random() * 2 ** 31) >>> 0));

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
