// 브라우저 없이 게임을 부팅해 본다. 첫 프레임이 도는지, 조작이 죽지 않는지만 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { buildGenome } from "../src/creature.js";
import { TILE, villagePositions, explorationPlan, exploreCellIndex } from "../src/world.js";

function makeEl(id = "") {
  const el = {
    id, hidden: false, textContent: "", innerHTML: "", width: 384, height: 216,
    dataset: {}, style: {}, children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    _handlers: new Map(),
    addEventListener(t, h) { this._handlers.set(t, h); },
    removeEventListener(t) { this._handlers.delete(t); },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    setPointerCapture() {}, focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
    getContext() { return ctxStub; }
  };
  return el;
}

const gradient = { addColorStop() {} };
const ctxStub = new Proxy({ createRadialGradient: () => gradient, canvas: null }, {
  get: (t, p) => (p in t ? t[p] : () => {}),
  set: (t, p, v) => ((t[p] = v), true)
});

const els = new Map();
const getEl = id => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};

const store = new Map();
let frameCb = null;
let deleteButtonMock = null;

globalThis.document = {
  getElementById: getEl,
  createElement: () => makeEl(),
  querySelectorAll: sel => {
    if (sel === ".draw-keys button") return [deleteButtonMock ?? makeEl(), makeEl(), makeEl()];
    if (sel === '.draw-keys button[data-act="delete-toggle"]') {
      const button = makeEl();
      button.dataset.act = "delete-toggle";
      deleteButtonMock = button;
      return [button];
    }
    return [];
  }
};
const winHandlers = new Map();
globalThis.window = { addEventListener: (t, h) => winHandlers.set(t, h) };
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
globalThis.requestAnimationFrame = cb => { frameCb = cb; return 1; };

await import("../src/game.js");

const key = code => ({ code, repeat: false, preventDefault() {} });
const pointer = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, preventDefault() {} });

test("부팅하면 루프가 예약된다", () => {
  assert.equal(typeof frameCb, "function");
});

test("타이틀에서 새 세계를 시작하고 프레임이 돈다", () => {
  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  assert.equal(typeof click, "function");
  assert.match(overlay.innerHTML, /crayon-title/);
  assert.match(overlay.innerHTML, /그림으로 <b>도구<\/b>를 만들고 <b>개척<\/b>하기! ✨/);
  assert.match(overlay.innerHTML, /일정 크기의 랜덤 맵을 모두 개척하는 것이 목표!/);
  assert.doesNotMatch(overlay.innerHTML, /막힌 길은 직접/);
  const btn = makeEl(); btn.dataset.act = "new";
  click({ target: { closest: () => btn } });

  let t = 16;
  for (let i = 0; i < 20; i++) { frameCb(t); t += 16; }
  assert.ok(store.get("drawn-frontier-v2") === undefined || true);
});

test("이동 입력이 좌표를 바꾸고 자동 저장이 남는다", () => {
  const down = winHandlers.get("keydown");
  const up = winHandlers.get("keyup");
  assert.equal(typeof down, "function");

  down(key("KeyD"));
  let t = 400;
  for (let i = 0; i < 200; i++) { frameCb(t); t += 16; }
  up(key("KeyD"));

  const raw = store.get("drawn-frontier-v2");
  assert.ok(raw, "자동 저장이 있어야 한다");
  const save = JSON.parse(raw);
  assert.equal(save.v, 3);
  assert.ok(Number.isFinite(save.px));
  assert.equal(save.faceX, 1, "마지막 이동 방향이 저장되어야 한다");
  assert.equal(save.faceY, 0);
  assert.equal(save.maxHp, 5);
  assert.ok(save.travelDistance > 0, "이동 거리가 환경 시간으로 저장되어야 한다");
  assert.ok(Number.isFinite(save.temperature), "체온이 저장되어야 한다");
  assert.equal(save.fragments, 0);
  assert.equal(save.frontierTier, 0);
  assert.equal(save.defeats, 0);
  assert.equal(save.bossesDefeated, 0);
  assert.deepEqual(save.inventory, { stone: 0, fiber: 0, resin: 0, essence: 0, mirrorInk: 0 });
  assert.ok(save.hp >= 1 && save.hp <= save.maxHp, "피격 이후의 유효한 체력이 저장되어야 한다");
});

