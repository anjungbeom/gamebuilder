import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStrokes, isClosed, polygonArea, resample, span } from "../src/geometry.js";
import {
  biomeAt, obstacleAt, landmarkPositions, LANDMARK_COUNT, isWater, isBiomeSolid,
  creatureSeedAt, frontierRegionAt, regionRequiredMarksAt, bossPositions,
  villagePositions
} from "../src/world.js";
import { buildGenome, bodyPlan } from "../src/creature.js";
import {
  creatureMaxHp, bossWeakness, attackDamage, captureThresholdAtHp,
  inAttackArc, parryDisarmDuration, directionalWeaknessAllows
} from "../src/combat.js";
import { creatureRewardProfile, scoreCreatureActions, scoreVillagerActions, scorePetActions, selectRewardAction } from "../src/behavior.js";
import { challengeRows, nextChallenge } from "../src/challenges.js";
import { handToolProfile, petToolStats } from "../src/equipment.js";
import { environmentAt, thermalState, noiseLabel, DAY_DISTANCE } from "../src/environment.js";
import {
  tierForFragments, progressionEffects, craftingCost, dropChance, rollInteractionReward
} from "../src/progression.js";

const PAD_W = 150, PAD_H = 110;

const line = (x0, y0, x1, y1, n = 40) =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + (x1 - x0) * (i / (n - 1)), y: y0 + (y1 - y0) * (i / (n - 1)) }));

const circle = (cx, cy, r, n = 48) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * r, y: cy + Math.sin((i / n) * Math.PI * 2) * r }));

test("빈 입력은 모든 능력치가 0", () => {
  const s = analyzeStrokes([], PAD_W, PAD_H);
  assert.equal(s.reach, 0);
  assert.equal(s.durability, 0);
});

test("긴 직선은 사거리가 높고 부력이 없다", () => {
  const s = analyzeStrokes([line(8, 55, 142, 55)], PAD_W, PAD_H);
  assert.ok(s.reach > 0.6, `reach=${s.reach}`);
  assert.equal(s.buoy, 0);
  assert.ok(s.edge < 0.2, `edge=${s.edge}`);
});

test("짧은 선은 긴 선보다 사거리가 낮다", () => {
  const long = analyzeStrokes([line(8, 55, 142, 55)], PAD_W, PAD_H);
  const short = analyzeStrokes([line(60, 55, 90, 55)], PAD_W, PAD_H);
  assert.ok(short.reach < long.reach);
});

test("뾰족하게 꺾인 획은 절단력이 생긴다", () => {
  const spike = [...line(20, 90, 75, 20, 24), ...line(75, 20, 130, 90, 24)];
  const s = analyzeStrokes([spike], PAD_W, PAD_H);
  assert.ok(s.edge > 0.3, `edge=${s.edge}`);
});

test("원은 닫히고 넓이를 가진다", () => {
  const c = circle(75, 55, 34);
  assert.ok(isClosed(resample(c, 7)));
  const s = analyzeStrokes([c], PAD_W, PAD_H);
  assert.ok(s.buoy > 0.4, `buoy=${s.buoy}`);
});

test("열린 획은 부력이 없다", () => {
  const arc = circle(75, 55, 34).slice(0, 20);
  const s = analyzeStrokes([arc], PAD_W, PAD_H);
  assert.equal(s.buoy, 0);
});

test("갈래가 많을수록 접지력이 오른다", () => {
  const one = analyzeStrokes([line(75, 20, 75, 90)], PAD_W, PAD_H);
  const fork = analyzeStrokes([line(75, 20, 55, 90), line(75, 20, 75, 90), line(75, 20, 95, 90)], PAD_W, PAD_H);
  assert.equal(one.grip, 0);
  assert.ok(fork.grip > one.grip, `fork=${fork.grip}`);
});

test("잉크가 많을수록 내구도가 높다", () => {
  const thin = analyzeStrokes([line(60, 55, 90, 55)], PAD_W, PAD_H);
  const thick = analyzeStrokes([line(5, 20, 145, 20), line(5, 55, 145, 55), line(5, 90, 145, 90)], PAD_W, PAD_H);
  assert.ok(thick.durability > thin.durability);
});

test("능력치는 항상 0..1 범위", () => {
  const huge = analyzeStrokes(Array.from({ length: 12 }, (_, i) => circle(75, 55, 50)), PAD_W, PAD_H);
  for (const k of ["reach", "edge", "buoy", "grip", "ink"]) {
    assert.ok(huge[k] >= 0 && huge[k] <= 1, `${k}=${huge[k]}`);
  }
});

test("resample과 span은 퇴화 입력에서 죽지 않는다", () => {
  assert.doesNotThrow(() => resample([{ x: 5, y: 5 }], 7));
  assert.doesNotThrow(() => resample([{ x: 5, y: 5 }, { x: 5, y: 5 }], 7));
  assert.equal(span([{ x: 0, y: 0 }]), 0);
  assert.ok(polygonArea(circle(0, 0, 10)) > 250);
});

