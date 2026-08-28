// 유전자 숫자 몇 개로 생물 한 마리를 조립한다.
// 스프라이트를 그려 두지 않는다. 모든 크리처는 시드에서 자란다.

import { mulberry32, clamp } from "./rng.js?rev=9";
import { BIOME } from "./world.js?rev=9";

/** 바이옴이 색과 성격의 바탕을 정한다. 환경에 적응한 것처럼 보이게 하는 장치. */
const BIOME_TRAITS = {
  [BIOME.SAND]: { hue: 38, sat: 58, skittish: 0.25, speed: 1.15 },
  [BIOME.PLAIN]: { hue: 74, sat: 42, skittish: 0.45, speed: 1.0 },
  [BIOME.GRASS]: { hue: 104, sat: 48, skittish: 0.5, speed: 0.95 },
  [BIOME.FOREST]: { hue: 148, sat: 52, skittish: 0.7, speed: 0.85 },
  [BIOME.ROCK]: { hue: 208, sat: 26, skittish: 0.2, speed: 0.75 }
};

const SYLLABLE_A = ["무", "카", "리", "포", "샤", "덴", "울", "타", "미", "그", "요", "누"];
const SYLLABLE_B = ["르", "라", "밈", "코", "샥", "델", "룬", "티", "마", "곤", "야", "니"];
const SYLLABLE_C = ["", "", "스", "트", "카", "님", "쿠"];
const FORM_NAMES = {
  crawler: "다족형",
  beetle: "갑충형",
  longbody: "장체형",
  hopper: "도약형",
  shell: "등껍질형",
  spore: "부유형",
  orb: "구체형",
  biped: "직립형",
  armed: "다완형",
  brute: "거구형",
  serpent: "사행형"
};

const FORM_POOLS = [
  ["crawler", "beetle", "hopper", "spore", "orb", "biped"],
  ["crawler", "beetle", "longbody", "hopper", "shell", "spore", "orb", "biped", "armed"],
  ["beetle", "longbody", "shell", "spore", "orb", "biped", "armed", "brute", "serpent"],
  ["longbody", "shell", "orb", "biped", "armed", "brute", "serpent"],
  ["longbody", "armed", "brute", "serpent", "biped", "orb"]
];

/** 유전체를 만든다. 같은 시드는 언제나 같은 생물이 된다. */
export function buildGenome(genomeSeed, biome, difficulty = 0) {
  const rand = mulberry32(genomeSeed);
  const base = BIOME_TRAITS[biome] ?? BIOME_TRAITS[BIOME.PLAIN];
  const threat = clamp(Math.floor(difficulty), 0, FORM_POOLS.length - 1);

  // 같은 바이옴에서도 몸통 구조를 먼저 갈라서 단순 색상 변형을 넘는다.
  const forms = FORM_POOLS[threat];
  const form = forms[Math.floor(rand() * forms.length)];
  const upright = ["biped", "armed", "brute"].includes(form);
  const armPairs = form === "armed" ? 2 + Math.floor(rand() * 2)
    : upright ? 1 : 0;
  const segments = form === "longbody" || form === "serpent" ? 5 + Math.floor(rand() * 4)
    : form === "orb" ? 1
      : upright ? 2
    : form === "spore" ? 1 + Math.floor(rand() * 2)
      : 2 + Math.floor(rand() * 4);
  const legPairs = form === "hopper" ? 1 + Math.floor(rand() * 2)
    : ["spore", "orb", "serpent"].includes(form) ? 0
      : upright ? 1 : 2 + Math.floor(rand() * 5);
  const bodyRadius = form === "brute" ? 6.2 + rand() * 2.6
    : form === "orb" ? 5.2 + rand() * 2.5
      : form === "shell" ? 3.8 + rand() * 3.4
        : form === "spore" ? 3.8 + rand() * 2.8 : 2.4 + rand() * 3.2;
  const hasTail = rand() < 0.45;
  const hasCrest = rand() < 0.4;
  const eyes = form === "spore" ? 3 : rand() < 0.22 ? 1 : 2;
  const hasHorns = form === "beetle" || rand() < 0.18;
  const hasAntennae = form === "crawler" || form === "beetle" || rand() < 0.2;
  const hasFins = form === "spore" || rand() < 0.16;
  const shell = form === "shell" || rand() < 0.12;
  const pattern = Math.floor(rand() * 4);

  const hue = (base.hue + (rand() - 0.5) * 46 + 360) % 360;
  const sat = clamp(base.sat + (rand() - 0.5) * 24, 12, 88);
  const light = 42 + rand() * 22;

  const skittish = clamp(base.skittish + (rand() - 0.5) * 0.4, 0, 1);
  const speed = clamp(base.speed * (0.7 + rand() * 0.7) * (1 + threat * .055), 0.3, 2.35);

  const nickname =
    SYLLABLE_A[Math.floor(rand() * SYLLABLE_A.length)] +
    SYLLABLE_B[Math.floor(rand() * SYLLABLE_B.length)] +
    SYLLABLE_C[Math.floor(rand() * SYLLABLE_C.length)];
  const name = `${FORM_NAMES[form]} ${nickname}`;

  return {
    form,
    formName: FORM_NAMES[form],
    upright,
    armPairs,
    threat,
    segments,
    legPairs,
    bodyRadius,
    hasTail,
    hasCrest,
    eyes,
    hasHorns,
    hasAntennae,
    hasFins,
    shell,
    pattern,
    hue,
    sat,
    light,
    skittish,
    speed,
    name,
    biome,
    // 도감은 겉모습이 닮은 개체를 한 종으로 묶는다.
    species: `${biome}:${form}:${segments}:${legPairs}:${armPairs}:${hasTail ? 1 : 0}:${hasCrest ? 1 : 0}:${hasHorns ? 1 : 0}:${hasAntennae ? 1 : 0}:${hasFins ? 1 : 0}:${shell ? 1 : 0}:${pattern}:${Math.round(hue / 24)}`
  };
}

/** 몸통 마디의 상대 좌표. 렌더러와 판정이 같은 형태를 공유한다. */
export function bodyPlan(genome) {
  const parts = [];
  const spacing = ["longbody", "serpent"].includes(genome.form) ? 1.48 : genome.form === "spore" ? 0.78 : 1.15;
  const taper = genome.form === "shell" ? 0.18 : genome.form === "spore" ? 0.08 : 0.42;
  for (let i = 0; i < genome.segments; i++) {
    const t = genome.segments === 1 ? 0 : i / (genome.segments - 1);
    parts.push({
      offset: genome.upright ? 0 : -i * genome.bodyRadius * spacing,
      yOffset: genome.upright ? i * genome.bodyRadius * 1.55 : genome.form === "serpent" ? Math.sin(i * 1.35) * genome.bodyRadius * .58 : 0,
      radius: genome.upright ? genome.bodyRadius * (i === 0 ? .72 : 1) : genome.bodyRadius * (1 - t * taper)
    });
  }
  return parts;
}

/** 잡기 난이도. 겁이 많고 빠를수록 더 강한 접지력이 필요하다. */
export function catchThreshold(genome) {
  return clamp(0.18 + genome.skittish * 0.42 + (genome.threat ?? 0) * .035, 0.15, 0.78);
}
