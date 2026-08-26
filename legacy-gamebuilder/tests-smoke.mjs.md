import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const listeners = new Map();
const canvasListeners = new Map();
const storage = new Map();
let scheduledFrame = null;

const gradient = { addColorStop() {} };
const context = new Proxy({
  createRadialGradient() { return gradient; }
}, {
  get(target, property) {
    if (property in target) return target[property];
    return () => {};
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  }
});

const canvas = {
  width: 384,
  height: 216,
  getContext() { return context; },
  getBoundingClientRect() { return { left: 0, top: 0, width: 384, height: 216 }; },
  addEventListener(type, handler) { canvasListeners.set(type, handler); },
  setPointerCapture() {},
  focus() {}
};

globalThis.document = { getElementById() { return canvas; } };
globalThis.window = {
  addEventListener(type, handler) { listeners.set(type, handler); }
};
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
globalThis.requestAnimationFrame = handler => {
  scheduledFrame = handler;
  return 1;
};

const source = readFileSync(new URL("../game.js", import.meta.url), "utf8")
  .replace(/\}\)\(\);\s*$/, `
    globalThis.__gameTest = {
      state, player, creatures, wildlife, discoverRegion, updateCreature, damageCreature, loadGame,
      syncHeldToolToFacing, handleToolDirection, updateTool, plantTool, lockSecondAnchor, startToolReturn
    };
  })();`);
vm.runInThisContext(source, { filename: "game.js" });

assert.equal(typeof scheduledFrame, "function", "game loop should be scheduled");
scheduledFrame(16);

const keydown = listeners.get("keydown");
const keyup = listeners.get("keyup");
assert.equal(typeof keydown, "function", "keyboard input should be registered");
assert.equal(typeof keyup, "function", "keyboard release should be registered");

const keyEvent = code => ({ code, repeat: false, preventDefault() {} });
keydown(keyEvent("Enter"));
scheduledFrame(32);
scheduledFrame(48);

const rawSave = storage.get("drawn-frontier-save-v1");
assert.ok(rawSave, "starting a new world should create an autosave");
const save = JSON.parse(rawSave);
assert.equal(save.version, 1);
assert.equal(save.discovered.length, 1);
assert.equal(save.regionEvents.length, 6, "a world should contain one event for each region");
assert.ok(Number.isInteger(save.seed) && save.seed > 0);

keydown(keyEvent("Escape"));
scheduledFrame(64);
keydown(keyEvent("Enter"));
keyup(keyEvent("Enter"));
scheduledFrame(80);

assert.ok(storage.get("drawn-frontier-save-v1"), "pause/resume should preserve the save");

// Return to title through the pause menu, then exercise the continue path.
keydown(keyEvent("Escape"));
keydown(keyEvent("ArrowDown"));
keydown(keyEvent("ArrowDown"));
keydown(keyEvent("Enter"));
scheduledFrame(96);
keydown(keyEvent("Enter"));
scheduledFrame(112);
assert.equal(JSON.parse(storage.get("drawn-frontier-save-v1")).seed, save.seed, "continue should restore the same world seed");

// Walk to the first discovery shrine, wait for the drawing surface, draw a
// tool, and verify that its physical body is persisted.
let now = 112;
keydown(keyEvent("KeyD"));
for (let i = 0; i < 92; i++) {
  now += 33;
  scheduledFrame(now);
}
keyup(keyEvent("KeyD"));
for (let i = 0; i < 30; i++) {
  now += 33;
  scheduledFrame(now);
}

const pointerdown = canvasListeners.get("pointerdown");
const pointermove = canvasListeners.get("pointermove");
const pointerup = canvasListeners.get("pointerup");
assert.equal(typeof pointerdown, "function");
assert.equal(typeof pointermove, "function");
assert.equal(typeof pointerup, "function");
const pointer = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" });
pointerdown(pointer(105, 122));
for (let i = 1; i <= 18; i++) pointermove(pointer(105 + i * 9, 122 - i * 2));
pointerup();
pointerdown(pointer(300, 174));

const toolSave = JSON.parse(storage.get("drawn-frontier-save-v1"));
assert.ok(toolSave.tool, "confirming a drawn tool should persist the tool body");
assert.ok(toolSave.tool.segments.length >= 1);
assert.ok(toolSave.tool.points.length > 2, "the drawn silhouette should survive saving");

// Put a saved explorer at camp with event ink. Cancelling redesign must restore
// the existing body; confirming redesign must consume exactly one ink.
keydown(keyEvent("Escape"));
keydown(keyEvent("ArrowDown"));
keydown(keyEvent("ArrowDown"));
keydown(keyEvent("Enter"));
const campSave = JSON.parse(storage.get("drawn-frontier-save-v1"));
campSave.player.x = 135;
campSave.player.y = 350;
campSave.ink = 2;
storage.set("drawn-frontier-save-v1", JSON.stringify(campSave));
keydown(keyEvent("Enter"));
now += 33;
scheduledFrame(now);

keydown(keyEvent("KeyR"));
keyup(keyEvent("KeyR"));
keydown(keyEvent("Escape"));
keydown(keyEvent("Escape"));
const cancelledSave = JSON.parse(storage.get("drawn-frontier-save-v1"));
assert.deepEqual(cancelledSave.tool.segments, campSave.tool.segments, "cancel should restore the previous tool body");
assert.equal(cancelledSave.ink, 2, "cancel should not spend ink");
keydown(keyEvent("Enter"));