test("월드는 결정론적이다", () => {
  for (const [tx, ty] of [[0, 0], [17, -42], [-88, 130]]) {
    assert.equal(biomeAt(tx, ty, 1234), biomeAt(tx, ty, 1234));
    assert.equal(obstacleAt(tx, ty, 1234), obstacleAt(tx, ty, 1234));
  }
  assert.notEqual(
    Array.from({ length: 40 }, (_, i) => biomeAt(i, i, 1)).join(),
    Array.from({ length: 40 }, (_, i) => biomeAt(i, i, 2)).join()
  );
});

test("시작 지점은 걸어다닐 수 있다", () => {
  for (let s = 1; s < 40; s++) {
    for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [2, 2], [-2, -2]]) {
      const b = biomeAt(tx, ty, s * 7919);
      assert.ok(!isWater(b) && !isBiomeSolid(b), `seed ${s} (${tx},${ty}) -> ${b}`);
      assert.equal(obstacleAt(tx, ty, s * 7919), null);
    }
  }
});

test("표석은 항상 5개이고 땅 위에 있다", () => {
  for (let s = 1; s < 30; s++) {
    const seed = s * 104729;
    const marks = landmarkPositions(seed);
    assert.equal(marks.length, LANDMARK_COUNT);
    for (const m of marks) {
      const b = biomeAt(m.tx, m.ty, seed);
      assert.ok(!isWater(b) && !isBiomeSolid(b), `seed ${seed} landmark ${m.index} on ${b}`);
    }
    for (let i = 1; i < marks.length; i++) {
      assert.ok(Math.hypot(marks[i].tx, marks[i].ty) > Math.hypot(marks[i - 1].tx, marks[i - 1].ty));
    }
  }
});

test("크리처는 물이나 바위에 생기지 않는다", () => {
  let found = 0;
  for (let cx = -6; cx <= 6; cx++) {
    for (let cy = -6; cy <= 6; cy++) {
      const c = creatureSeedAt(cx, cy, 555);
      if (!c) continue;
      found++;
      assert.ok(!isWater(c.biome) && !isBiomeSolid(c.biome));
      const g = buildGenome(c.genomeSeed, c.biome);
      assert.ok(g.name.length >= 2);
      assert.ok(g.speed > 0 && g.speed < 3);
      assert.equal(bodyPlan(g).length, g.segments);
    }
  }
  assert.ok(found > 10, `found=${found}`);
});

test("거리별 맵 단위가 초원·사막·숲·습지·고원 순서로 열린다", () => {
  const probes = [0, 31, 53, 81, 113];
  assert.deepEqual(probes.map(x => frontierRegionAt(x, 0).index), [0, 1, 2, 3, 4]);
  assert.deepEqual(probes.map(x => regionRequiredMarksAt(x, 0)), [0, 1, 2, 3, 4]);
  assert.deepEqual(probes.map(x => frontierRegionAt(x, 0).name),
    ["바람 초원", "유리모래 사막", "안개 숲", "침수 습지", "바위 고원"]);
});

test("마을은 열린 지역마다 육지에 배치되고 시작 마을이 있다", () => {
  for (const seed of [11, 555, 7919]) {
    const villages = villagePositions(seed);
    assert.equal(villages.length, 5);
    assert.equal(villages[0].requiredMarks, 0);
    for (const village of villages) {
      const biome = biomeAt(village.tx, village.ty, seed);
      assert.ok(!isWater(biome) && !isBiomeSolid(biome));
    }
  }
});

test("개체별 보상함수가 상황에 따라 추적·후퇴·사격·도움을 선택한다", () => {
  const genome = buildGenome(1234, "forest");
  const hunter = creatureRewardProfile(genome, true, true, "normal");
  const scores = scoreCreatureActions(hunter, { targetDistance: 45, awareness: 100, homeDistance: 5, canShoot: true });
  assert.ok(["shoot", "chase"].includes(selectRewardAction(scores)));
  const disabled = scoreCreatureActions(hunter, { targetDistance: 15, awareness: 100, homeDistance: 5, canShoot: true }, { chase: true, shoot: true });
  assert.notEqual(selectRewardAction(disabled), "chase");
  const villager = scoreVillagerActions({ care: 1.4, social: .2, duty: .2, curiosity: .1, caution: .1 }, { threatDistance: 999, playerDistance: 20, homeDistance: 2, playerHurt: true });
  assert.equal(selectRewardAction(villager), "assist");
  const pet = scorePetActions({ bravery: 1.2, loyalty: .8, curiosity: .3 }, { hasTarget: true, targetDistance: 10, playerDistance: 20 });
  assert.equal(selectRewardAction(pet), "attack");
});

test("방향 약점은 지정된 쪽 공격만 허용한다", () => {
  assert.equal(directionalWeaknessAllows(0, -20, "north"), true);
  assert.equal(directionalWeaknessAllows(0, 20, "north"), false);
  assert.equal(directionalWeaknessAllows(20, 0, "east"), true);
});

test("도전과제는 다음 목표 하나와 완료 목록을 분리한다", () => {
  const state = { foundCount: 1, fragments: 5, captures: 2 };
  const rows = challengeRows(state);
  assert.ok(rows.some(row => row.completed));
  const next = nextChallenge(state);
  assert.ok(next && !next.completed);
  assert.equal(typeof next.reward, "string");
});

