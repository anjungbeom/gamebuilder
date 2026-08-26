import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStrokes, isClosed, polygonArea, resample, span } from "../src/geometry.js";
import { biomeAt, obstacleAt, landmarkPositions, LANDMARK_COUNT, isWater, isBiomeSolid, creatureSeedAt } from "../src/world.js";
import { buildGenome, bodyPlan } from "../src/creature.js";

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