keydown(keyEvent("KeyR"));
keyup(keyEvent("KeyR"));
pointerdown(pointer(90, 135));
for (let i = 1; i <= 20; i++) pointermove(pointer(90 + i * 10, 135 - i * 4));
pointerup();
pointerdown(pointer(300, 174));
const redesignedSave = JSON.parse(storage.get("drawn-frontier-save-v1"));
assert.equal(redesignedSave.ink, 1, "confirming a redesign should spend one ink");
assert.notDeepEqual(redesignedSave.tool.segments, campSave.tool.segments, "redesign should replace the tool body");

// Drive the metagame through its public gameplay transitions. Map discovery,
// bonding and breaking both threats must converge on the ending state.
const api = globalThis.__gameTest;
assert.equal(api.wildlife.length, 12, "seeded regions should populate a small ambient ecosystem");
api.player.dirX = 0;
api.player.dirY = -1;
api.state.tool.mode = "idle";
api.syncHeldToolToFacing();
assert.equal(api.state.tool.targetIndex, 6, "an idle held tool should snap to the live facing direction");
api.handleToolDirection(0);
assert.equal(api.state.tool.mode, "swing", "a perpendicular direction should start a quick swing");
for (let i = 0; i < 12; i++) api.updateTool(0.033);
assert.equal(api.state.tool.mode, "idle", "a quick swing should return to idle automatically");
assert.equal(api.state.tool.targetIndex, 6, "a completed swing should return in front of the explorer");
api.handleToolDirection(2);
assert.equal(api.state.tool.mode, "ready", "the backward direction should enter the charged stance");
api.handleToolDirection(6);
assert.equal(api.state.tool.mode, "strongSwing", "pressing forward from ready should release the strong swing");
assert.equal(api.state.tool.routeSign, -1, "the strong swing should use the authored counter-clockwise route");
for (let i = 0; i < 16; i++) api.updateTool(0.033);
assert.equal(api.state.tool.mode, "idle");

api.state.tool.jointTs = [0.3, 0.65];
api.state.tool.segments = [14, 14, 14];
api.state.tool.jointAngles = [0, 0];
api.state.tool.jointVels = [0, 0];
api.plantTool();
api.lockSecondAnchor();
assert.ok(api.state.tool.qAnchor, "a two-DOF tool should accept its second anchor");
api.startToolReturn();
assert.equal(api.state.tool.mode, "returning", "E recovery should release both anchors and start the return path");
for (let i = 0; i < 16; i++) api.updateTool(0.033);
assert.equal(api.state.tool.mode, "idle");

api.state.mode = "playing";
keydown(keyEvent("KeyA"));
keydown(keyEvent("ShiftLeft"));
for (let i = 0; i < 2500; i++) {
  now += 33;
  scheduledFrame(now);
}
assert.ok(api.state.particles.length < 160, "short-lived particles should remain bounded during a long run");
assert.ok(api.state.afterimages.length < 12, "run afterimages should be retired instead of accumulating");
listeners.get("blur")();
assert.equal(Object.keys(api.state.keys).length, 0, "losing focus should release held controls");
for (const key of Object.keys(api.state.regionKinds)) api.discoverRegion(key);
const moss = api.creatures.find(creature => creature.id === "moss");
api.player.x = moss.x;
api.player.y = moss.y;
api.updateCreature(moss, 0.033);
assert.equal(api.state.allyJoined, true, "approaching the village companion should form a bond");
for (const creature of api.creatures.filter(creature => creature.baseHostile)) {
  creature.weak = true;
  creature.neutral = false;
  creature.hostile = true;
  api.damageCreature(creature, creature.x - 20, creature.y, 300);
}
assert.equal(api.state.victory, true, "all three metagame goals should complete the run");
assert.equal(api.state.mode, "ending", "victory should open the ending screen");
assert.equal(JSON.parse(storage.get("drawn-frontier-save-v1")).victory, true, "the cleared run should be persisted");

const outOfBoundsSave = JSON.parse(storage.get("drawn-frontier-save-v1"));
outOfBoundsSave.discovered.push("99,99");
outOfBoundsSave.tool.segments = [-10, 999, "bad"];
outOfBoundsSave.tool.jointTs = [-2, 3];
storage.set("drawn-frontier-save-v1", JSON.stringify(outOfBoundsSave));
assert.equal(api.loadGame(), true);
assert.equal(api.state.discovered.has("99,99"), false, "unknown region keys should be discarded while loading");
assert.deepEqual(api.state.tool.segments, [6, 42], "tool geometry should be clamped to renderable bounds");
assert.deepEqual(api.state.tool.jointTs, [0.1, 0.9], "saved joints should remain inside the drawn body");

const interruptedDrawingSave = JSON.parse(storage.get("drawn-frontier-save-v1"));
interruptedDrawingSave.tool = null;
interruptedDrawingSave.shrineFound = true;
interruptedDrawingSave.player.dirX = 0;
interruptedDrawingSave.player.dirY = -1;
storage.set("drawn-frontier-save-v1", JSON.stringify(interruptedDrawingSave));
assert.equal(api.loadGame(), true);
assert.ok(api.state.drawingDelay > 0, "an interrupted first drawing should resume after loading");
assert.ok(Math.abs(api.player.dirX) < 0.001 && api.player.dirY < -0.99, "cardinal facing should survive saving and loading");

storage.set("drawn-frontier-save-v1", "{broken-save");
assert.equal(api.loadGame(), false, "a malformed save should fail safely instead of crashing the game");

console.log("game smoke test passed");