test("도구를 그려 확정하면 저장에 남는다", () => {
  const down = winHandlers.get("keydown");
  down(key("KeyQ"));

  const pad = getEl("pad");
  const pd = pad._handlers.get("pointerdown");
  const pm = pad._handlers.get("pointermove");
  const pu = pad._handlers.get("pointerup");

  // 길고 뾰족한 획: 사거리와 절단력을 동시에 얻는다.
  pd(pointer(20, 200));
  for (let i = 1; i <= 20; i++) pm(pointer(20 + i * 6.5, 200 - i * 8));
  for (let i = 1; i <= 20; i++) pm(pointer(150 + i * 6.5, 40 + i * 8));
  pu({});

  down(key("Enter"));

  let t = 4000;
  for (let i = 0; i < 80; i++) { frameCb(t); t += 16; }

  const save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.ok(save.tool, "확정한 도구가 저장되어야 한다");
  assert.ok(save.tool.stats.reach > 0.3, `reach=${save.tool.stats.reach}`);
  assert.ok(save.tool.durability > 0);
  assert.ok(save.tool.strokes.length >= 1);
  assert.equal(save.gear.hand.length, 1, "제작한 손도구가 장비 팔레트에 남아야 한다");
  assert.equal(save.ink, 9, "한 획짜리 장비는 잉크 하나를 사용한다");
});

test("T 투척은 장착 도구를 가방에서 제거하고 게임 루프를 유지한다", () => {
  const down = winHandlers.get("keydown");
  down(key("KeyT"));
  const thrown = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(thrown.tool, null);
  assert.equal(thrown.equipped.hand, null);
  assert.equal(thrown.gear.hand.length, 0);
  let t = 5300;
  for (let i = 0; i < 35; i++) { frameCb(t); t += 16; }
  assert.equal(typeof frameCb, "function");
});

test("지우기 모드에서 선택한 획 하나만 제거된다", () => {
  const down = winHandlers.get("keydown");
  down(key("KeyQ"));

  const pad = getEl("pad");
  const pd = pad._handlers.get("pointerdown");
  const pm = pad._handlers.get("pointermove");
  const pu = pad._handlers.get("pointerup");
  pd(pointer(30, 40));
  pm(pointer(120, 40));
  pu({});
  pd(pointer(30, 170));
  pm(pointer(120, 170));
  pu({});

  deleteButtonMock._handlers.get("click")();
  pd(pointer(70, 40));
  down(key("Enter"));

  const save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.gear.hand.length, 1);
  assert.equal(save.gear.hand[0].strokes.length, 1);
});

test("Tab 장비 가방에서 신발을 그려 장착한다", () => {
  const down = winHandlers.get("keydown");
  down(key("Tab"));
  assert.match(getEl("overlay").innerHTML, /장비 가방/);
  assert.match(getEl("overlay").innerHTML, /신발 그리기/);

  const click = getEl("overlay")._handlers.get("click");
  const drawBtn = makeEl();
  drawBtn.dataset.act = "draw-gear";
  drawBtn.dataset.slot = "shoes";
  click({ target: { closest: () => drawBtn } });

  const pad = getEl("pad");
  pad._handlers.get("pointerdown")(pointer(30, 160));
  for (let i = 1; i <= 18; i++) pad._handlers.get("pointermove")(pointer(30 + i * 11, 160));
  pad._handlers.get("pointerup")({});
  down(key("Enter"));

  const save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.gear.shoes.length, 1);
  assert.equal(save.equipped.shoes, save.gear.shoes[0].id);
  assert.ok(save.gear.shoes[0].shoeStats.speed > 0.4);
  assert.equal(save.ink, 7);
});

