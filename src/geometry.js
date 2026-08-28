// 그림의 기하 특성을 도구 성능으로 바꾸는 순수 로직.
// 무엇을 그렸는지 알아맞히지 않는다. 어떻게 생겼는지만 잰다.

import { clamp } from "./rng.js";

/** 획을 일정 간격으로 다시 찍는다. 손떨림이 만드는 가짜 뾰족함을 지운다. */
export function resample(points, spacing = 7) {
  if (points.length < 2) return points.slice();

  const out = [points[0]];
  let carry = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    let dx = curr.x - prev.x;
    let dy = curr.y - prev.y;
    let segment = Math.hypot(dx, dy);
    if (segment === 0) continue;

    const ux = dx / segment;
    const uy = dy / segment;
    let travelled = -carry;

    while (travelled + spacing <= segment) {
      travelled += spacing;
      out.push({ x: prev.x + ux * travelled, y: prev.y + uy * travelled });
    }
    carry = segment - travelled;
  }

  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.5) out.push(last);
  return out;
}

export function strokeLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** 획이 스스로 닫혔는지. 닫힌 형태만 부력을 가진다. */
export function isClosed(points) {
  if (points.length < 6) return false;
  const length = strokeLength(points);
  if (length < 48) return false;
  const gap = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y
  );
  return gap < length * 0.24;
}

/** 신발끈 공식. 닫힌 획이 감싼 넓이. */
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 가장 멀리 떨어진 두 점 사이 거리. 도구의 물리적 길이. */
export function span(points) {
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > best) best = d;
    }
  }
  return best;
}

/** 각 꼭짓점에서 꺾인 각도. 0이면 직선, PI에 가까우면 뾰족한 끝. */
export function turnAngles(points) {
  const angles = [];
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    const cos = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
    angles.push(Math.acos(cos));
  }
  return angles;
}

const EMPTY_STATS = {
  reach: 0,
  edge: 0,
  buoy: 0,
  grip: 0,
  ink: 0,
  durability: 0,
  inkPx: 0,
  spanPx: 0,
  areaPx: 0,
  strokeCount: 0
};

/**
 * 획 묶음 전체를 도구 수치로 환산한다.
 * 모든 능력치는 0..1로 정규화되어 세계의 장애물 문턱값과 직접 비교된다.
 */
export function analyzeStrokes(strokes, padW, padH) {
  const usable = strokes.filter(stroke => stroke.length >= 2);
  if (usable.length === 0) return { ...EMPTY_STATS };

  const diagonal = Math.hypot(padW, padH);
  const padArea = padW * padH;

  const resampled = usable.map(stroke => resample(stroke, 7));
  const allPoints = resampled.flat();

  // 길이: 이동한 총 거리. 잉크의 양이자 내구도의 근거.
  const inkPx = resampled.reduce((sum, stroke) => sum + strokeLength(stroke), 0);

  // 사거리: 양 끝이 얼마나 멀리 뻗었는가.
  const spanPx = span(allPoints);

  // 절단력: 가장 날카롭게 꺾인 단 한 지점. 뾰족한 끝은 하나면 충분하다.
  // 평균을 내면 긴 직선부가 꼭짓점을 0으로 희석시킨다.
  const angles = resampled.flatMap(turnAngles);
  const edgeRaw = angles.length ? Math.max(...angles) / Math.PI : 0;

  // 부력: 닫힌 획이 품은 넓이.
  const areaPx = resampled
    .filter(isClosed)
    .reduce((sum, stroke) => sum + polygonArea(stroke), 0);

  // 접지력: 자유롭게 열린 끝의 개수. 갈래가 많을수록 잘 붙잡는다.
  const openEnds = resampled.filter(stroke => !isClosed(stroke)).length * 2;

  return {
    reach: clamp(spanPx / (diagonal * 0.82), 0, 1),
    edge: clamp((edgeRaw - 0.18) / 0.55, 0, 1),
    buoy: clamp(areaPx / (padArea * 0.3), 0, 1),
    grip: clamp((openEnds - 2) / 6, 0, 1),
    ink: clamp(inkPx / (diagonal * 4), 0, 1),
    durability: Math.round(3 + clamp(inkPx / (diagonal * 4), 0, 1) * 9),
    inkPx,
    spanPx,
    areaPx,
    strokeCount: usable.length
  };
}

const NAME_BY_TRAIT = {
  edge: ["돌망치", "파쇄 송곳", "쐐기칼", "바위깨기"],
  reach: ["긴 장대", "장창", "긴 갈고리", "뻗는 집게"],
  buoy: ["부력판", "둥근 방패", "부표틀", "물방패"],
  grip: ["포획 갈퀴", "집게", "덩굴 갈고리", "그물틀"]
};

/** 가장 두드러진 성질로 도구를 부른다. 이름은 결과지 목표가 아니다. */
export function nameTool(stats, seed = 0) {
  const traits = [
    ["edge", stats.edge],
    ["reach", stats.reach],
    ["buoy", stats.buoy],
    ["grip", stats.grip]
  ].sort((a, b) => b[1] - a[1]);

  const [trait, value] = traits[0];
  if (value < 0.16) return "작은 손도구";
  const pool = NAME_BY_TRAIT[trait];
  return pool[Math.abs(seed) % pool.length];
}
