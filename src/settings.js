export const KEY_ACTIONS = [
  { id: "up", label: "위로 이동", code: "KeyW" },
  { id: "down", label: "아래로 이동", code: "KeyS" },
  { id: "left", label: "왼쪽 이동", code: "KeyA" },
  { id: "right", label: "오른쪽 이동", code: "KeyD" },
  { id: "sprint", label: "달리기", code: "ShiftLeft" },
  { id: "draw", label: "도구 그리기", code: "KeyQ" },
  { id: "attack", label: "공격·사용", code: "Space" },
  { id: "throw", label: "일회성 도구 투척", code: "KeyT" },
  { id: "parry", label: "패링", code: "KeyP" },
  { id: "dodge", label: "회피", code: "Slash" },
  { id: "capture", label: "포획·길들이기", code: "KeyF" },
  { id: "inventory", label: "장비 가방", code: "Tab" },
  { id: "dex", label: "크리처 도감", code: "KeyC" },
  { id: "map", label: "세계 지도", code: "KeyM" },
  { id: "challenges", label: "도전과제", code: "KeyV" },
  { id: "jump", label: "점프", code: "ArrowUp" },
  { id: "wire", label: "와이어", code: "KeyE" },
  { id: "reflector", label: "반사 방벽", code: "KeyR" },
  { id: "lockOn", label: "상대 락온", code: "KeyL" }
];

export const DEFAULT_KEYMAP = Object.fromEntries(KEY_ACTIONS.map(action => [action.id, action.code]));

export function normalizePreferences(raw = {}) {
  const supplied = raw.keymap && typeof raw.keymap === "object" ? raw.keymap : {};
  const keymap = { ...DEFAULT_KEYMAP };
  const occupied = new Set();
  for (const action of KEY_ACTIONS) {
    const code = typeof supplied[action.id] === "string" ? supplied[action.id] : action.code;
    keymap[action.id] = occupied.has(code) ? action.code : code;
    occupied.add(keymap[action.id]);
  }
  return { keymap, animation: raw.animation === "limited" ? "limited" : "full" };
}

export function rebindKey(keymap, actionId, nextCode) {
  const result = { ...keymap };
  const previousCode = result[actionId];
  const conflict = Object.keys(result).find(id => id !== actionId && result[id] === nextCode);
  result[actionId] = nextCode;
  if (conflict) result[conflict] = previousCode;
  return result;
}

export function actionForCode(keymap, code) {
  return Object.keys(keymap).find(action => keymap[action] === code) ?? null;
}

export function keyLabel(code) {
  const labels = {
    Space: "Space", Tab: "Tab", ShiftLeft: "L Shift", ShiftRight: "R Shift",
    Slash: "/", Comma: ",", Period: ".",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Backspace: "Backspace", Enter: "Enter"
  };
  if (labels[code]) return labels[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/Left$|Right$/, "");
}
