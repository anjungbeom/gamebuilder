// 결정론적 난수와 노이즈. 같은 시드와 좌표는 언제나 같은 값을 돌려준다.

const FRACT = 4294967296;

/** 32비트 정수 해시. 좌표와 시드를 섞어 안정적인 난수원을 만든다. */
export function hash2(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 해시를 0..1 실수로. */
export function hashUnit(x, y, seed = 0) {
  return hash2(x, y, seed) / FRACT;
}

/** 시드 하나로 재현 가능한 난수 스트림을 만든다. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / FRACT;
  };
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** 격자 값 보간 노이즈. Perlin보다 가볍고 도트 지형에는 충분하다. */
export function valueNoise(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);

  const v00 = hashUnit(x0, y0, seed);
  const v10 = hashUnit(x0 + 1, y0, seed);
  const v01 = hashUnit(x0, y0 + 1, seed);
  const v11 = hashUnit(x0 + 1, y0 + 1, seed);

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** 다중 옥타브를 겹쳐 자연스러운 기복을 만든다. 결과는 0..1. */
export function fbm(x, y, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