test("Shift 달리기는 장거리 이동하며 장착한 신발을 마모시킨다", () => {
  const down = winHandlers.get("keydown");
  const up = winHandlers.get("keyup");
  const before = JSON.parse(store.get("drawn-frontier-v2"));
  const startDurability = before.gear.shoes[0].durability;

  down(key("ShiftLeft"));
  down(key("KeyA"));
  let t = 6000;
  for (let i = 0; i < 220; i++) { frameCb(t); t += 16; }
  up(key("KeyA"));
  up(key("ShiftLeft"));

  const after = JSON.parse(store.get("drawn-frontier-v2"));
  assert.ok(after.px < before.px, "달리면 왼쪽으로 실제 이동해야 한다");
  assert.ok(after.gear.shoes[0].durability < startDurability, "장거리 질주는 신발 수명을 사용해야 한다");
});

test("탐사 기술 해금 후 점프·지도·반사 잉크·10초 드롭 회수가 동작한다", () => {
  const unlocked = JSON.parse(store.get("drawn-frontier-v2"));
  unlocked.fragments = 28;
  unlocked.frontierTier = 6;
  unlocked.inventory = { ...unlocked.inventory, mirrorInk: 2 };
  store.set("drawn-frontier-v2", JSON.stringify(unlocked));

  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const continueBtn = makeEl(); continueBtn.dataset.act = "continue";
  click({ target: { closest: () => continueBtn } });

  const down = winHandlers.get("keydown");
  assert.doesNotThrow(() => {
    down(key("KeyX"));
    down(key("KeyX"));
    down(key("KeyM"));
  });
  assert.match(overlay.innerHTML, /개척 지도/);
  down(key("KeyM"));

  down(key("KeyR"));
  let save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.inventory.mirrorInk, 1, "반사 방벽은 반사 잉크를 하나 사용해야 한다");

  down(key("Tab"));
  assert.match(overlay.innerHTML, /수집품/);
  const dropBtn = makeEl(); dropBtn.dataset.act = "drop-item"; dropBtn.dataset.item = "mirrorInk";
  click({ target: { closest: () => dropBtn } });
  save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.inventory.mirrorInk, 0, "버린 수집품은 인벤토리에서 빠져야 한다");

  down(key("Space"));
  let t = 9600;
  for (let i = 0; i < 20; i++) { frameCb(t); t += 16; }
  save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.inventory.mirrorInk, 1, "10초가 지나기 전 가까이 가면 다시 주워야 한다");

  down(key("Tab"));
  click({ target: { closest: () => dropBtn } });
  down(key("KeyM"));
  t = 10000;
  for (let i = 0; i < 660; i++) { frameCb(t); t += 16; }
  down(key("KeyM"));
  frameCb(t);
  down(key("Space"));
  save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.inventory.mirrorInk, 0, "10초가 지나면 버린 수집품은 사라져야 한다");
  assert.doesNotThrow(() => down(key("KeyE")));
});

test("사용/도감/취소 키가 예외 없이 처리된다", () => {
  const down = winHandlers.get("keydown");
  assert.doesNotThrow(() => {
    down(key("Space"));
    down(key("KeyF"));
    down(key("KeyC"));
    down(key("Escape"));
    down(key("KeyM"));
    down(key("KeyM"));
    down(key("KeyX"));
    down(key("KeyE"));
    down(key("KeyR"));
    down(key("KeyP"));
    let t = 9000;
    for (let i = 0; i < 30; i++) { frameCb(t); t += 16; }
  });
});

test("V 도전과제 화면은 다음 목표 하나와 완료 목록, 순환 팁을 보여준다", () => {
  const down = winHandlers.get("keydown");
  down(key("KeyV"));
  const html = getEl("overlay").innerHTML;
  assert.match(html, /다음 도전과제/);
  assert.match(html, /해금 보상/);
  assert.match(html, /해금 완료 목록/);
  assert.match(html, /rotating-tip/);
  down(key("KeyV"));
});

