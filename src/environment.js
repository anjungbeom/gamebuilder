// 이동한 거리를 기준으로 낮밤과 날씨를 재현한다. 가만히 있으면 환경 시간도 멈춘다.

import { clamp, hashUnit } from "./rng.js";
import { BIOME } from "./world.js";

export const DAY_DISTANCE = 180;
export const WEATHER_DISTANCE = 42;

const WEATHER = [
  { key: "clear", name: "맑음", temp: 1, noise: 1 },
  { key: "wind", name: "강풍", temp: -2, noise: .68 },
  { key: "rain", name: "비", temp: -4, noise: 0.72 },
  { key: "fog", name: "옅은 안개", temp: -1, noise: 0.88 },
  { key: "heat", name: "건조한 열기", temp: 5, noise: 1.08 }
];

const BIOME_TEMP = {
  [BIOME.SAND]: 27,
  [BIOME.PLAIN]: 18,
  [BIOME.GRASS]: 17,
  [BIOME.FOREST]: 14,
  [BIOME.ROCK]: 9,
  [BIOME.WATER]: 12,
  [BIOME.DEEP]: 9
};

export function environmentAt(seed, travelDistance, biome = BIOME.PLAIN) {
  const dayPhase = ((travelDistance % DAY_DISTANCE) + DAY_DISTANCE) % DAY_DISTANCE / DAY_DISTANCE;
  const daylight = clamp((Math.sin(dayPhase * Math.PI * 2 - Math.PI / 2) + 1) / 2, 0, 1);
  const period = dayPhase < .18 ? "새벽" : dayPhase < .48 ? "낮" : dayPhase < .64 ? "해질녘" : "밤";
  const weatherSlot = Math.floor(travelDistance / WEATHER_DISTANCE);
  const weather = WEATHER[Math.floor(hashUnit(weatherSlot, seed, 45077) * WEATHER.length)];
  const nightDelta = (daylight - .5) * 10;
  const targetTemperature = (BIOME_TEMP[biome] ?? 17) + weather.temp + nightDelta;
  return { dayPhase, daylight, period, weatherSlot, weather, targetTemperature };
}

export function thermalState(temperature) {
  if (temperature <= 7) return { key: "cold", name: "추움", speed: .88, noise: .9 };
  if (temperature >= 29) return { key: "hot", name: "더움", speed: .9, noise: 1.18 };
  return { key: "comfortable", name: "쾌적", speed: 1, noise: 1 };
}

export function noiseLabel(noise) {
  if (noise < .2) return "조용함";
  if (noise < .55) return "보통";
  if (noise < .82) return "시끄러움";
  return "매우 시끄러움";
}
