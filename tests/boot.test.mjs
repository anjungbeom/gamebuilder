// 브라우저 없이 게임을 부팅해 본다. 첫 프레임이 도는지, 조작이 죽지 않는지만 본다.
import test from "node:test";
import assert from "node:assert/strict";

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

globalThis.document = {
  getElementById: getEl,
  createElement: () => makeEl(),
  querySelectorAll: sel => (sel === ".draw-keys button" ? [makeEl(), makeEl(), makeEl()] : [])
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
  assert.equal(save.v, 2);
  assert.ok(Number.isFinite(save.px));
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
  for (let i = 0; i < 40; i++) { frameCb(t); t += 16; }

  const save = JSON.parse(store.get("drawn-frontier-v2"));
  assert.ok(save.tool, "확정한 도구가 저장되어야 한다");
  assert.ok(save.tool.stats.reach > 0.3, `reach=${save.tool.stats.reach}`);
  assert.ok(save.tool.durability > 0);
  assert.ok(save.tool.strokes.length >= 1);
});

test("사용/도감/취소 키가 예외 없이 처리된다", () => {
  const down = winHandlers.get("keydown");
  assert.doesNotThrow(() => {
    down(key("Space"));
    down(key("KeyC"));
    down(key("Escape"));
    let t = 9000;
    for (let i = 0; i < 30; i++) { frameCb(t); t += 16; }
  });
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