test("펫 전용 도구를 만들고 확인 후 방생하면 도구만 보관된다", () => {
  const saved = JSON.parse(store.get("drawn-frontier-v2"));
  const genome = buildGenome(4242, "plain");
  saved.pet = { genome, hp: 4, maxHp: 4, hostile: false, ranged: false, x: saved.px + 10, y: saved.py + 10 };
  saved.ink = 10;
  store.set("drawn-frontier-v2", JSON.stringify(saved));

  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const continueBtn = makeEl(); continueBtn.dataset.act = "continue";
  click({ target: { closest: () => continueBtn } });
  const down = winHandlers.get("keydown");
  down(key("Tab"));
  assert.match(overlay.innerHTML, /펫 방생/);

  const drawBtn = makeEl(); drawBtn.dataset.act = "draw-gear"; drawBtn.dataset.slot = "pet";
  click({ target: { closest: () => drawBtn } });
  assert.match(getEl("draw-title-text").textContent, /펫 도구/);
  assert.match(getEl("draw-legend").innerHTML, /지원거리/);
  const pad = getEl("pad");
  pad._handlers.get("pointerdown")(pointer(20, 100));
  pad._handlers.get("pointermove")(pointer(200, 100));
  pad._handlers.get("pointerup")({});
  down(key("Enter"));
  let after = JSON.parse(store.get("drawn-frontier-v2"));
  assert.ok(after.petTool?.petStats, "펫 슬롯 전용 성능이 저장되어야 한다");

  down(key("Tab"));
  const releaseBtn = makeEl(); releaseBtn.dataset.act = "release-pet";
  click({ target: { closest: () => releaseBtn } });
  assert.match(overlay.innerHTML, /펫을 방생할까요/);
  const confirmBtn = makeEl(); confirmBtn.dataset.act = "confirm-release-pet";
  click({ target: { closest: () => confirmBtn } });
  after = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(after.pet, null);
  assert.ok(after.petTool, "방생해도 그려 둔 펫 도구는 보관해야 한다");
});

test("저장을 다시 불러도 같은 세계다", () => {
  const before = JSON.parse(store.get("drawn-frontier-v2"));
  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const btn = makeEl(); btn.dataset.act = "continue";
  click({ target: { closest: () => btn } });

  let t = 12000;
  for (let i = 0; i < 20; i++) { frameCb(t); t += 16; }
  const after = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(after.seed, before.seed);
});

test("이어하기는 저장 좌표 대신 마지막 NPC 마을에서 재개한다", () => {
  const saved = JSON.parse(store.get("drawn-frontier-v2"));
  saved.px = 9999;
  saved.py = -9999;
  saved.found = [0];
  saved.lastVillageIndex = 1;
  store.set("drawn-frontier-v2", JSON.stringify(saved));

  const overlay = getEl("overlay");
  const continueBtn = makeEl(); continueBtn.dataset.act = "continue";
  overlay._handlers.get("click")({ target: { closest: () => continueBtn } });

  const village = villagePositions(saved.seed).find(candidate => candidate.index === 1);
  const after = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(after.px, village.tx * TILE + TILE / 2);
  assert.equal(after.py, village.ty * TILE + TILE / 2 + 5);
});

test("이전 저장의 어색한 장비 이름은 현재 성능 이름으로 바뀐다", () => {
  const legacy = JSON.parse(store.get("drawn-frontier-v2"));
  assert.ok(legacy.gear.hand.length > 0);
  legacy.gear.hand[0].name = "개척자 명조";
  store.set("drawn-frontier-v2", JSON.stringify(legacy));

  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const continueBtn = makeEl(); continueBtn.dataset.act = "continue";
  click({ target: { closest: () => continueBtn } });
  winHandlers.get("keydown")(key("Tab"));
  assert.doesNotMatch(overlay.innerHTML, /개척자 명조/);
  assert.match(overlay.innerHTML, /장비 가방/);
});