test("같은 그림도 손도구 유형과 펫 슬롯에서 다른 성능으로 해석된다", () => {
  const raw = { edge: .72, reach: .31, buoy: .2, grip: .18, ink: .6, strokeCount: 2 };
  const hand = handToolProfile(raw);
  const pet = petToolStats(raw);
  assert.equal(hand.type.key, "breaker");
  assert.ok(hand.stats.edge > raw.edge);
  assert.ok(hand.stats.impact > 0);
  assert.ok(pet.power > pet.control);
  assert.equal("edge" in pet, false);
});

test("비슷한 두 핵심 성능을 가진 손도구는 균형형 보너스를 받는다", () => {
  const raw = { edge: .51, reach: .48, buoy: .2, grip: .1, ink: .4, strokeCount: 3 };
  const hand = handToolProfile(raw);
  assert.equal(hand.type.key, "balanced");
  assert.ok(hand.stats.edge > raw.edge && hand.stats.reach > raw.reach);
});

test("각 신호기에는 육지 우두머리가 있고 마지막 개체만 영역 지배자다", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const bosses = bossPositions(seed * 3571);
    assert.equal(bosses.length, LANDMARK_COUNT);
    assert.equal(bosses.filter(b => b.rank === "midboss").length, 4);
    assert.equal(bosses.filter(b => b.rank === "fieldboss").length, 1);
    for (const boss of bosses) assert.ok(!isWater(boss.biome) && !isBiomeSolid(boss.biome));
  }
});

test("우두머리 약점 공격은 피해가 커지고 일반 적대 크리처만 저체력 포획할 수 있다", () => {
  const stats = { edge: 0.7, reach: 0.2, buoy: 0.1, grip: 0.5 };
  assert.ok(attackDamage(stats, "edge", "midboss") > attackDamage(stats, "buoy", "midboss"));
  assert.equal(captureThresholdAtHp(0.4, 8, 10, "normal"), Infinity);
  assert.ok(Number.isFinite(captureThresholdAtHp(0.4, 3, 10, "normal")));
  assert.equal(captureThresholdAtHp(0.4, 1, 10, "midboss"), Infinity);
  const genome = buildGenome(1234, "forest");
  assert.ok(creatureMaxHp(genome, "fieldboss") > creatureMaxHp(genome, "midboss"));
  assert.match(bossWeakness(7), /edge|reach|buoy|grip/);
});

test("공격은 바라보는 방향의 범위 안에서만 맞고 패링은 일반종을 더 오래 무장해제한다", () => {
  assert.equal(inAttackArc(18, 0, 1, 0, 24, 3), true);
  assert.equal(inAttackArc(-8, 0, 1, 0, 24, 3), false);
  assert.equal(inAttackArc(40, 0, 1, 0, 24, 3), false);
  assert.ok(parryDisarmDuration("normal") > parryDisarmDuration("midboss"));
});

test("낮밤과 날씨는 이동 거리와 시드로 결정되고 체온·소음 상태가 구분된다", () => {
  const morning = environmentAt(1234, 0, "plain");
  const night = environmentAt(1234, DAY_DISTANCE * .78, "plain");
  assert.equal(environmentAt(1234, 0, "plain").weather.key, morning.weather.key);
  assert.notEqual(morning.period, night.period);
  assert.equal(thermalState(3).key, "cold");
  assert.equal(thermalState(34).key, "hot");
  assert.equal(noiseLabel(.9), "매우 시끄러움");
});

test("기술 조각은 2·5·9·14·20·28개에서 새 기능을 해금한다", () => {
  assert.deepEqual(
    [0, 1, 2, 4, 5, 8, 9, 13, 14, 19, 20, 27, 28].map(tierForFragments),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]
  );
  assert.equal(progressionEffects(1).dropBonus, 0.10);
  assert.equal(progressionEffects(2).jump, true);
  assert.equal(progressionEffects(3).fieldRepair, true);
  assert.equal(progressionEffects(3).craftDiscount, 1);
  assert.equal(progressionEffects(4).wire, true);
  assert.equal(progressionEffects(5).reflector, true);
  assert.equal(progressionEffects(6).rangeBonus, 8);
  assert.equal(progressionEffects(6).sprintBonus, 0.16);
});

test("절약 설계는 빈 그림을 무료로 두고 유효한 제작비만 1 줄인다", () => {
  assert.equal(craftingCost(0, 3), 0);
  assert.equal(craftingCost(1, 3), 1);
  assert.equal(craftingCost(4, 2), 4);
  assert.equal(craftingCost(4, 3), 3);
});

test("확률 보상은 상호작용 종류별이며 같은 시드와 좌표에서 재현된다", () => {
  assert.ok(dropChance("hostile", 0) > dropChance("boulder", 0));
  assert.equal(dropChance("boulder", 1), dropChance("boulder", 0) + 0.10);
  const first = rollInteractionReward("thicket", 17, -4, 1234, 2);
  const again = rollInteractionReward("thicket", 17, -4, 1234, 2);
  assert.deepEqual(first, again);
});