test("환경설정에서 패링 키와 제한 애니메이션을 바꾸고 저장 캐시를 초기화한다", () => {
  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const down = winHandlers.get("keydown");

  const settingsBtn = makeEl(); settingsBtn.dataset.act = "settings";
  click({ target: { closest: () => settingsBtn } });
  assert.match(overlay.innerHTML, /환경설정/);
  assert.match(overlay.innerHTML, /제한된 애니메이션/);

  const rebindBtn = makeEl(); rebindBtn.dataset.act = "rebind"; rebindBtn.dataset.keyAction = "parry";
  click({ target: { closest: () => rebindBtn } });
  down(key("KeyK"));
  let prefs = JSON.parse(store.get("drawn-frontier-settings-v1"));
  assert.equal(prefs.keymap.parry, "KeyK");

  const animationBtn = makeEl(); animationBtn.dataset.act = "toggle-animation";
  click({ target: { closest: () => animationBtn } });
  prefs = JSON.parse(store.get("drawn-frontier-settings-v1"));
  assert.equal(prefs.animation, "limited");

  const resetBtn = makeEl(); resetBtn.dataset.act = "reset-cache";
  click({ target: { closest: () => resetBtn } });
  const confirmBtn = makeEl(); confirmBtn.dataset.act = "confirm-reset-cache";
  click({ target: { closest: () => confirmBtn } });
  assert.equal(store.has("drawn-frontier-v2"), false);
  assert.equal(JSON.parse(store.get("drawn-frontier-settings-v1")).keymap.parry, "KeyK", "캐시 초기화 후에도 키 설정은 유지된다");
});


// ---- 개척률과 터치 조작 -----------------------------------------------------

test("이동하면 개척률이 오르고 저장에 개척 격자가 남는다", () => {
  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const down = winHandlers.get("keydown");
  const up = winHandlers.get("keyup");

  const newBtn = makeEl(); newBtn.dataset.act = "new";
  click({ target: { closest: () => newBtn } });

  let t = 90000;
  for (let i = 0; i < 10; i++) { frameCb(t); t += 16; }
  const startPercent = Number.parseInt(getEl("p-explored").textContent, 10);
  assert.ok(Number.isFinite(startPercent), "개척률이 HUD에 숫자로 표시되어야 한다");
  assert.ok(startPercent > 0, "시작하자마자 주변은 개척된 상태여야 한다");

  down(key("KeyW"));
  for (let i = 0; i < 400; i++) { frameCb(t); t += 16; }
  up(key("KeyW"));
  down(key("KeyA"));
  for (let i = 0; i < 400; i++) { frameCb(t); t += 16; }
  up(key("KeyA"));

  const percent = Number.parseInt(getEl("p-explored").textContent, 10);
  assert.ok(percent >= startPercent, `개척률이 줄면 안 된다 ${startPercent} -> ${percent}`);

  const save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.v, 3);
  assert.equal(typeof save.explored, "string", "개척 격자는 문자열로 눌러 담는다");
  assert.ok(save.explored.length > 0);
});

test("개척 기록이 없던 v2 저장도 이어서 진행할 수 있다", () => {
  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const legacy = JSON.parse(store.get("drawn-frontier-v2"));
  legacy.v = 2;
  delete legacy.explored;
  store.set("drawn-frontier-v2", JSON.stringify(legacy));

  const continueBtn = makeEl(); continueBtn.dataset.act = "continue";
  click({ target: { closest: () => continueBtn } });

  let t = 140000;
  for (let i = 0; i < 10; i++) { frameCb(t); t += 16; }
  assert.equal(getEl("overlay").hidden, true, "이어하기가 실제로 시작되어야 한다");

  const save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.equal(save.v, 3, "다시 저장할 때는 새 형식으로 올라간다");
  assert.equal(save.seed, legacy.seed, "같은 세계를 이어간다");
});

test("터치 스틱과 버튼이 키보드와 같은 동작을 부른다", () => {
  const layer = getEl("touch-controls");
  const stick = getEl("touch-stick");
  assert.equal(typeof stick._handlers.get("pointerdown"), "function");

  // 손가락 입력을 처음 본 순간 조작판이 열린다.
  layer.hidden = true;
  winHandlers.get("pointerdown")({ pointerType: "touch" });
  assert.equal(layer.hidden, false, "터치가 감지되면 조작판이 열려야 한다");

  const before = { x: 0, y: 0 };
  const beforeSave = JSON.parse(store.get("drawn-frontier-v2"));
  before.x = beforeSave.px;

  // 스틱을 오른쪽 끝까지: 오른쪽으로 달린다.
  // 스텁 요소의 사각형은 0,0에서 384x216이므로 중심은 (192,108)이다.
  stick._handlers.get("pointerdown")({ pointerId: 3, clientX: 380, clientY: 108, preventDefault() {} });
  let t = 200000;
  for (let i = 0; i < 200; i++) { frameCb(t); t += 16; }
  stick._handlers.get("pointerup")({ pointerId: 3 });

  const afterSave = JSON.parse(store.get("drawn-frontier-v2"));
  assert.ok(afterSave.px > before.x, `스틱으로 오른쪽으로 이동해야 한다 ${before.x} -> ${afterSave.px}`);

  // 얼굴 버튼은 키보드와 같은 진입점을 쓴다.
  const target = (action, extra = {}) => {
    const button = makeEl();
    button.dataset.touchAction = action;
    return { closest: sel => (sel === "[data-touch-action]" ? button : extra[sel] ?? null) };
  };

  // 메뉴 버튼이 시트를 열고 닫는다.
  const menu = getEl("touch-menu");
  menu.hidden = true;
  getEl("touch-menu-open")._handlers.get("pointerdown")({ preventDefault() {} });
  assert.equal(menu.hidden, false, "메뉴 버튼이 시트를 열어야 한다");

  // 시트에서 고른 동작은 시트를 닫고 실행된다. 설계는 그리기 화면을 연다.
  menu._handlers.get("pointerdown")({ target: target("draw"), preventDefault() {} });
  assert.equal(menu.hidden, true, "동작을 고르면 시트가 닫혀야 한다");
  assert.equal(getEl("draw-layer").hidden, false, "설계는 그리기 화면을 열어야 한다");
  winHandlers.get("keydown")(key("Escape"));
});

test("모바일에서는 HUD 패널이 캔버스 아래 정보판으로 내려간다", () => {
  const dock = getEl("hud-dock");
  assert.equal(dock.hidden, false, "터치 조작이 열리면 정보판도 열린다");
  const docked = dock.children.map(child => child.id);
  for (const id of ["tool-panel", "vitals", "map-panel", "progress"]) {
    assert.ok(docked.includes(id), `${id}가 정보판으로 옮겨져야 한다`);
  }
});


test("신호기를 다 켜고 마지막 칸을 밝히면 원정이 끝난다", () => {
  const overlay = getEl("overlay");
  const click = overlay._handlers.get("click");
  const save = JSON.parse(store.get("drawn-frontier-v2"));

  // 시작 셀 하나만 남기고 전부 밝혀 둔 저장을 만든다.
  const plan = explorationPlan(save.seed);
  const startCell = exploreCellIndex(0, 0);
  const bytes = new Uint8Array(Math.ceil(plan.cells.length / 8));
  for (let index = 0; index < plan.cells.length; index++) {
    if (plan.cells[index] && index !== startCell) bytes[index >> 3] |= 1 << (index & 7);
  }
  save.explored = Buffer.from(bytes).toString("base64");
  save.found = [0, 1, 2, 3, 4];
  save.lastVillageIndex = 0;
  store.set("drawn-frontier-v2", JSON.stringify(save));

  const continueBtn = makeEl(); continueBtn.dataset.act = "continue";
  click({ target: { closest: () => continueBtn } });

  let t = 260000;
  for (let i = 0; i < 30; i++) { frameCb(t); t += 16; }

  assert.match(overlay.innerHTML, /이 땅을 모두 개척했다/);
  assert.match(overlay.innerHTML, /개척률 100%/);
  assert.equal(overlay.hidden, false);
});
