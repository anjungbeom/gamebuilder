(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const WORLD = { w: 920, h: 560 };
  const TAU = Math.PI * 2;
  const SAVE_KEY = "drawn-frontier-save-v1";
  const SAVE_VERSION = 1;
  const REGION_TOTAL = 6;
  const REGION_KIND_COLORS = {
    camp: "#ffe071",
    village: "#ff8d55",
    grove: "#8bd25f",
    ruins: "#a8bbc0",
    spring: "#55c7e8",
    nest: "#ff5964"
  };

  ctx.imageSmoothingEnabled = false;

  const palette = {
    sky: "#7bc6b5",
    ground: "#71b96d",
    ground2: "#82c979",
    ground3: "#62a763",
    dark: "#183b43",
    ink: "#24d6c0",
    ink2: "#d5fff1",
    gold: "#ffe071",
    orange: "#ff8d55",
    red: "#ff5964",
    white: "#fffce8",
    blue: "#55c7e8",
    purple: "#b68cff",
    leaf: "#8bd25f",
    mud: "#9b7651"
  };

  const TOOL_FORMS = [
    { id: "spear", color: "#fff3b0", tip: "point" },
    { id: "hammer", color: "#ff9b62", tip: "block" },
    { id: "hook", color: "#73e0d1", tip: "hook" },
    { id: "blade", color: "#8fd8ff", tip: "blade" },
    { id: "fan", color: "#dda5ff", tip: "fan" },
    { id: "claw", color: "#ffe071", tip: "claw" }
  ];

  // Eight authored screen views. Grip positions are relative to the projected
  // waist so the tool stays attached to the visible leading hand.
  const PLAYER_VIEWS = [
    { id: "east", dx: 1, dy: 0, grip: { x: 6, y: 0 }, face: "side" },
    { id: "south-east", dx: 1, dy: 1, grip: { x: 5, y: 2 }, face: "front-side" },
    { id: "south", dx: 0, dy: 1, grip: { x: 3, y: 3 }, face: "front" },
    { id: "south-west", dx: -1, dy: 1, grip: { x: -5, y: 2 }, face: "front-side" },
    { id: "west", dx: -1, dy: 0, grip: { x: -6, y: 0 }, face: "side" },
    { id: "north-west", dx: -1, dy: -1, grip: { x: -5, y: -1 }, face: "back-side" },
    { id: "north", dx: 0, dy: -1, grip: { x: -3, y: -2 }, face: "back" },
    { id: "north-east", dx: 1, dy: -1, grip: { x: 5, y: -1 }, face: "back-side" }
  ];

  const state = {
    started: false,
    mode: "title",
    menuIndex: 0,
    pauseIndex: 0,
    saveExists: false,
    savePulse: 0,
    worldSeed: 1,
    playSeconds: 0,
    autosaveClock: 0,
    reputation: 0,
    ink: 0,
    unlockedTools: 1,
    victory: false,
    toast: null,
    regionKinds: Object.create(null),
    regionEvents: Object.create(null),
    time: 22,
    last: performance.now(),
    hitstop: 0,
    shake: 0,
    flash: 0,
    hurtFlash: 0,
    moved: false,
    attacked: false,
    toolMoved: false,
    keyboardAimTimer: 0,
    drawing: false,
    redrawing: false,
    drawBackup: null,
    drawingDelay: 0,
    drawPoints: [],
    drawActive: false,
    toolBuilt: false,
    toolPaletteOpen: false,
    tool: {
      maxDof: 2,
      jointTs: [],
      segments: [30],
      jointAngles: [],
      jointVels: [],
      points: [],
      hand: 0,
      aimIndex: 0,
      targetIndex: 0,
      angle: 0,
      angularVelocity: 0,
      routeSign: 1,
      routeSteps: 0,
      planted: false,
      plantX: 0,
      plantY: 0,
      tipX: 0,
      tipY: 0,
      prevTipX: 0,
      prevTipY: 0,
      sweepCooldown: 0,
      formIndex: 0,
      mode: "idle",
      modeTimer: 0,
      swingSide: 1,
      swingReturning: false,
      charge: 0,
      chargePower: 0,
      reachScale: 1,
      attackStep: 0,
      attackDuration: 0,
      attackQueued: false,
      attackHitIds: new Set(),
      attackWhoosh: false,
      comboGrace: 0,
      qAnchor: null,
      returnHitIds: new Set(),
      returnTrail: []
    },
    shrineFound: false,
    allyJoined: false,
    particles: [],
    rings: [],
    slashes: [],
    windArcs: [],
    afterimages: [],
    discovered: new Set(["0,1"]),
    currentRegion: "0,1",
    camera: { x: 150, y: 300, zoom: 1 },
    keys: Object.create(null),
    pointer: { x: W / 2, y: H / 2, down: false, aiming: false, touchMove: false, ox: 0, oy: 0, dx: 0, dy: 0 }
  };

  const player = {
    x: 115,
    y: 300,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    dirX: 1,
    dirY: 0,
    moveTime: 0,
    foot: 0,
    attack: 0,
    attackHit: false,
    health: 5,
    invuln: 0,
    bob: 0,
    stamina: 100,
    staminaDelay: 0,
    rollTimer: 0,
    rollDuration: 0.42,
    rollX: 0,
    rollY: 0,
    lockTargetId: null
  };

  function creature(id, x, y, colors, hostile = true) {
    return {
      id,
      x,
      y,
      homeX: x,
      homeY: y,
      vx: 0,
      vy: 0,
      dirX: -1,
      dirY: 0,
      colors,
      hostile,
      baseHostile: hostile,
      ally: !hostile,
      joined: false,
      neutral: false,
      joints: [true, true, true],
      jointFlash: [0, 0, 0],
      attackCooldown: 0.4 + Math.random() * 0.4,
      attackPulse: 0,
      hurt: 0,
      step: Math.random() * TAU,
      target: null,
      armorSide: id === "bramble" ? 1 : id === "ember" ? -1 : 0,
      weak: false,
      hitCooldown: 0,
      attackState: "idle",
      attackTimer: 0
    };
  }

  const creatures = [
    creature("bramble", 425, 300, ["#bc704d", "#e49a5f", "#7b443d"], true),
    creature("moss", 600, 258, ["#57a96b", "#8ee28a", "#35675a"], false),
    creature("ember", 700, 282, ["#b8575b", "#ef7d69", "#713b53"], true)
  ];

  const shrine = { x: 245, y: 296 };
  const grass = [];
  const stones = [];
  const flowers = [];
  const trees = [];
  const wildlife = [];
  let audio = null;

  function hash(x, y, z = 0) {
    let n = Math.imul(x + z * 131 + state.worldSeed * 17, 374761393) + Math.imul(y - z * 17 - state.worldSeed * 7, 668265263);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function generateWorld(seed) {
    state.worldSeed = Math.max(1, Math.floor(seed) || 1);
    grass.length = 0;
    stones.length = 0;
    flowers.length = 0;
    trees.length = 0;
    for (let y = 18; y < WORLD.h; y += 22) {
      for (let x = 18; x < WORLD.w; x += 24) {
        const n = hash(x, y);
        if (n > 0.62) grass.push({ x: x + hash(x, y, 1) * 14, y: y + hash(x, y, 2) * 12, type: n > 0.88 ? 1 : 0 });
        if (n < 0.055) stones.push({ x: x + 5, y: y + 7, s: 2 + hash(x, y, 3) * 3 });
        const f = hash(x, y, 8);
        if (f > 0.88) flowers.push({ x: x + f * 12, y: y + hash(x, y, 9) * 13, color: Math.floor(hash(x, y, 10) * 4) });
        const t = hash(x, y, 12);
        if (t > 0.982 && (x < 545 || x > 710)) trees.push({ x: x + 8, y: y + 8, crown: Math.floor(hash(x, y, 13) * 3) });
      }
    }
    const regionKinds = Object.create(null);
    regionKinds["0,1"] = "camp";
    regionKinds["1,0"] = "village";
    regionKinds["2,1"] = "nest";
    const remainingRegions = ["0,0", "2,0", "1,1"]
      .sort((a, b) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return hash(ax, ay, 91) - hash(bx, by, 91);
    });
    const remainingKinds = ["grove", "ruins", "spring"];
    for (let i = 0; i < remainingRegions.length; i++) regionKinds[remainingRegions[i]] = remainingKinds[i];
    state.regionKinds = regionKinds;
    buildRegionEvents();
    generateWildlife();
  }

  function regionLandmarkPosition(key, kind = state.regionKinds[key]) {
    const [cx, cy] = key.split(",").map(Number);
    let x = (cx + 0.5) * (WORLD.w / 3);
    let y = (cy + 0.5) * (WORLD.h / 2);
    if (kind === "camp") { x = 135; y = 350; }
    if (kind === "village") { x = 600; y = 250; }
    if (kind === "nest") { x = 730; y = 300; }
    return { x, y };
  }

  function buildRegionEvents() {
    const events = Object.create(null);
    for (const [key, kind] of Object.entries(state.regionKinds)) {
      const position = regionLandmarkPosition(key, kind);
      events[key] = {
        key,
        kind,
        x: position.x,
        y: position.y,
        status: kind === "camp" ? "complete" : "hidden",
        progress: kind === "camp" ? 1 : 0,
        cooldown: 0
      };
    }
    state.regionEvents = events;
  }

  function generateWildlife() {
    wildlife.length = 0;
    const colors = {
      camp: ["#f0c96b", "#fff2aa"],
      village: ["#e87569", "#ffe071"],
      grove: ["#4e9e55", "#b4e76d"],
      ruins: ["#71828b", "#d3e2d7"],
      spring: ["#389eb2", "#b6f1df"],
      nest: ["#8f4654", "#ff8d55"]
    };
    for (const [key, kind] of Object.entries(state.regionKinds)) {
      const [cx, cy] = key.split(",").map(Number);
      const count = kind === "village" ? 3 : kind === "camp" ? 1 : 2;
      for (let i = 0; i < count; i++) {
        let x = (cx + 0.18 + hash(cx, cy, 120 + i) * 0.64) * (WORLD.w / 3);
        const y = (cy + 0.2 + hash(cx, cy, 140 + i) * 0.6) * (WORLD.h / 2);
        if (x > 500 && x < 568) x += x < 534 ? -58 : 58;
        wildlife.push({
          id: `${key}-${i}`,
          regionKey: key,
          kind,
          x, y,
          homeX: x,
          homeY: y,
          vx: 0,
          vy: 0,
          dirX: hash(cx, cy, 160 + i) > 0.5 ? 1 : -1,
          dirY: 0,
          phase: hash(cx, cy, 180 + i) * TAU,
          shape: Math.floor(hash(cx, cy, 200 + i) * 3),
          scale: 0.8 + hash(cx, cy, 220 + i) * 0.35,
          colors: colors[kind]
        });
      }
    }
  }
  generateWorld(state.worldSeed);

  function refreshSaveExists() {
    try {
      state.saveExists = Boolean(localStorage.getItem(SAVE_KEY));
    } catch {
      state.saveExists = false;
    }
  }

  function resetToolState() {
    Object.assign(state.tool, {
      jointTs: [],
      segments: [30],
      jointAngles: [],
      jointVels: [],
      points: [],
      hand: 0,
      aimIndex: 0,
      targetIndex: 0,
      angle: 0,
      angularVelocity: 0,
      routeSign: 1,
      routeSteps: 0,
      planted: false,
      plantX: 0,
      plantY: 0,
      tipX: 0,
      tipY: 0,
      prevTipX: 0,
      prevTipY: 0,
      sweepCooldown: 0,
      formIndex: 0,
      mode: "idle",
      modeTimer: 0,
      swingSide: 1,
      swingReturning: false,
      charge: 0,
      chargePower: 0,
      reachScale: 1,
      attackStep: 0,
      attackDuration: 0,
      attackQueued: false,
      attackHitIds: new Set(),
      attackWhoosh: false,
      comboGrace: 0,
      qAnchor: null,
      returnHitIds: new Set(),
      returnTrail: []
    });
  }

  function resetCreatures() {
    for (const c of creatures) {
      c.x = c.homeX;
      c.y = c.homeY;
      c.vx = 0;
      c.vy = 0;
      c.dirX = -1;
      c.dirY = 0;
      c.hostile = c.baseHostile;
      c.ally = !c.baseHostile;
      c.joined = false;
      c.neutral = false;
      c.joints = [true, true, true];
      c.jointFlash = [0, 0, 0];
      c.attackCooldown = 0.4;
      c.attackPulse = 0;
      c.hurt = 0;
      c.weak = false;
      c.hitCooldown = 0;
      c.attackState = "idle";
      c.attackTimer = 0;
    }
  }

  function resetRun(seed = Math.floor(Math.random() * 900000) + 100000) {
    generateWorld(seed);
    state.time = 22;
    state.playSeconds = 0;
    state.autosaveClock = 0;
    state.reputation = 0;
    state.ink = 0;
    state.unlockedTools = 1;
    state.victory = false;
    state.toast = null;
    state.savePulse = 0;
    state.hitstop = 0;
    state.shake = 0;
    state.flash = 0;
    state.hurtFlash = 0;
    state.moved = false;
    state.attacked = false;
    state.toolMoved = false;
    state.keyboardAimTimer = 0;
    state.drawing = false;
    state.redrawing = false;
    state.drawBackup = null;
    state.drawingDelay = 0;
    state.drawPoints = [];
    state.drawActive = false;
    state.toolBuilt = false;
    state.toolPaletteOpen = false;
    state.shrineFound = false;
    state.allyJoined = false;
    state.discovered = new Set(["0,1"]);
    state.currentRegion = "0,1";
    state.particles = [];
    state.rings = [];
    state.slashes = [];
    state.windArcs = [];
    state.afterimages = [];
    state.keys = Object.create(null);
    state.pointer.aiming = false;
    state.camera.x = 150;
    state.camera.y = 300;
    Object.assign(player, {
      x: 115, y: 300, vx: 0, vy: 0, z: 0, vz: 0,
      dirX: 1, dirY: 0, moveTime: 0, foot: 0, attack: 0,
      attackHit: false, health: 5, invuln: 0, bob: 0,
      stamina: 100, staminaDelay: 0, rollTimer: 0, rollDuration: 0.42,
      rollX: 0, rollY: 0, lockTargetId: null
    });
    resetToolState();
    resetCreatures();
  }

  function serializeGame() {
    return {
      version: SAVE_VERSION,
      seed: state.worldSeed,
      time: state.time,
      playSeconds: state.playSeconds,
      reputation: state.reputation,
      ink: state.ink,
      victory: state.victory,
      shrineFound: state.shrineFound,
      allyJoined: state.allyJoined,
      discovered: [...state.discovered],
      regionEvents: Object.values(state.regionEvents).map(event => ({
        key: event.key,
        status: event.status,
        progress: event.progress
      })),
      player: { x: player.x, y: player.y, dirX: player.dirX, dirY: player.dirY, health: player.health },
      tool: state.toolBuilt ? {
        jointTs: [...state.tool.jointTs],
        segments: [...state.tool.segments],
        points: state.tool.points.map(point => ({ x: point.x, y: point.y })),
        formIndex: state.tool.formIndex
      } : null,
      creatures: creatures.map(c => ({
        id: c.id,
        x: c.x,
        y: c.y,
        joined: c.joined,
        neutral: c.neutral,
        joints: [...c.joints],
        weak: c.weak
      }))
    };
  }

  function saveGame() {
    if (!state.started || state.mode === "title") return false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serializeGame()));
      state.saveExists = true;
      state.savePulse = 1;
      return true;
    } catch {
      return false;
    }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== SAVE_VERSION) return false;
      resetRun(data.seed);
      state.time = Number(data.time) || 22;
      state.playSeconds = Number(data.playSeconds) || 0;
      state.reputation = Math.max(0, Number(data.reputation) || 0);
      state.ink = Math.max(0, Number(data.ink) || 0);
      state.unlockedTools = clamp(1 + state.reputation, 1, TOOL_FORMS.length);
      state.victory = Boolean(data.victory);
      state.shrineFound = Boolean(data.shrineFound);
      state.allyJoined = Boolean(data.allyJoined);
      const validRegionKeys = new Set(Object.keys(state.regionKinds));
      state.discovered = new Set(
        (Array.isArray(data.discovered) ? data.discovered : ["0,1"])
          .filter(key => validRegionKeys.has(key))
      );
      state.discovered.add("0,1");
      if (Array.isArray(data.regionEvents)) {
        for (const savedEvent of data.regionEvents) {
          const event = state.regionEvents[savedEvent.key];
          if (!event) continue;
          event.status = ["hidden", "active", "complete"].includes(savedEvent.status) ? savedEvent.status : event.status;
          event.progress = clamp(Number(savedEvent.progress) || 0, 0, 1);
        }
      }
      for (const key of state.discovered) {
        const event = state.regionEvents[key];
        if (event && event.status === "hidden") event.status = "active";
      }
      if (data.player) {
        player.x = clamp(Number(data.player.x) || 115, 20, WORLD.w - 20);
        player.y = clamp(Number(data.player.y) || 300, 28, WORLD.h - 28);
        const savedDirX = Number(data.player.dirX);
        const savedDirY = Number(data.player.dirY);
        const savedDirection = snap8(Number.isFinite(savedDirX) ? savedDirX : 1, Number.isFinite(savedDirY) ? savedDirY : 0);
        player.dirX = savedDirection.x;
        player.dirY = savedDirection.y;
        player.health = clamp(Number(data.player.health) || 5, 1, 5);
      }
      if (data.tool) {
        state.toolBuilt = true;
        state.tool.jointTs = Array.isArray(data.tool.jointTs)
          ? data.tool.jointTs.map(Number).filter(Number.isFinite).map(value => clamp(value, 0.1, 0.9)).sort((a, b) => a - b).slice(0, 2)
          : [];
        state.tool.segments = Array.isArray(data.tool.segments) && data.tool.segments.length
          ? data.tool.segments.map(Number).filter(Number.isFinite).map(value => clamp(value, 6, 42)).slice(0, 3)
          : [30];
        if (!state.tool.segments.length) state.tool.segments = [30];
        state.tool.points = Array.isArray(data.tool.points)
          ? data.tool.points.slice(0, 240)
            .map(point => ({ x: Number(point.x), y: Number(point.y) }))
            .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
            .map(point => ({ x: clamp(point.x, 64, 320), y: clamp(point.y, 30, 155) }))
          : [];
        state.tool.jointAngles = state.tool.jointTs.map(() => 0);
        state.tool.jointVels = state.tool.jointTs.map(() => 0);
        state.tool.formIndex = clamp(Number(data.tool.formIndex) || 0, 0, state.unlockedTools - 1);
        state.tool.targetIndex = facingIndex();
        state.tool.angle = facingScreenAngle();
      }
      if (!state.toolBuilt && state.shrineFound) state.drawingDelay = 0.3;
      if (Array.isArray(data.creatures)) {
        for (const saved of data.creatures) {
          const c = creatures.find(item => item.id === saved.id);
          if (!c) continue;
          c.x = clamp(Number(saved.x) || c.homeX, 15, WORLD.w - 15);
          c.y = clamp(Number(saved.y) || c.homeY, 20, WORLD.h - 20);
          c.joined = Boolean(saved.joined);
          c.neutral = Boolean(saved.neutral);
          c.joints = Array.isArray(saved.joints) ? [0, 1, 2].map(index => saved.joints[index] !== false) : [true, true, true];
          c.weak = Boolean(saved.weak);
          if (c.neutral) c.hostile = false;
        }
      }
      const cx = clamp(Math.floor(player.x / (WORLD.w / 3)), 0, 2);
      const cy = clamp(Math.floor(player.y / (WORLD.h / 2)), 0, 1);
      state.currentRegion = `${cx},${cy}`;
      state.camera.x = clamp(player.x, W / 2, WORLD.w - W / 2);
      state.camera.y = clamp(player.y, H / 1.44, WORLD.h - H / 1.44);
      return true;
    } catch {
      return false;
    }
  }

  refreshSaveExists();

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function norm(x, y) {
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }
  function snap8(x, y) {
    if (Math.abs(x) + Math.abs(y) < 0.01) return { x: 1, y: 0 };
    const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: Math.cos(a), y: Math.sin(a) };
  }
  function wrapAngle(a) {
    while (a <= -Math.PI) a += TAU;
    while (a > Math.PI) a -= TAU;
    return a;
  }
  function indexAngle(index) {
    return (index % 8) * (Math.PI / 4);
  }
  function screenAngleForDirection(x, y) {
    return Math.atan2(y * 0.72, x);
  }
  function facingScreenAngle() {
    return screenAngleForDirection(player.dirX, player.dirY);
  }
  function setToolTarget(index) {
    const tool = state.tool;
    index = (index + 8) % 8;
    if (index === tool.targetIndex) return;
    state.toolMoved = true;
    const currentIndex = ((Math.round(tool.angle / (Math.PI / 4)) % 8) + 8) % 8;
    const clockwise = (index - currentIndex + 8) % 8;
    const counter = (currentIndex - index + 8) % 8;
    tool.routeSign = clockwise <= counter ? 1 : -1;
    tool.routeSteps = Math.min(clockwise, counter);
    tool.targetIndex = index;
  }
  function snapToolTarget(index) {
    const tool = state.tool;
    index = (index + 8) % 8;
    tool.targetIndex = index;
    tool.angle = screenAngleForDirection(Math.cos(indexAngle(index)), Math.sin(indexAngle(index)));
    tool.angularVelocity = 0;
    tool.routeSteps = 0;
    if (state.toolBuilt) {
      const pose = toolPose();
      const tip = pose[pose.length - 1];
      tool.prevTipX = tip.x;
      tool.prevTipY = tip.y;
    }
  }
  function arrowDirection() {
    const left = state.keys.ArrowLeft;
    const right = state.keys.ArrowRight;
    const up = state.keys.ArrowUp;
    const down = state.keys.ArrowDown;
    if (!(left || right || up || down)) return null;
    if (right && down) return 1;
    if (down && left) return 3;
    if (left && up) return 5;
    if (up && right) return 7;
    if (right) return 0;
    if (down) return 2;
    if (left) return 4;
    return 6;
  }
  function facingIndex() {
    return directionIndex(player.dirX, player.dirY);
  }
  function directionIndex(x, y) {
    const a = Math.atan2(y, x);
    return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  }
  function syncHeldToolToFacing() {
    if (!state.toolBuilt || state.tool.planted) return;
    if (state.tool.mode === "idle") snapToolTarget(facingIndex());
    if (state.tool.mode === "ready") snapToolTarget((facingIndex() + 4) % 8);
  }
  function spawnWindArc(side, strong = false) {
    const p = project(player.x, player.y, player.z + 8);
    const base = indexAngle(facingIndex());
    const dof = state.tool.jointTs.length;
    state.windArcs.push({
      x: p.x,
      y: p.y,
      a0: strong ? base + Math.PI : base - side * 1.35,
      a1: strong ? base : base + side * 1.05,
      radius: state.tool.segments.reduce((a, b) => a + b, 0) + 5 + dof * 3,
      color: strong ? (dof === 2 ? palette.gold : dof === 1 ? palette.ink2 : palette.white) : "#d7fff2",
      life: strong ? 0.42 : 0.25,
      full: strong ? 0.42 : 0.25,
      width: strong ? 4 + dof : 2,
      ccw: strong
    });
    if (strong && dof === 2) {
      state.windArcs.push({
        x: p.x,
        y: p.y,
        a0: base + Math.PI * 0.86,
        a1: base + 0.14,
        radius: state.tool.segments.reduce((a, b) => a + b, 0) - 3,
        color: palette.ink2,
        life: 0.34,
        full: 0.34,
        width: 3,
        ccw: true
      });
    }
  }
  function triggerSwing(side) {
    const tool = state.tool;
    if (!state.toolBuilt || tool.planted || tool.mode === "returning") return;
    tool.mode = "swing";
    tool.modeTimer = 0.30;
    tool.swingSide = side;
    tool.swingReturning = false;
    tool.routeSteps = 2;
    setToolTarget((facingIndex() + side * 2 + 8) % 8);
    spawnWindArc(side, false);
    tone(260 + (side > 0 ? 50 : 0), 0.1, "triangle", 0.035, 220);
  }
  function enterReadyStance() {
    const tool = state.tool;
    if (!state.toolBuilt || tool.planted || tool.mode === "returning") return;
    tool.mode = "ready";
    tool.charge = 1;
    tool.routeSteps = 4;
    snapToolTarget((facingIndex() + 4) % 8);
    tone(110, 0.15, "sawtooth", 0.025, 45);
  }
  function triggerStrongSwing() {
    const tool = state.tool;
    if (tool.mode !== "ready") return;
    tool.chargePower = 1;
    tool.mode = "strongSwing";
    tool.modeTimer = 0.40 + tool.jointTs.length * 0.04;
    tool.routeSteps = 4;
    setToolTarget(facingIndex());
    // A 180-degree tie must always take the visually counter-clockwise path.
    tool.routeSign = -1;
    spawnWindArc(-1, true);
    state.flash = Math.max(state.flash, 0.42);
    state.shake = Math.max(state.shake, 5);
    tone(170, 0.16, "sawtooth", 0.055, 620);
  }
  function handleToolDirection(index) {
    if (!state.toolBuilt) return;
    if (state.tool.mode === "swing" || state.tool.mode === "strongSwing" || state.tool.mode === "returning") return;
    state.toolMoved = true;
    const delta = (index - facingIndex() + 8) % 8;
    if (delta === 0) {
      if (state.tool.mode === "ready") triggerStrongSwing();
      else snapToolTarget(facingIndex());
    } else if (delta === 1 || delta === 2) {
      triggerSwing(1);
    } else if (delta === 6 || delta === 7) {
      triggerSwing(-1);
    } else {
      enterReadyStance();
    }
  }
  function toggleToolPalette() {
    if (!state.toolBuilt || state.tool.planted) return;
    state.toolPaletteOpen = !state.toolPaletteOpen;
    state.tool.mode = "idle";
    state.tool.angularVelocity *= 0.2;
    snapToolTarget(facingIndex());
    tone(state.toolPaletteOpen ? 330 : 240, 0.07, "triangle", 0.025, 80);
  }
  function moveToolPalette(dx, dy) {
    const row = Math.floor(state.tool.formIndex / 3);
    const col = state.tool.formIndex % 3;
    const nextRow = (row + dy + 2) % 2;
    const nextCol = (col + dx + 3) % 3;
    const nextIndex = nextRow * 3 + nextCol;
    if (nextIndex >= state.unlockedTools) {
      tone(95, 0.05, "square", 0.018, -20);
      return;
    }
    state.tool.formIndex = nextIndex;
    tone(300 + state.tool.formIndex * 38, 0.055, "triangle", 0.022, 70);
  }

  const LIGHT_ATTACKS = [
    { duration: 0.46, activeStart: 0.14, activeEnd: 0.25, from: -1.42, to: 1.05, cost: 16, power: 145, lunge: 17 },
    { duration: 0.48, activeStart: 0.15, activeEnd: 0.27, from: 1.18, to: -1.08, cost: 17, power: 165, lunge: 19 },
    { duration: 0.56, activeStart: 0.19, activeEnd: 0.31, from: -0.22, to: 0.16, cost: 21, power: 225, lunge: 28, thrust: true }
  ];

  function isCombatMode(mode = state.tool.mode) {
    return mode === "lightAttack" || mode === "heavyCharge" || mode === "heavyAttack";
  }

  function spendStamina(cost) {
    if (player.stamina + 0.001 < cost) {
      tone(82, 0.07, "square", 0.015, -20);
      return false;
    }
    player.stamina = Math.max(0, player.stamina - cost);
    player.staminaDelay = 0.85;
    return true;
  }

  function currentLockTarget() {
    const target = creatures.find(creature => creature.id === player.lockTargetId);
    if (!target || target.neutral || !target.hostile || dist(target, player) > 245) {
      player.lockTargetId = null;
      return null;
    }
    return target;
  }

  function toggleLockOn() {
    if (currentLockTarget()) {
      player.lockTargetId = null;
      tone(180, 0.06, "triangle", 0.018, -40);
      return;
    }
    let best = null;
    let bestDistance = 190;
    for (const creature of creatures) {
      if (!creature.hostile || creature.neutral) continue;
      const distance = dist(creature, player);
      if (distance < bestDistance) {
        best = creature;
        bestDistance = distance;
      }
    }
    if (best) {
      player.lockTargetId = best.id;
      tone(420, 0.07, "triangle", 0.022, 80);
    } else {
      tone(90, 0.05, "square", 0.014, -20);
    }
  }

  function updateCombatFacing() {
    const locked = currentLockTarget();
    if (locked) {
      const direction = snap8(locked.x - player.x, locked.y - player.y);
      player.dirX = direction.x;
      player.dirY = direction.y;
      return true;
    }
    if (state.keyboardAimTimer > 0) return true;
    if (state.pointer.aiming) {
      const aim = screenToWorld(state.pointer.x, state.pointer.y);
      const direction = snap8(aim.x - player.x, aim.y - player.y);
      player.dirX = direction.x;
      player.dirY = direction.y;
      return true;
    }
    return false;
  }

  function beginLightStep(step) {
    const profile = LIGHT_ATTACKS[step];
    if (!profile || !spendStamina(profile.cost)) return false;
    const tool = state.tool;
    tool.mode = "lightAttack";
    tool.attackStep = step;
    tool.attackDuration = profile.duration;
    tool.modeTimer = profile.duration;
    tool.attackQueued = false;
    tool.attackHitIds = new Set();
    tool.attackWhoosh = false;
    tool.comboGrace = 0;
    tool.reachScale = 1;
    state.attacked = true;
    const direction = norm(player.dirX, player.dirY);
    player.vx += direction.x * profile.lunge * 0.35;
    player.vy += direction.y * profile.lunge * 0.35;
    tone(150 + step * 35, 0.07, "triangle", 0.024, 120);
    return true;
  }

  function startLightAttack() {
    if (!state.started || state.mode !== "playing" || state.drawing || !state.toolBuilt || player.rollTimer > 0) return;
    const tool = state.tool;
    if (tool.mode === "lightAttack") {
      if (tool.modeTimer < 0.28) tool.attackQueued = true;
      return;
    }
    if (tool.mode !== "idle") return;
    const nextStep = tool.comboGrace > 0 ? (tool.attackStep + 1) % LIGHT_ATTACKS.length : 0;
    beginLightStep(nextStep);
  }

  function startHeavyCharge() {
    if (!state.started || state.mode !== "playing" || state.drawing || !state.toolBuilt || player.rollTimer > 0) return;
    const tool = state.tool;
    if (tool.mode !== "idle" || !spendStamina(30)) return;
    tool.mode = "heavyCharge";
    tool.charge = 0;
    tool.chargePower = 0;
    tool.attackQueued = false;
    tool.attackHitIds = new Set();
    tool.attackWhoosh = false;
    tool.comboGrace = 0;
    tone(95, 0.16, "sawtooth", 0.022, 45);
  }

  function releaseHeavyAttack() {
    const tool = state.tool;
    if (tool.mode !== "heavyCharge") return;
    tool.chargePower = clamp(tool.charge, 0.12, 1);
    tool.mode = "heavyAttack";
    tool.attackDuration = 0.74;
    tool.modeTimer = tool.attackDuration;
    tool.attackHitIds = new Set();
    tool.attackWhoosh = false;
    const direction = norm(player.dirX, player.dirY);
    player.vx += direction.x * (18 + tool.chargePower * 20);
    player.vy += direction.y * (18 + tool.chargePower * 20);
    tone(125, 0.15, "sawtooth", 0.045, 420 + tool.chargePower * 240);
  }

  function startDodge() {
    if (!state.started || state.mode !== "playing" || state.drawing || player.rollTimer > 0 || isCombatMode()) return;
    if (!spendStamina(25)) return;
    let x = (state.keys.KeyD ? 1 : 0) - (state.keys.KeyA ? 1 : 0);
    let y = (state.keys.KeyS ? 1 : 0) - (state.keys.KeyW ? 1 : 0);
    if (Math.abs(x) + Math.abs(y) < 0.01) { x = player.dirX; y = player.dirY; }
    const direction = norm(x, y);
    player.rollX = direction.x;
    player.rollY = direction.y;
    player.rollTimer = player.rollDuration;
    player.invuln = Math.max(player.invuln, 0.34);
    player.vx = direction.x * 142;
    player.vy = direction.y * 142;
    state.afterimages.push({ x: player.x, y: player.y, life: 0.24, full: 0.24, dirX: player.dirX, dirY: player.dirY });
    tone(105, 0.12, "triangle", 0.028, -30);
  }

  function attackProgress(tool = state.tool) {
    return tool.attackDuration > 0 ? clamp(1 - tool.modeTimer / tool.attackDuration, 0, 1) : 0;
  }

  function tryCombatHit(power, thrust = false) {
    const tool = state.tool;
    const reach = tool.segments.reduce((sum, segment) => sum + segment, 0) * (tool.reachScale || 1) + 18;
    const facing = norm(player.dirX, player.dirY);
    for (const creature of creatures) {
      if (!creature.hostile || creature.neutral || tool.attackHitIds.has(creature.id)) continue;
      const dx = creature.x - player.x;
      const dy = creature.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > reach) continue;
      const direction = norm(dx, dy);
      const alignment = direction.x * facing.x + direction.y * facing.y;
      if (alignment < (thrust ? 0.56 : -0.28)) continue;
      tool.attackHitIds.add(creature.id);
      damageCreature(creature, player.x, player.y, power);
    }
  }

  function updateCombatTool(dt) {
    const tool = state.tool;
    if (tool.comboGrace > 0) tool.comboGrace = Math.max(0, tool.comboGrace - dt);
    if (!isCombatMode(tool.mode)) return false;
    const base = facingScreenAngle();
    const previousAngle = tool.angle;
    let active = false;
    if (tool.mode === "heavyCharge") {
      tool.charge = Math.min(1, tool.charge + dt / 1.05);
      const settle = 1 - Math.pow(0.015, dt);
      tool.angle = lerp(tool.angle, base - 2.32, settle);
      tool.reachScale = lerp(tool.reachScale, 0.92, settle);
      if (tool.charge >= 1) releaseHeavyAttack();
    } else if (tool.mode === "lightAttack") {
      const profile = LIGHT_ATTACKS[tool.attackStep];
      tool.modeTimer -= dt;
      const elapsed = tool.attackDuration - tool.modeTimer;
      const windup = clamp(elapsed / profile.activeStart, 0, 1);
      const strike = clamp((elapsed - profile.activeStart) / (profile.activeEnd - profile.activeStart), 0, 1);
      const recover = clamp((elapsed - profile.activeEnd) / (profile.duration - profile.activeEnd), 0, 1);
      if (elapsed < profile.activeStart) tool.angle = base + lerp(0, profile.from, windup * windup);
      else if (elapsed < profile.activeEnd) tool.angle = base + lerp(profile.from, profile.to, easeOut(strike));
      else tool.angle = base + lerp(profile.to, 0, recover);
      tool.reachScale = profile.thrust ? (elapsed < profile.activeStart ? 0.82 : elapsed < profile.activeEnd ? lerp(0.82, 1.34, strike) : lerp(1.34, 1, recover)) : 1;
      active = elapsed >= profile.activeStart && elapsed <= profile.activeEnd;
      if (active) tryCombatHit(profile.power, Boolean(profile.thrust));
      if (tool.modeTimer <= 0) {
        if (tool.attackQueued && beginLightStep((tool.attackStep + 1) % LIGHT_ATTACKS.length)) return true;
        tool.mode = "idle";
        tool.comboGrace = 0.55;
        tool.angle = base;
        tool.reachScale = 1;
      }
    } else if (tool.mode === "heavyAttack") {
      tool.modeTimer -= dt;
      const elapsed = tool.attackDuration - tool.modeTimer;
      const activeStart = 0.16;
      const activeEnd = 0.39;
      if (elapsed < activeStart) tool.angle = base - 2.32;
      else if (elapsed < activeEnd) tool.angle = base + lerp(-2.32, 1.52, easeOut((elapsed - activeStart) / (activeEnd - activeStart)));
      else tool.angle = base + lerp(1.52, 0, clamp((elapsed - activeEnd) / (tool.attackDuration - activeEnd), 0, 1));
      tool.reachScale = 1 + (elapsed >= activeStart && elapsed <= activeEnd ? tool.chargePower * 0.14 : 0);
      active = elapsed >= activeStart && elapsed <= activeEnd;
      if (active) tryCombatHit(285 + tool.chargePower * 185, false);
      if (tool.modeTimer <= 0) {
        tool.mode = "idle";
        tool.angle = base;
        tool.reachScale = 1;
        tool.charge = 0;
      }
    }
    tool.angularVelocity = wrapAngle(tool.angle - previousAngle) / Math.max(dt, 0.001);
    if (active && !tool.attackWhoosh) {
      tool.attackWhoosh = true;
      const heavy = tool.mode === "heavyAttack";
      spawnWindArc(tool.attackStep === 1 ? -1 : 1, heavy);
      const direction = norm(player.dirX, player.dirY);
      player.vx += direction.x * (heavy ? 34 : LIGHT_ATTACKS[tool.attackStep].lunge);
      player.vy += direction.y * (heavy ? 34 : LIGHT_ATTACKS[tool.attackStep].lunge);
    }
    const stiffness = tool.mode === "heavyCharge" ? 24 : active ? 34 : 27;
    const damping = tool.mode === "heavyCharge" ? 8 : 10;
    for (let i = 0; i < tool.jointAngles.length; i++) {
      const tuck = tool.mode === "heavyCharge" ? (i % 2 ? -0.16 : 0.16) : clamp(-tool.angularVelocity * 0.018 * (i + 1), -0.32, 0.32);
      tool.jointVels[i] += (-(tool.jointAngles[i] - tuck) * stiffness - tool.jointVels[i] * damping) * dt;
      tool.jointAngles[i] = clamp(tool.jointAngles[i] + tool.jointVels[i] * dt, -0.58, 0.58);
    }
    return true;
  }
  function project(x, y, z = 0) {
    return {
      x: Math.round(x - state.camera.x + W / 2),
      y: Math.round((y - state.camera.y) * 0.72 + H / 2 - z)
    };
  }

  function initAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
  }

  function tone(freq, duration, type = "square", gain = 0.04, slide = 0) {
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp).connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function sfx(kind) {
    if (kind === "discover") {
      tone(420, 0.18, "square", 0.035, 160);
      setTimeout(() => tone(690, 0.28, "sine", 0.035, 260), 90);
    } else if (kind === "hit") {
      tone(145, 0.08, "sawtooth", 0.06, -75);
      tone(760, 0.035, "square", 0.025, -300);
    } else if (kind === "hurt") {
      tone(105, 0.2, "sawtooth", 0.05, -45);
    } else if (kind === "draw") {
      tone(330, 0.12, "triangle", 0.04, 250);
      setTimeout(() => tone(660, 0.18, "triangle", 0.035, 120), 70);
    } else if (kind === "step") {
      tone(70 + Math.random() * 20, 0.025, "square", 0.012, -20);
    }
  }

  function particle(x, y, color, count = 8, power = 32, gravity = 18, world = false) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const p = power * (0.35 + Math.random() * 0.75);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * p,
        vy: Math.sin(a) * p,
        color,
        life: 0.28 + Math.random() * 0.35,
        max: 0.55,
        size: 1 + Math.random() * 2,
        gravity,
        world
      });
    }
  }

  function ring(x, y, color, radius = 6, max = 34, life = 0.55) {
    state.rings.push({ x, y, color, radius, max, life, full: life });
  }

  function burstAtWorld(x, y, color = palette.ink, strong = false) {
    const p = project(x, y, 10);
    particle(p.x, p.y, color, strong ? 24 : 12, strong ? 62 : 38, 24);
    ring(p.x, p.y, color, 4, strong ? 54 : 32, strong ? 0.8 : 0.5);
    if (strong) ring(p.x, p.y, palette.white, 8, 75, 1.05);
  }

  function clearedThreats() {
    return creatures.filter(c => c.baseHostile && c.neutral).length;
  }

  function completedOptionalEvents() {
    return Object.values(state.regionEvents).filter(event => event.kind !== "camp" && event.status === "complete").length;
  }

  function grantReputation(amount, type) {
    if (amount <= 0) return;
    const before = state.unlockedTools;
    state.reputation += amount;
    state.unlockedTools = clamp(1 + state.reputation, 1, TOOL_FORMS.length);
    state.toast = { type, amount, life: 2.2, full: 2.2, unlocked: state.unlockedTools > before };
    if (state.unlockedTools > before) {
      state.flash = Math.max(state.flash, 0.35);
      tone(520, 0.12, "triangle", 0.035, 260);
    }
  }

  function completeRegionEvent(key) {
    const event = state.regionEvents[key];
    if (!event || event.status === "complete") return false;
    event.status = "complete";
    event.progress = 1;
    state.ink += 1;
    grantReputation(1, "event");
    const p = project(event.x, event.y, 9);
    particle(p.x, p.y, REGION_KIND_COLORS[event.kind] || palette.ink, 22, 58, 16);
    ring(p.x, p.y, palette.white, 4, 44, 0.72);
    state.flash = Math.max(state.flash, 0.42);
    saveGame();
    sfx("discover");
    return true;
  }

  function tryToolRegionEvents(pose) {
    const tool = state.tool;
    for (const event of Object.values(state.regionEvents)) {
      if (event.status !== "active" || event.cooldown > 0) continue;
      const target = project(event.x, event.y, 7);
      let crossed = false;
      for (let i = 1; i < pose.length; i++) {
        if (distanceToSegment(target.x, target.y, pose[i - 1].x, pose[i - 1].y, pose[i].x, pose[i].y) < 20) crossed = true;
      }
      if (!crossed) continue;
      if (event.kind === "grove" && tool.mode === "lightAttack") completeRegionEvent(event.key);
      if (event.kind === "ruins" && tool.mode === "heavyAttack") completeRegionEvent(event.key);
      event.cooldown = 0.4;
    }
  }

  function checkVictory() {
    if (state.victory) return;
    const mapComplete = state.discovered.size >= REGION_TOTAL;
    const threatsComplete = creatures.filter(c => c.baseHostile).every(c => c.neutral);
    if (mapComplete && threatsComplete && state.allyJoined) {
      state.victory = true;
      state.mode = "ending";
      state.flash = 1;
      saveGame();
      sfx("discover");
    }
  }

  function discoverRegion(key) {
    if (state.discovered.has(key)) return;
    state.discovered.add(key);
    const event = state.regionEvents[key];
    if (event && event.status === "hidden") event.status = "active";
    grantReputation(1, "region");
    state.flash = Math.max(state.flash, 0.35);
    burstAtWorld(player.x, player.y, palette.gold, true);
    sfx("discover");
    saveGame();
    checkVictory();
  }

  function updateRegion() {
    const cx = clamp(Math.floor(player.x / (WORLD.w / 3)), 0, 2);
    const cy = clamp(Math.floor(player.y / (WORLD.h / 2)), 0, 1);
    const key = `${cx},${cy}`;
    if (key !== state.currentRegion) {
      state.currentRegion = key;
      discoverRegion(key);
    }
  }

  function atCamp(radius = 48) {
    const camp = regionLandmarkPosition("0,1", "camp");
    return Math.hypot(player.x - camp.x, player.y - camp.y) <= radius;
  }

  function snapshotToolDesign() {
    return {
      built: state.toolBuilt,
      jointTs: [...state.tool.jointTs],
      segments: [...state.tool.segments],
      points: state.tool.points.map(point => ({ x: point.x, y: point.y })),
      formIndex: state.tool.formIndex
    };
  }

  function restoreToolDesign(design) {
    if (!design) return;
    resetToolState();
    state.toolBuilt = design.built;
    state.tool.jointTs = [...design.jointTs];
    state.tool.segments = [...design.segments];
    state.tool.points = design.points.map(point => ({ x: point.x, y: point.y }));
    state.tool.jointAngles = design.jointTs.map(() => 0);
    state.tool.jointVels = design.jointTs.map(() => 0);
    state.tool.formIndex = clamp(design.formIndex, 0, state.unlockedTools - 1);
    state.tool.targetIndex = facingIndex();
    state.tool.angle = facingScreenAngle();
  }

  function beginDrawing(redrawing = false) {
    if (redrawing && (!state.toolBuilt || state.ink < 1 || !atCamp())) return false;
    state.redrawing = redrawing;
    state.drawBackup = redrawing ? snapshotToolDesign() : null;
    state.drawing = true;
    state.drawPoints.length = 0;
    state.tool.jointTs.length = 0;
    state.drawActive = false;
    state.flash = 0.45;
    return true;
  }

  function cancelDrawing() {
    if (!state.drawing) return;
    if (state.drawBackup) restoreToolDesign(state.drawBackup);
    state.drawing = false;
    state.redrawing = false;
    state.drawBackup = null;
    state.drawPoints.length = 0;
    state.drawActive = false;
    tone(150, 0.06, "triangle", 0.018, -30);
  }

  function samplePath(points, t) {
    if (!points.length) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];
    let total = 0;
    const lengths = [];
    for (let i = 1; i < points.length; i++) {
      const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lengths.push(l);
      total += l;
    }
    let target = total * t;
    for (let i = 0; i < lengths.length; i++) {
      if (target <= lengths[i]) {
        const u = lengths[i] ? target / lengths[i] : 0;
        return { x: lerp(points[i].x, points[i + 1].x, u), y: lerp(points[i].y, points[i + 1].y, u) };
      }
      target -= lengths[i];
    }
    return points[points.length - 1];
  }

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return total;
  }

  function nearestPathFraction(points, x, y) {
    if (points.length < 2) return null;
    const lengths = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lengths.push(len);
      total += len;
    }
    let walked = 0;
    let best = { distance: Infinity, t: 0 };
    for (let i = 0; i < lengths.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const denom = dx * dx + dy * dy || 1;
      const u = clamp(((x - a.x) * dx + (y - a.y) * dy) / denom, 0, 1);
      const px = a.x + dx * u;
      const py = a.y + dy * u;
      const d = Math.hypot(x - px, y - py);
      if (d < best.distance) best = { distance: d, t: (walked + lengths[i] * u) / total };
      walked += lengths[i];
    }
    return best;
  }

  function confirmTool() {
    if (pathLength(state.drawPoints) < 28) return;
    if (state.redrawing && state.ink < 1) {
      cancelDrawing();
      return;
    }
    const tool = state.tool;
    const cuts = [0, ...tool.jointTs.slice().sort((a, b) => a - b), 1];
    const totalVisualLength = clamp(pathLength(state.drawPoints) * 0.18, 24, 42);
    tool.segments = [];
    for (let i = 1; i < cuts.length; i++) tool.segments.push(Math.max(6, (cuts[i] - cuts[i - 1]) * totalVisualLength));
    tool.jointAngles = tool.jointTs.map(() => 0);
    tool.jointVels = tool.jointTs.map(() => 0);
    tool.points = state.drawPoints.map(p => ({ x: p.x, y: p.y }));
    tool.targetIndex = facingIndex();
    tool.angle = facingScreenAngle();
    tool.angularVelocity = 0;
    tool.planted = false;
    if (state.redrawing) state.ink -= 1;
    state.toolBuilt = true;
    state.drawing = false;
    state.redrawing = false;
    state.drawBackup = null;
    state.flash = 0.6;
    const p = project(player.x, player.y, 13);
    particle(p.x, p.y, palette.ink, 28, 70, 18);
    ring(p.x, p.y, palette.ink2, 5, 55, 0.8);
    saveGame();
    sfx("draw");
  }

  function toolPose() {
    const tool = state.tool;
    const rootBase = project(player.x, player.y, player.z + 9);
    const view = PLAYER_VIEWS[facingIndex()];
    const handOffset = tool.hand || 0;
    const points = [{
      x: rootBase.x + view.grip.x - Math.sin(tool.angle) * handOffset * 2,
      y: rootBase.y + view.grip.y + Math.cos(tool.angle) * handOffset * 2
    }];
    let angle = tool.angle;
    for (let i = 0; i < tool.segments.length; i++) {
      if (i > 0) angle += tool.jointAngles[i - 1] || 0;
      const prev = points[points.length - 1];
      const reach = tool.reachScale || 1;
      points.push({ x: prev.x + Math.cos(angle) * tool.segments[i] * reach, y: prev.y + Math.sin(angle) * tool.segments[i] * reach });
    }
    return points;
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const d = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / d, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function updateTool(dt) {
    if (!state.toolBuilt) return;
    const tool = state.tool;
    const combatControlled = updateCombatTool(dt);
    if (!combatControlled) {
      if (tool.mode === "returning") {
        tool.modeTimer -= dt;
        const target = facingScreenAngle();
        const delta = wrapAngle(target - tool.angle);
        tool.angularVelocity += delta * 70 * dt;
        tool.angularVelocity *= Math.pow(0.01, dt);
        tool.angle = wrapAngle(tool.angle + tool.angularVelocity * dt);
        if (tool.modeTimer <= 0 || Math.abs(delta) < 0.035) {
          tool.mode = "idle";
          tool.returnTrail.length = 0;
          tool.angle = target;
          tool.reachScale = 1;
        }
      } else if (!tool.planted) {
        syncHeldToolToFacing();
        tool.reachScale = lerp(tool.reachScale || 1, 1, 1 - Math.pow(0.002, dt));
      }
      for (let i = 0; i < tool.jointAngles.length; i++) {
        const coupling = clamp(-tool.angularVelocity * 0.025 * (i + 1), -0.24, 0.24);
        tool.jointVels[i] += (-(tool.jointAngles[i] - coupling) * 22 - tool.jointVels[i] * 8) * dt;
        tool.jointAngles[i] = clamp(tool.jointAngles[i] + tool.jointVels[i] * dt, -0.62, 0.62);
      }
    }

    const pose = toolPose();
    const tip = pose[pose.length - 1];
    tryToolRegionEvents(pose);
    if (!tool.prevTipX && !tool.prevTipY) {
      tool.prevTipX = tip.x;
      tool.prevTipY = tip.y;
    }
    tool.prevTipX = tip.x;
    tool.prevTipY = tip.y;
    tool.tipX = tip.x;
    tool.tipY = tip.y;

    if (tool.mode === "returning") {
      tool.returnTrail.push({ x: tip.x, y: tip.y, life: 0.32 });
      for (const c of creatures) {
        if (c.neutral || tool.returnHitIds.has(c.id)) continue;
        const cp = project(c.x, c.y, 3);
        let crossed = false;
        for (let i = 1; i < pose.length; i++) {
          if (distanceToSegment(cp.x, cp.y, pose[i - 1].x, pose[i - 1].y, pose[i].x, pose[i].y) < 15) crossed = true;
        }
        if (crossed) {
          tool.returnHitIds.add(c.id);
          damageCreature(c, player.x, player.y, 999);
        }
      }
      for (const trail of tool.returnTrail) trail.life -= dt;
      tool.returnTrail = tool.returnTrail.filter(t => t.life > 0);
    }
  }

  function plantTool() {
    const tool = state.tool;
    if (!state.toolBuilt || tool.planted || player.z > 0.1 || tool.mode === "returning") return;
    const total = tool.segments.reduce((a, b) => a + b, 0);
    const wx = Math.cos(tool.angle);
    const wy = Math.sin(tool.angle) / 0.72;
    const n = norm(wx, wy);
    tool.planted = true;
    tool.mode = "planted";
    tool.plantX = player.x + n.x * total;
    tool.plantY = player.y + n.y * total;
    const p = project(tool.plantX, tool.plantY, 0);
    particle(p.x, p.y, palette.gold, 10, 25, 24);
    ring(p.x, p.y, palette.ink, 2, 16, 0.3);
    for (const event of Object.values(state.regionEvents)) {
      if (event.status === "active" && event.kind === "spring" && Math.hypot(tool.plantX - event.x, tool.plantY - event.y) < 42) {
        completeRegionEvent(event.key);
      }
    }
    tone(120, 0.08, "square", 0.04, -30);
  }

  function releaseTool() {
    if (!state.tool.planted) return;
    if (state.tool.qAnchor) return;
    state.tool.planted = false;
    state.tool.mode = "idle";
    tone(210, 0.06, "triangle", 0.025, 80);
  }

  function screenToWorld(x, y) {
    return { x: x - W / 2 + state.camera.x, y: (y - H / 2) / 0.72 + state.camera.y };
  }

  function lockSecondAnchor() {
    const tool = state.tool;
    if (!tool.planted || tool.jointTs.length < 2 || tool.qAnchor) return;
    const pose = toolPose();
    const anchorPoint = pose[Math.min(2, pose.length - 2)];
    tool.qAnchor = screenToWorld(anchorPoint.x, anchorPoint.y);
    tool.mode = "doublePinned";
    const p = project(tool.qAnchor.x, tool.qAnchor.y, 0);
    particle(p.x, p.y, palette.purple, 14, 32, 18);
    ring(p.x, p.y, palette.purple, 2, 22, 0.42);
    tone(180, 0.1, "square", 0.04, 120);
  }

  function startToolReturn() {
    const tool = state.tool;
    if (!tool.planted && !tool.qAnchor) return;
    tool.planted = false;
    tool.qAnchor = null;
    tool.mode = "returning";
    tool.modeTimer = 0.42;
    tool.returnHitIds = new Set();
    tool.returnTrail.length = 0;
    setToolTarget(facingIndex());
    tool.routeSteps = 4;
    spawnWindArc(1, true);
    state.shake = Math.max(state.shake, 3.5);
    tone(150, 0.18, "sawtooth", 0.05, 520);
  }

  function jump() {
    if (state.toolBuilt || player.z > 0.1) return;
    player.vz = 72;
    tone(250, 0.08, "square", 0.025, 100);
  }

  function attack() {
    if (!state.started || state.drawing || !state.toolBuilt || player.attack > 0) return;
    player.attack = 0.34;
    player.attackHit = false;
    state.attacked = true;
    tone(220, 0.09, "triangle", 0.025, 180);
  }

  function damageCreature(c, sourceX, sourceY, impactPower = 120) {
    if (c.neutral) return;
    const sourceSide = sourceX < c.x ? -1 : 1;
    const p = project(c.x, c.y, 8);
    if (!c.weak && c.armorSide === sourceSide && impactPower < 260) {
      particle(p.x + sourceSide * 7, p.y, palette.blue, 12, 46, 24);
      ring(p.x, p.y, palette.blue, 2, 20, 0.26);
      state.shake = Math.max(state.shake, 2.2);
      tone(95, 0.08, "square", 0.035, 20);
      c.hitCooldown = 0.32;
      return;
    }
    if (c.weak) {
      c.joints.fill(false);
      c.neutral = true;
      c.hostile = false;
      c.weak = false;
      c.hurt = 0.5;
      particle(p.x, p.y, palette.ink2, 28, 76, 24);
      particle(p.x, p.y, palette.gold, 16, 58, 30);
      ring(p.x, p.y, palette.white, 3, 48, 0.55);
      state.flash = Math.max(state.flash, 0.45);
      state.hitstop = 0.09;
      state.shake = 7;
      if (c.id === "ember") {
        const nestEvent = Object.values(state.regionEvents).find(event => event.kind === "nest");
        if (nestEvent) completeRegionEvent(nestEvent.key);
      }
      if (c.baseHostile) grantReputation(2, "threat");
      saveGame();
      checkVictory();
      sfx("discover");
      return;
    }
    let index = -1;
    for (let i = 0; i < c.joints.length; i++) {
      if (c.joints[i]) { index = i; break; }
    }
    if (index < 0) return;
    c.joints[index] = false;
    c.jointFlash[index] = 0.55;
    c.hurt = 0.35;
    const n = norm(c.x - sourceX, c.y - sourceY);
    c.vx += n.x * 48;
    c.vy += n.y * 48;
    const hit = project(c.x + n.x * 5, c.y + n.y * 5, 8);
    particle(hit.x, hit.y, palette.gold, 18, 62, 30);
    particle(hit.x, hit.y, palette.red, 8, 42, 22);
    ring(hit.x, hit.y, palette.white, 2, 25, 0.32);
    state.slashes.push({ x: hit.x, y: hit.y, a: Math.atan2(n.y, n.x), life: 0.18, full: 0.18 });
    state.shake = Math.max(state.shake, 4.5);
    state.hitstop = 0.055;
    sfx("hit");
    c.hitCooldown = 0.38;
    const remaining = c.joints.filter(Boolean).length;
    if (remaining <= 1) {
      c.weak = true;
      c.vx *= 0.35;
      c.vy *= 0.35;
      setTimeout(() => {
        const q = project(c.x, c.y, 14);
        ring(q.x, q.y, palette.red, 4, 36, 0.7);
        particle(q.x, q.y, palette.gold, 12, 30, -4);
      }, 180);
    }
  }

  function playerStrike() {
    const dir = norm(player.dirX, player.dirY);
    let best = null;
    let bestScore = Infinity;
    for (const c of creatures) {
      if (!c.hostile || c.neutral) continue;
      const dx = c.x - player.x;
      const dy = c.y - player.y;
      const d = Math.hypot(dx, dy);
      const facing = (dx * dir.x + dy * dir.y) / Math.max(1, d);
      if (d < 45 && facing > -0.05 && d < bestScore) {
        best = c;
        bestScore = d;
      }
    }
    if (best) damageCreature(best, player.x, player.y);
    else {
      const p = project(player.x + dir.x * 27, player.y + dir.y * 27, 7);
      particle(p.x, p.y, palette.ink, 5, 18, 8);
    }
  }

  function hurtPlayer(c) {
    if (player.invuln > 0) return;
    player.health--;
    player.invuln = 1.05;
    const n = norm(player.x - c.x, player.y - c.y);
    player.vx += n.x * 85;
    player.vy += n.y * 85;
    const p = project(player.x, player.y, 10);
    particle(p.x, p.y, palette.red, 22, 65, 36);
    ring(p.x, p.y, palette.red, 3, 40, 0.48);
    state.hurtFlash = 0.7;
    state.shake = 7;
    state.hitstop = 0.075;
    sfx("hurt");
    if (player.health <= 0) {
      player.health = 5;
      player.x = 255;
      player.y = 300;
      player.vx = player.vy = 0;
      state.flash = 1;
    }
  }

  function updatePlayer(dt) {
    state.keyboardAimTimer = Math.max(0, state.keyboardAimTimer - dt);
    player.staminaDelay = Math.max(0, player.staminaDelay - dt);
    const rolling = player.rollTimer > 0;
    const combatCommitted = isCombatMode();
    const aimControlled = updateCombatFacing();
    let ix = 0;
    let iy = 0;
    if (!rolling) {
      if (state.keys.KeyA) ix--;
      if (state.keys.KeyD) ix++;
      if (state.keys.KeyW) iy--;
      if (state.keys.KeyS) iy++;
    }
    if (!rolling && state.pointer.touchMove) {
      ix += state.pointer.dx;
      iy += state.pointer.dy / 0.72;
    }
    const moving = Math.abs(ix) + Math.abs(iy) > 0.05;
    let running = false;
    if (rolling) {
      player.rollTimer = Math.max(0, player.rollTimer - dt);
      const rollPhase = player.rollTimer / player.rollDuration;
      const rollSpeed = 76 + 80 * Math.sin(clamp(rollPhase, 0, 1) * Math.PI);
      player.vx = player.rollX * rollSpeed;
      player.vy = player.rollY * rollSpeed;
      player.foot += dt * 19;
      if (Math.random() < dt * 28) {
        state.afterimages.push({ x: player.x, y: player.y, life: 0.18, full: 0.18, dirX: player.dirX, dirY: player.dirY });
      }
    }
    if (moving) {
      state.moved = true;
      player.moveTime += dt;
      const n = norm(ix, iy);
      if (!aimControlled && !combatCommitted) {
        const snapped = snap8(n.x, n.y);
        player.dirX = snapped.x;
        player.dirY = snapped.y;
      }
      running = !combatCommitted && player.stamina > 0 && (state.keys.ShiftLeft || state.keys.ShiftRight);
      if (running) {
        player.stamina = Math.max(0, player.stamina - 21 * dt);
        player.staminaDelay = 0.42;
      }
      const maxSpeed = combatCommitted ? (state.tool.mode === "heavyCharge" ? 13 : 24) : running ? 82 : 42;
      const acceleration = combatCommitted ? 115 : 270;
      player.vx += n.x * acceleration * dt;
      player.vy += n.y * acceleration * dt;
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > maxSpeed) {
        player.vx = player.vx / speed * maxSpeed;
        player.vy = player.vy / speed * maxSpeed;
      }
      player.foot += dt * (running ? 15 : 9);
      if (running && Math.random() < dt * 18) {
        const p = project(player.x - n.x * 6, player.y - n.y * 6, 1);
        particle(p.x, p.y, running ? "#fff0a6" : "#d9d79b", 2, running ? 18 : 12, -4);
      }
      if (running && Math.random() < dt * 12) {
        state.afterimages.push({ x: player.x, y: player.y, life: 0.15, full: 0.15, dirX: player.dirX, dirY: player.dirY });
      }
      if (Math.sin(player.foot) > 0.92 && Math.sin(player.foot - dt * 12) <= 0.92) sfx("step");
    } else if (!rolling) {
      player.moveTime = 0;
      const drag = combatCommitted ? 0.055 : 0.0008;
      player.vx *= Math.pow(drag, dt);
      player.vy *= Math.pow(drag, dt);
    }

    if (!running && player.staminaDelay <= 0 && !rolling) player.stamina = Math.min(100, player.stamina + 25 * dt);

    let nextX = clamp(player.x + player.vx * dt, 20, WORLD.w - 20);
    let nextY = clamp(player.y + player.vy * dt, 28, WORLD.h - 28);
    const inStream = nextX > 510 && nextX < 558;
    const onBridge = nextY > 252 && nextY < 330;
    if (inStream && !onBridge && player.z < 5) {
      nextX = player.x;
      player.vx *= -0.22;
      const splash = project(clamp(player.x, 510, 558), player.y, 0);
      if (Math.random() < dt * 18) particle(splash.x, splash.y, palette.blue, 2, 12, -3);
    }
    player.x = nextX;
    player.y = nextY;
    player.z += player.vz * dt;
    player.vz -= 150 * dt;
    if (player.z <= 0) {
      if (player.vz < -32) {
        const land = project(player.x, player.y, 0);
        particle(land.x, land.y, "#b7c596", 8, 22, -3);
        state.shake = Math.max(state.shake, 1.5);
      }
      player.z = 0;
      player.vz = 0;
    }
    player.bob = rolling ? Math.sin((1 - player.rollTimer / player.rollDuration) * Math.PI) * 2 : Math.abs(Math.sin(player.foot)) * Math.min(2, Math.hypot(player.vx, player.vy) / 28);
    player.invuln = Math.max(0, player.invuln - dt);

    if (!state.shrineFound && player.z < 5 && dist(player, shrine) < 26) {
      state.shrineFound = true;
      state.drawingDelay = 0.72;
      state.flash = 0.7;
      burstAtWorld(shrine.x, shrine.y, palette.ink, true);
      sfx("discover");
    }
  }

  function activeLegs(c) {
    return (c.joints[0] ? 1 : 0) + (c.joints[1] ? 1 : 0);
  }

  function updateCreature(c, dt) {
    c.attackCooldown -= dt;
    c.attackTimer = Math.max(0, c.attackTimer - dt);
    c.hitCooldown = Math.max(0, c.hitCooldown - dt);
    c.attackPulse = Math.max(0, c.attackPulse - dt);
    c.hurt = Math.max(0, c.hurt - dt);
    for (let i = 0; i < c.jointFlash.length; i++) c.jointFlash[i] = Math.max(0, c.jointFlash[i] - dt);

    if (!state.toolBuilt) return;

    let tx = c.x;
    let ty = c.y;
    let desire = 0;

    if (c.hostile && !c.neutral) {
      let target = player;
      const ally = creatures.find(k => k.ally && k.joined);
      if (ally && dist(c, ally) < dist(c, player) * 0.8) target = ally;
      tx = target.x;
      ty = target.y;
      const d = Math.hypot(tx - c.x, ty - c.y);
      if (c.attackState === "windup") {
        desire = 0;
        c.attackPulse = Math.max(c.attackPulse, c.attackTimer);
        const facing = snap8(tx - c.x, ty - c.y);
        c.dirX = facing.x;
        c.dirY = facing.y;
        if (c.attackTimer <= 0) {
          c.attackState = "recovery";
          c.attackTimer = 0.38;
          c.attackCooldown = 0.78;
          c.attackPulse = 0.22;
          const direction = norm(tx - c.x, ty - c.y);
          c.vx += direction.x * 72;
          c.vy += direction.y * 72;
          if (d < 29 && (target !== player || player.z < 5)) {
            if (target === player) hurtPlayer(c);
            else damageCreature(target, c.x, c.y);
          }
        }
      } else if (c.attackState === "recovery") {
        desire = 0;
        if (c.attackTimer <= 0) c.attackState = "idle";
      } else {
        desire = d < 138 ? 1 : 0;
        if (d < 23 && c.joints[2] && c.attackCooldown <= 0 && (target !== player || player.z < 5)) {
          c.attackState = "windup";
          c.attackTimer = 0.46;
          c.attackPulse = 0.46;
          c.vx *= 0.2;
          c.vy *= 0.2;
          tone(115, 0.12, "sawtooth", 0.018, 40);
        }
      }
    } else if (c.ally && c.joined) {
      const enemy = creatures.find(k => k.hostile && !k.neutral);
      if (enemy && dist(c, enemy) < 150) {
        tx = enemy.x;
        ty = enemy.y;
        desire = 1;
        if (dist(c, enemy) < 20 && c.attackCooldown <= 0) {
          c.attackCooldown = 0.92;
          c.attackPulse = 0.24;
          damageCreature(enemy, c.x, c.y);
        }
      } else {
        tx = player.x - player.dirX * 21;
        ty = player.y - player.dirY * 21;
        desire = dist(c, player) > 30 ? 1 : 0;
      }
    }

    const dx = tx - c.x;
    const dy = ty - c.y;
    const d = Math.hypot(dx, dy) || 1;
    if (desire && !c.neutral && d > 14) {
      const n = { x: dx / d, y: dy / d };
      const dirs = snap8(n.x, n.y);
      c.dirX = dirs.x;
      c.dirY = dirs.y;
      const legs = activeLegs(c);
      const speed = c.weak ? 7 : legs === 2 ? 33 : legs === 1 ? 14 : 0;
      c.vx += n.x * speed * 5 * dt;
      c.vy += n.y * speed * 5 * dt;
      const v = Math.hypot(c.vx, c.vy);
      if (v > speed) { c.vx = c.vx / v * speed; c.vy = c.vy / v * speed; }
      c.step += dt * (legs === 1 ? 6 : 10);
    } else {
      c.vx *= Math.pow(0.004, dt);
      c.vy *= Math.pow(0.004, dt);
    }

    c.x = clamp(c.x + c.vx * dt, 15, WORLD.w - 15);
    c.y = clamp(c.y + c.vy * dt, 20, WORLD.h - 20);

    if (c.id === "moss" && !c.joined && player.z < 5 && dist(c, player) < 44 && state.toolBuilt) {
      c.joined = true;
      state.allyJoined = true;
      const villageEvent = Object.values(state.regionEvents).find(event => event.kind === "village");
      if (villageEvent) completeRegionEvent(villageEvent.key);
      grantReputation(1, "bond");
      const p = project(c.x, c.y, 15);
      ring(p.x, p.y, palette.ink, 4, 48, 0.9);
      particle(p.x, p.y, palette.ink2, 18, 38, -8);
      saveGame();
      checkVictory();
      sfx("discover");
    }
  }

  function updateWildlife(wild, dt) {
    const playerDistance = Math.hypot(wild.x - player.x, wild.y - player.y);
    let tx;
    let ty;
    let speed = 10 + wild.scale * 4;
    if (player.z < 5 && playerDistance < 46) {
      const away = norm(wild.x - player.x, wild.y - player.y);
      tx = wild.x + away.x * 60;
      ty = wild.y + away.y * 60;
      speed *= 2.2;
    } else {
      tx = wild.homeX + Math.cos(state.time * 0.42 + wild.phase) * 18;
      ty = wild.homeY + Math.sin(state.time * 0.36 + wild.phase * 1.3) * 12;
    }
    const dx = tx - wild.x;
    const dy = ty - wild.y;
    if (Math.hypot(dx, dy) > 3) {
      const direction = norm(dx, dy);
      const snapped = snap8(direction.x, direction.y);
      wild.dirX = snapped.x;
      wild.dirY = snapped.y;
      wild.vx += direction.x * speed * 5 * dt;
      wild.vy += direction.y * speed * 5 * dt;
      const velocity = Math.hypot(wild.vx, wild.vy);
      if (velocity > speed) {
        wild.vx = wild.vx / velocity * speed;
        wild.vy = wild.vy / velocity * speed;
      }
    } else {
      wild.vx *= Math.pow(0.02, dt);
      wild.vy *= Math.pow(0.02, dt);
    }
    let nextX = clamp(wild.x + wild.vx * dt, 12, WORLD.w - 12);
    const nextY = clamp(wild.y + wild.vy * dt, 18, WORLD.h - 18);
    if (nextX > 506 && nextX < 562 && !(nextY > 252 && nextY < 330)) {
      nextX = wild.x;
      wild.vx *= -0.7;
    }
    wild.x = nextX;
    wild.y = nextY;
    wild.phase += dt * (1.8 + speed * 0.04);
  }

  function updateEffects(dt) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(0.12, dt);
    }
    state.particles = state.particles.filter(p => p.life > 0);
    for (const r of state.rings) {
      r.life -= dt;
      r.radius = lerp(r.radius, r.max, 1 - Math.pow(0.002, dt));
    }
    state.rings = state.rings.filter(r => r.life > 0);
    for (const s of state.slashes) s.life -= dt;
    state.slashes = state.slashes.filter(s => s.life > 0);
    for (const w of state.windArcs) w.life -= dt;
    state.windArcs = state.windArcs.filter(w => w.life > 0);
    for (const a of state.afterimages) a.life -= dt;
    state.afterimages = state.afterimages.filter(a => a.life > 0);
    for (const event of Object.values(state.regionEvents)) event.cooldown = Math.max(0, event.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt * 1.8);
    state.hurtFlash = Math.max(0, state.hurtFlash - dt * 2.3);
    state.shake = Math.max(0, state.shake - dt * 22);
    state.savePulse = Math.max(0, state.savePulse - dt * 2.4);
    if (state.toast) {
      state.toast.life -= dt;
      if (state.toast.life <= 0) state.toast = null;
    }
  }

  function update(dt) {
    if (!state.started || state.mode !== "playing" || state.drawing) {
      updateEffects(dt);
      return;
    }
    if (state.hitstop > 0) {
      state.hitstop -= dt;
      updateEffects(dt * 0.15);
      return;
    }

    state.time += dt;
    state.playSeconds += dt;
    state.autosaveClock += dt;
    if (state.autosaveClock >= 20) {
      state.autosaveClock = 0;
      saveGame();
    }
    if (state.drawingDelay > 0) {
      state.drawingDelay -= dt;
      if (state.drawingDelay <= 0) beginDrawing();
    }
    updatePlayer(dt);
    updateTool(dt);
    for (const c of creatures) updateCreature(c, dt);
    for (const wild of wildlife) updateWildlife(wild, dt);
    updateRegion();
    updateEffects(dt);

    const camEase = 1 - Math.pow(0.0005, dt);
    state.camera.x = lerp(state.camera.x, player.x + player.dirX * 24, camEase);
    state.camera.y = lerp(state.camera.y, player.y + player.dirY * 18, camEase);
    state.camera.x = clamp(state.camera.x, W / 2, WORLD.w - W / 2);
    state.camera.y = clamp(state.camera.y, H / 1.44, WORLD.h - H / 1.44);
  }

  function pixelLine(x1, y1, x2, y2, color, width = 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(Math.round(x1), Math.round(y1));
    ctx.lineTo(Math.round(x2), Math.round(y2));
    ctx.stroke();
  }

  function drawTree(tree) {
    const p = project(tree.x, tree.y, 0);
    if (p.x < -24 || p.x > W + 24 || p.y < -36 || p.y > H + 16) return;
    ctx.fillStyle = "rgba(35,78,55,.22)";
    ctx.fillRect(p.x - 12, p.y + 1, 25, 5);
    ctx.fillStyle = "#8c623f";
    ctx.fillRect(p.x - 2, p.y - 13, 5, 16);
    ctx.fillStyle = "#c18a4e";
    ctx.fillRect(p.x, p.y - 13, 2, 13);
    const crowns = ["#4f9f58", "#58ad63", "#69b95e"];
    ctx.fillStyle = crowns[tree.crown];
    ctx.fillRect(p.x - 11, p.y - 25, 22, 13);
    ctx.fillRect(p.x - 8, p.y - 31, 16, 20);
    ctx.fillStyle = "#84cf69";
    ctx.fillRect(p.x - 5, p.y - 29, 9, 4);
    ctx.fillRect(p.x - 9, p.y - 23, 5, 3);
    ctx.fillStyle = palette.gold;
    if (tree.crown === 2) {
      ctx.fillRect(p.x + 5, p.y - 21, 2, 2);
      ctx.fillRect(p.x - 3, p.y - 17, 2, 2);
    }
  }

  function drawGround() {
    ctx.fillStyle = palette.sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, W, H);

    const cell = 32;
    const sx = Math.floor((state.camera.x - W / 2) / cell) - 1;
    const ex = Math.ceil((state.camera.x + W / 2) / cell) + 1;
    const sy = Math.floor((state.camera.y - H / 1.2) / cell) - 1;
    const ey = Math.ceil((state.camera.y + H / 1.2) / cell) + 1;
    for (let gy = sy; gy <= ey; gy++) {
      for (let gx = sx; gx <= ex; gx++) {
        const n = hash(gx, gy);
        const p = project(gx * cell, gy * cell);
        ctx.fillStyle = n > 0.66 ? palette.ground2 : n < 0.25 ? palette.ground3 : "#76bf70";
        const px = p.x + 4 + Math.floor(hash(gx, gy, 2) * 20);
        const py = p.y + 3 + Math.floor(hash(gx, gy, 3) * 12);
        ctx.fillRect(px, py, 5 + Math.floor(n * 6), 2);
        if (n < 0.16) {
          ctx.fillStyle = "#9fd27a";
          ctx.fillRect(p.x + 7, p.y + 7, 3, 1);
          ctx.fillRect(p.x + 15, p.y + 13, 5, 1);
        }
      }
    }

    // A warm trail leads toward the village without text or quest markers.
    ctx.strokeStyle = "rgba(224,191,116,.48)";
    ctx.lineWidth = 8;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (let x = 420; x <= 690; x += 18) {
      const y = 315 + Math.sin(x * 0.035) * 18;
      const p = project(x, y);
      if (x === 420) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // A shallow stream makes the flattened, oblique ground plane readable.
    const a = project(510, 0);
    const b = project(558, WORLD.h);
    ctx.fillStyle = "#56b8c5";
    ctx.fillRect(a.x, 0, b.x - a.x + 48, H);
    ctx.fillStyle = "#8be2dc";
    ctx.fillRect(a.x - 3, 0, 3, H);
    ctx.fillRect(a.x + b.x - a.x + 45, 0, 3, H);
    ctx.fillStyle = "#b6f1df";
    for (let y = -8; y < H + 8; y += 13) {
      const wobble = Math.sin(y * 0.09 + state.time * 1.7) * 4;
      ctx.fillRect(a.x + 8 + wobble, y, 12, 1);
      ctx.fillRect(a.x + 30 - wobble, y + 5, 8, 1);
    }

    for (const s of stones) {
      const p = project(s.x, s.y);
      if (p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8) continue;
      ctx.fillStyle = "#728f7d";
      ctx.fillRect(p.x - s.s, p.y - s.s * 0.5, s.s * 2, s.s);
      ctx.fillStyle = "#b4c7a0";
      ctx.fillRect(p.x - s.s + 1, p.y - s.s * 0.5, s.s, 1);
    }
    for (const g of grass) {
      const p = project(g.x, g.y);
      if (p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8) continue;
      const sway = Math.round(Math.sin(state.time * 2 + g.x * 0.07) * 1);
      ctx.fillStyle = g.type ? "#b4e76d" : "#4e9e55";
      ctx.fillRect(p.x - 2, p.y - 3, 1, 4);
      ctx.fillRect(p.x + sway, p.y - 4, 1, 5);
      ctx.fillRect(p.x + 2, p.y - 2, 1, 3);
    }
    const flowerColors = ["#fff4a3", "#ff8fa3", "#9be7ff", "#d8a0ff"];
    for (let i = 0; i < flowers.length; i++) {
      const f = flowers[i];
      const p = project(f.x, f.y);
      if (p.x < -5 || p.x > W + 5 || p.y < -6 || p.y > H + 6) continue;
      ctx.fillStyle = "#3f8d4e";
      ctx.fillRect(p.x, p.y - 2, 1, 4);
      ctx.fillStyle = flowerColors[f.color];
      ctx.fillRect(p.x - 1, p.y - 4, 3, 3);
      ctx.fillStyle = palette.gold;
      ctx.fillRect(p.x, p.y - 3, 1, 1);
      if (i % 17 === 0) {
        const flutter = Math.sin(state.time * 5 + i) * 3;
        ctx.fillStyle = "rgba(255,245,168,.9)";
        ctx.fillRect(p.x + 5 + flutter, p.y - 10, 2, 1);
        ctx.fillRect(p.x + 8 + flutter, p.y - 10, 2, 1);
      }
    }
    for (const tree of trees) drawTree(tree);
  }

  function drawHouse(x, y, color) {
    const p = project(x, y, 0);
    ctx.fillStyle = "rgba(43,92,65,.22)";
    ctx.fillRect(p.x - 15, p.y + 4, 31, 6);
    ctx.fillStyle = "#f1d69a";
    ctx.fillRect(p.x - 12, p.y - 13, 24, 18);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x - 16, p.y - 12);
    ctx.lineTo(p.x, p.y - 27);
    ctx.lineTo(p.x + 16, p.y - 12);
    ctx.fill();
    ctx.fillStyle = "#fff0ad";
    ctx.fillRect(p.x - 14, p.y - 13, 28, 3);
    ctx.fillStyle = "#a96843";
    ctx.fillRect(p.x - 3, p.y - 5, 6, 10);
    ctx.fillStyle = "#78d7dc";
    ctx.fillRect(p.x - 10, p.y - 8, 5, 5);
    ctx.fillStyle = palette.white;
    ctx.fillRect(p.x - 9, p.y - 7, 1, 3);
    ctx.fillRect(p.x - 10, p.y - 6, 5, 1);
    ctx.fillStyle = "#79513c";
    ctx.fillRect(p.x + 7, p.y - 26, 4, 9);
    ctx.fillStyle = palette.gold;
    ctx.fillRect(p.x + 8, p.y - 27, 5, 2);
    ctx.fillStyle = "#ef7192";
    ctx.fillRect(p.x - 11, p.y - 2, 2, 2);
    ctx.fillStyle = "#8bd25f";
    ctx.fillRect(p.x - 10, p.y, 5, 2);
  }

  function drawRegionLandmarks() {
    for (const [key, kind] of Object.entries(state.regionKinds)) {
      if (!state.discovered.has(key)) continue;
      const [cx, cy] = key.split(",").map(Number);
      const landmark = regionLandmarkPosition(key, kind);
      const wx = landmark.x;
      const wy = landmark.y;
      const p = project(wx, wy, 0);
      if (p.x < -32 || p.x > W + 32 || p.y < -32 || p.y > H + 32) continue;
      if (kind === "camp") {
        ctx.fillStyle = "rgba(45,79,61,.25)";
        ctx.fillRect(p.x - 15, p.y + 2, 30, 5);
        ctx.fillStyle = "#f1d69a";
        ctx.beginPath();
        ctx.moveTo(p.x - 12, p.y + 2);
        ctx.lineTo(p.x, p.y - 13);
        ctx.lineTo(p.x + 12, p.y + 2);
        ctx.fill();
        ctx.fillStyle = palette.orange;
        ctx.fillRect(p.x - 1, p.y - 8, 3, 10);
        ctx.fillStyle = palette.gold;
        ctx.fillRect(p.x + 11, p.y - 12, 2, 14);
        ctx.fillRect(p.x + 13, p.y - 12, 8, 5);
        if (state.toolBuilt && atCamp()) {
          const available = state.ink > 0;
          ctx.fillStyle = "rgba(7,16,22,.78)";
          ctx.fillRect(p.x - 18, p.y - 34, 36, 12);
          ctx.strokeStyle = available ? palette.ink2 : "#53666a";
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x - 18, p.y - 34, 36, 12);
          ctx.fillStyle = available ? palette.ink : "#53666a";
          ctx.beginPath();
          ctx.moveTo(p.x - 11, p.y - 31);
          ctx.lineTo(p.x - 14, p.y - 25);
          ctx.lineTo(p.x - 8, p.y - 25);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = available ? palette.white : "#6e8184";
          ctx.font = "bold 7px monospace";
          ctx.textAlign = "center";
          ctx.fillText("R  -1", p.x + 4, p.y - 26);
        }
      } else if (kind === "village") {
        ctx.fillStyle = palette.gold;
        ctx.fillRect(p.x - 1, p.y - 14, 3, 17);
        ctx.fillStyle = palette.orange;
        ctx.fillRect(p.x + 2, p.y - 13, 9, 6);
        ctx.fillStyle = palette.white;
        ctx.fillRect(p.x + 4, p.y - 11, 3, 2);
      } else if (kind === "grove") {
        ctx.fillStyle = "#8c623f";
        ctx.fillRect(p.x - 2, p.y - 7, 5, 10);
        ctx.fillStyle = "#3f8e58";
        ctx.fillRect(p.x - 12, p.y - 18, 25, 10);
        ctx.fillStyle = "#78c85f";
        ctx.fillRect(p.x - 8, p.y - 23, 17, 11);
        ctx.fillStyle = palette.gold;
        ctx.fillRect(p.x - 1, p.y - 19, 3, 3);
      } else if (kind === "ruins") {
        ctx.fillStyle = "#788c8d";
        ctx.fillRect(p.x - 12, p.y - 13, 5, 16);
        ctx.fillRect(p.x + 7, p.y - 13, 5, 16);
        ctx.fillRect(p.x - 12, p.y - 16, 24, 5);
        ctx.fillStyle = "#b4c6bd";
        ctx.fillRect(p.x - 9, p.y - 15, 17, 2);
        ctx.fillStyle = palette.ink;
        ctx.fillRect(p.x - 2, p.y - 8, 4, 7);
      } else if (kind === "spring") {
        ctx.fillStyle = "rgba(42,107,123,.24)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 18, 7, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = palette.blue;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 2, 13, 5, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = palette.ink2;
        ctx.fillRect(p.x - 1, p.y - 14 - Math.sin(state.time * 4) * 2, 3, 10);
      } else if (kind === "nest") {
        ctx.strokeStyle = palette.red;
        ctx.lineWidth = 3;
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8;
          pixelLine(p.x + Math.cos(a) * 5, p.y + Math.sin(a) * 3, p.x + Math.cos(a) * 15, p.y + Math.sin(a) * 9, palette.red, 3);
        }
        ctx.fillStyle = "#713b53";
        ctx.fillRect(p.x - 7, p.y - 5, 14, 10);
        ctx.fillStyle = palette.gold;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      const event = state.regionEvents[key];
      if (event?.status === "active") {
        const pulse = 17 + Math.sin(state.time * 5 + cx * 2 + cy) * 2;
        ctx.strokeStyle = REGION_KIND_COLORS[kind] || palette.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 5, pulse, pulse * 0.48, 0, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = "rgba(7,16,22,.72)";
        ctx.fillRect(p.x - 10, p.y - 31, 20, 10);
        ctx.strokeStyle = palette.white;
        ctx.lineWidth = 2;
        if (kind === "grove") {
          pixelLine(p.x - 5, p.y - 28, p.x + 5, p.y - 24, palette.white, 2);
        } else if (kind === "ruins") {
          ctx.beginPath();
          ctx.arc(p.x, p.y - 25, 6, Math.PI, 0);
          ctx.stroke();
        } else if (kind === "spring") {
          ctx.fillStyle = palette.white;
          ctx.font = "bold 6px monospace";
          ctx.textAlign = "center";
          ctx.fillText("SPACE", p.x, p.y - 24);
        } else if (kind === "village") {
          drawBondIcon(p.x, p.y - 28, 0.9);
        } else if (kind === "nest") {
          ctx.fillStyle = palette.red;
          ctx.fillRect(p.x - 5, p.y - 27, 10, 3);
          ctx.fillRect(p.x - 1, p.y - 30, 3, 9);
        }
      } else if (event?.status === "complete" && kind !== "camp") {
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 22);
        ctx.lineTo(p.x + 5, p.y - 17);
        ctx.lineTo(p.x, p.y - 12);
        ctx.lineTo(p.x - 5, p.y - 17);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  function drawWorldObjects() {
    drawRegionLandmarks();
    drawHouse(600, 240, "#ed7f72");
    drawHouse(655, 252, "#e6a34f");
    drawHouse(628, 205, "#5aa8c4");
    // Garden, fence and pennants make the settlement feel inhabited.
    const garden = project(670, 218);
    ctx.fillStyle = "#9b6d49";
    ctx.fillRect(garden.x - 10, garden.y - 3, 21, 7);
    ctx.fillStyle = "#7aca5e";
    for (let i = -7; i <= 7; i += 5) {
      ctx.fillRect(garden.x + i, garden.y - 6, 1, 5);
      ctx.fillStyle = i % 2 ? "#ff8fa3" : "#ffe071";
      ctx.fillRect(garden.x + i - 1, garden.y - 7, 3, 2);
      ctx.fillStyle = "#7aca5e";
    }
    const fenceA = project(575, 335);
    const fenceB = project(688, 335);
    pixelLine(fenceA.x, fenceA.y, fenceB.x, fenceB.y, "#e2b36c", 2);
    for (let x = 578; x < 690; x += 14) {
      const fp = project(x, 335);
      ctx.fillStyle = "#c88f53";
      ctx.fillRect(fp.x - 1, fp.y - 5, 3, 9);
    }
    const flag = project(584, 268, 0);
    ctx.fillStyle = "#8b6847";
    ctx.fillRect(flag.x, flag.y - 20, 2, 23);
    ctx.fillStyle = "#ff7f72";
    ctx.fillRect(flag.x + 2, flag.y - 20, 10, 6);
    ctx.fillStyle = palette.gold;
    ctx.fillRect(flag.x + 4, flag.y - 18, 3, 2);
    const bridge = project(534, 290);
    ctx.fillStyle = "#76513b";
    ctx.fillRect(bridge.x - 30, bridge.y - 7, 60, 14);
    ctx.fillStyle = "#d49a57";
    for (let i = -26; i <= 26; i += 8) ctx.fillRect(bridge.x + i, bridge.y - 6, 5, 12);

    if (!state.toolBuilt) {
      const p = project(shrine.x, shrine.y, 0);
      const pulse = 2 + Math.sin(state.time * 5) * 1.5;
      ctx.fillStyle = "rgba(35,89,69,.24)";
      ctx.fillRect(p.x - 13, p.y + 4, 26, 5);
      ctx.fillStyle = "#8ba49b";
      ctx.fillRect(p.x - 10, p.y - 3, 20, 7);
      ctx.fillStyle = palette.ink;
      ctx.fillRect(p.x - 2, p.y - 15 - pulse, 4, 9);
      ctx.fillStyle = palette.ink2;
      ctx.fillRect(p.x - 1, p.y - 17 - pulse, 2, 3);
      ctx.strokeStyle = `rgba(99,234,215,${0.35 + Math.sin(state.time * 4) * 0.15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 7, 12 + pulse, 5 + pulse * 0.3, 0, 0, TAU);
      ctx.stroke();
    }
  }

  function drawShadow(p, w, alpha = 0.35) {
    ctx.fillStyle = `rgba(3,10,13,${alpha})`;
    ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y - 1), w, 3);
    ctx.fillRect(Math.round(p.x - w / 2 + 2), Math.round(p.y - 2), w - 4, 5);
  }

  function drawPlayerAt(x, y, alpha = 1, ghost = false, dirX = player.dirX, dirY = player.dirY) {
    const p = project(x, y, player.z + player.bob);
    const ground = project(x, y, 0);
    const rolling = !ghost && player.rollTimer > 0;
    if (rolling) p.y += 3;
    const air = clamp(player.z / 76, 0, 1);
    const viewIndex = directionIndex(dirX, dirY);
    const view = PLAYER_VIEWS[viewIndex];
    const backFacing = view.face === "back" || view.face === "back-side";
    const frontFacing = view.face === "front" || view.face === "front-side";
    const sideFacing = view.face === "side";
    const run = !ghost && (state.keys.ShiftLeft || state.keys.ShiftRight) && Math.hypot(player.vx, player.vy) > 35;
    const phase = Math.sin(player.foot);
    const legA = Math.round(phase * 2);
    const flashSkin = player.invuln > 0 && Math.floor(player.invuln * 14) % 2;
    const hair = ghost ? palette.ink : "#233f59";
    const hairLight = ghost ? palette.ink : "#315f78";
    const skin = ghost ? palette.ink : (flashSkin ? palette.white : "#f2c99f");
    const coat = ghost ? palette.ink : "#4e9e9a";
    const coatLight = ghost ? palette.ink2 : "#72c5b3";
    const coatDark = ghost ? palette.ink : "#286875";
    const trousers = ghost ? palette.ink : "#31536b";

    ctx.save();
    ctx.globalAlpha = alpha;
    drawShadow(ground, 15 * lerp(1, 0.34, air), (ghost ? 0.08 : 0.24) * lerp(1, 0.42, air));
    if (rolling) {
      ctx.strokeStyle = palette.ink2;
      ctx.globalAlpha *= 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - player.rollX * 18 - player.rollY * 5, p.y - 8 - player.rollY * 9);
      ctx.lineTo(p.x - player.rollX * 7, p.y - 8);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    // The scarf tail always trails opposite the authored view, making facing
    // readable even while the character is standing still.
    const knotX = p.x - view.dx * 4;
    const knotY = p.y - 12 - view.dy * 2;
    const tailLength = run ? 12 : 7;
    const tailX = knotX - view.dx * tailLength;
    const tailY = knotY - view.dy * (run ? 5 : 3) + (run ? Math.sin(state.time * 14) * 2 : 0);
    pixelLine(knotX, knotY, tailX, tailY, ghost ? palette.ink : "#ff6f69", run ? 2 : 3);
    ctx.fillStyle = ghost ? palette.ink : palette.gold;
    ctx.fillRect(Math.round(tailX - 1), Math.round(tailY - 1), 3, 2);

    // Upward-facing tools pass behind the head and shoulders.
    if (!ghost && state.toolBuilt && backFacing) drawWeapon(p);

    // Eight-direction leg silhouettes: profiles overlap while front/back views
    // keep both boots separated.
    ctx.fillStyle = trousers;
    if (sideFacing) {
      ctx.fillRect(p.x - 2 - view.dx * 2, p.y - 5 - legA, 3, 6);
      ctx.fillRect(p.x - 1 + view.dx * 2, p.y - 5 + legA, 3, 6);
    } else {
      ctx.fillRect(p.x - 4, p.y - 5 + legA, 3, 6);
      ctx.fillRect(p.x + 1, p.y - 5 - legA, 3, 6);
    }
    ctx.fillStyle = ghost ? palette.ink : "#203b55";
    ctx.fillRect(p.x - 5, p.y - 1 + Math.max(0, legA), 4, 2);
    ctx.fillRect(p.x + 1, p.y - 1 + Math.max(0, -legA), 4, 2);

    // Torso, directional shoulder and the view-specific front/back panel.
    ctx.fillStyle = coatDark;
    ctx.fillRect(p.x - 6, p.y - 10, 12, 4);
    ctx.fillStyle = coat;
    ctx.fillRect(p.x - 5, p.y - 9, 10, 7);
    ctx.fillStyle = coatLight;
    if (frontFacing) {
      ctx.fillRect(p.x - 3, p.y - 9, 6, 5);
      ctx.fillStyle = ghost ? palette.ink : palette.gold;
      ctx.fillRect(p.x - 1, p.y - 8, 2, 5);
    } else if (backFacing) {
      ctx.fillStyle = ghost ? palette.ink : "#315f65";
      ctx.fillRect(p.x - 4, p.y - 9, 8, 6);
      ctx.fillStyle = coatLight;
      ctx.fillRect(p.x - 1, p.y - 9, 2, 5);
      ctx.fillStyle = ghost ? palette.ink : palette.gold;
      ctx.fillRect(p.x - 2, p.y - 4, 4, 1);
    } else {
      ctx.fillRect(p.x + view.dx, p.y - 9, view.dx * 4, 5);
      ctx.fillStyle = ghost ? palette.ink : palette.gold;
      ctx.fillRect(p.x + view.dx * 3, p.y - 8, 2, 4);
    }

    // Leading arm terminates exactly where toolPose() places the grip.
    const handX = p.x + view.grip.x;
    const handY = p.y - 9 + view.grip.y;
    pixelLine(p.x + view.dx * 3, p.y - 8, handX, handY, coatDark, 3);
    ctx.fillStyle = ghost ? palette.ink : palette.gold;
    ctx.fillRect(Math.round(handX - 1), Math.round(handY - 1), 3, 3);

    // Head assets deliberately expose different information per viewing side.
    if (backFacing) {
      ctx.fillStyle = skin;
      ctx.fillRect(p.x - 5, p.y - 15, 10, 6);
      ctx.fillStyle = hair;
      ctx.fillRect(p.x - 5, p.y - 17, 10, 8);
      ctx.fillStyle = hairLight;
      ctx.fillRect(p.x - 4 + (view.dx > 0 ? 2 : 0), p.y - 16, 6, 2);
      if (view.face === "back-side") {
        ctx.fillStyle = skin;
        ctx.fillRect(p.x + view.dx * 4, p.y - 14, 2, 4);
        ctx.fillStyle = ghost ? palette.ink : "#c47f6b";
        ctx.fillRect(p.x + view.dx * 5, p.y - 13, 1, 2);
      }
    } else if (sideFacing) {
      ctx.fillStyle = skin;
      ctx.fillRect(p.x - 4, p.y - 16, 8, 8);
      ctx.fillRect(p.x + view.dx * 4, p.y - 14, view.dx * 2, 3);
      ctx.fillStyle = hair;
      ctx.fillRect(p.x - 5, p.y - 17, 10, 4);
      ctx.fillRect(p.x - view.dx * 4, p.y - 14, 3, 4);
      ctx.fillStyle = ghost ? palette.ink : palette.white;
      ctx.fillRect(p.x + view.dx * 3, p.y - 13, 1, 1);
      ctx.fillStyle = ghost ? palette.ink : "#31536b";
      ctx.fillRect(p.x + view.dx * 5, p.y - 12, 1, 1);
    } else {
      ctx.fillStyle = skin;
      ctx.fillRect(p.x - 5, p.y - 16, 10, 8);
      ctx.fillStyle = hair;
      ctx.fillRect(p.x - 5, p.y - 17, 10, 4);
      ctx.fillRect(p.x - 5, p.y - 14, 2, 3);
      ctx.fillStyle = ghost ? palette.ink : palette.white;
      if (view.face === "front") {
        ctx.fillRect(p.x - 3, p.y - 13, 2, 1);
        ctx.fillRect(p.x + 2, p.y - 13, 2, 1);
        ctx.fillStyle = ghost ? palette.ink : "#c47f6b";
        ctx.fillRect(p.x, p.y - 11, 1, 1);
      } else {
        ctx.fillRect(p.x + view.dx, p.y - 13, 2, 1);
        ctx.fillStyle = ghost ? palette.ink : "#31536b";
        ctx.fillRect(p.x + view.dx * 4, p.y - 12, 1, 1);
      }
    }

    ctx.fillStyle = ghost ? palette.ink : palette.gold;
    ctx.fillRect(p.x - 5, p.y - 10, 10, 2);
    if (!ghost && player.z > 1) {
      ctx.fillStyle = `rgba(255,252,232,${0.35 + air * 0.55})`;
      ctx.fillRect(p.x - 4, p.y - 15, 2, 7);
      ctx.fillRect(p.x - 3, p.y - 9, 6, 1);
    }

    if (!ghost && state.toolBuilt && !backFacing) drawWeapon(p);
    ctx.restore();
  }

  function drawToolTip(end, prev, form) {
    const a = Math.atan2(end.y - prev.y, end.x - prev.x);
    ctx.save();
    ctx.translate(Math.round(end.x), Math.round(end.y));
    ctx.rotate(a);
    ctx.fillStyle = form.color;
    if (form.tip === "point") {
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
    } else if (form.tip === "block") {
      ctx.fillRect(-2, -5, 7, 10);
      ctx.fillStyle = palette.white; ctx.fillRect(1, -4, 2, 8);
    } else if (form.tip === "hook") {
      ctx.fillRect(-1, -2, 6, 3);
      ctx.fillRect(3, -1, 3, 6);
      ctx.fillRect(0, 3, 5, 2);
    } else if (form.tip === "blade") {
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-2, -5); ctx.lineTo(0, 0); ctx.lineTo(-2, 5); ctx.closePath(); ctx.fill();
    } else if (form.tip === "fan") {
      ctx.beginPath();
      ctx.moveTo(-2, 0); ctx.lineTo(4, -6); ctx.lineTo(7, 0); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = palette.white; ctx.fillRect(2, -1, 4, 2);
    } else {
      ctx.fillRect(-1, -1, 5, 3);
      ctx.fillRect(3, -5, 2, 5);
      ctx.fillRect(5, -4, 2, 4);
      ctx.fillRect(3, 1, 2, 5);
      ctx.fillRect(5, 2, 2, 4);
    }
    ctx.restore();
  }

  function drawWeapon(p) {
    const tool = state.tool;
    const points = toolPose();
    if (tool.planted) points[points.length - 1] = project(tool.plantX, tool.plantY, 0);
    if (tool.qAnchor && points.length > 2) points[Math.min(2, points.length - 2)] = project(tool.qAnchor.x, tool.qAnchor.y, 0);
    if (Math.abs(tool.angularVelocity) > 2.5 && !tool.planted) {
      ctx.save();
      ctx.globalAlpha = clamp(Math.abs(tool.angularVelocity) / 10, 0.18, 0.5);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, tool.segments.reduce((a, b) => a + b, 0), tool.angle - tool.angularVelocity * 0.08, tool.angle);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 1; i < points.length; i++) {
      pixelLine(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, i % 2 ? palette.ink2 : palette.ink, 3);
      if (i < points.length - 1) {
        ctx.fillStyle = palette.gold;
        ctx.fillRect(Math.round(points[i].x - 2), Math.round(points[i].y - 2), 4, 4);
      }
    }
    const root = points[0];
    const end = points[points.length - 1];
    ctx.fillStyle = palette.gold;
    ctx.fillRect(Math.round(root.x - 2), Math.round(root.y - 2), 4, 4);
    drawToolTip(end, points[points.length - 2], TOOL_FORMS[tool.formIndex]);
    if (tool.planted) {
      ctx.strokeStyle = palette.gold;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(end.x, end.y + 2, 7, 3, 0, 0, TAU);
      ctx.stroke();
    }
    if (tool.qAnchor) {
      const q = project(tool.qAnchor.x, tool.qAnchor.y, 0);
      ctx.strokeStyle = palette.purple;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y + 2, 7, 3, 0, 0, TAU);
      ctx.stroke();
    }
    if (tool.mode === "heavyCharge") {
      ctx.strokeStyle = TOOL_FORMS[tool.formIndex].color;
      ctx.globalAlpha = 0.3 + tool.charge * 0.45 + Math.sin(state.time * 8) * 0.08;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(root.x, root.y, 10 + tool.charge * 7 + Math.sin(state.time * 6), -Math.PI * 0.9, Math.PI * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawWildlife(wild) {
    const hop = Math.abs(Math.sin(wild.phase * 2.1));
    const p = project(wild.x, wild.y, hop * (wild.shape === 1 ? 3 : 1));
    if (p.x < -16 || p.x > W + 16 || p.y < -20 || p.y > H + 12) return;
    const sx = Math.sign(wild.dirX || 1);
    const scale = wild.scale;
    drawShadow(project(wild.x, wild.y, 0), 9 * scale, 0.18);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(scale, scale);
    ctx.fillStyle = wild.colors[0];
    if (wild.shape === 0) {
      ctx.fillRect(-5, -7, 9, 6);
      ctx.fillRect(2 * sx, -10, 5 * sx, 5);
      ctx.fillStyle = wild.colors[1];
      ctx.fillRect(-3, -8, 4, 2);
      pixelLine(-4, -2, -6 - hop * 2, 1, wild.colors[1], 1);
      pixelLine(2, -2, 4 + hop * 2, 1, wild.colors[1], 1);
    } else if (wild.shape === 1) {
      ctx.fillRect(-4, -6, 8, 5);
      ctx.fillRect(2 * sx, -9, 4 * sx, 5);
      ctx.fillStyle = wild.colors[1];
      ctx.fillRect(-2, -8, 3, 3);
      ctx.fillRect(-3 * sx, -11, 2, 5);
      ctx.fillRect(1 * sx, -11, 2, 5);
      pixelLine(-4 * sx, -4, -8 * sx, -8 - hop * 2, wild.colors[1], 1);
    } else {
      ctx.fillRect(-5, -6, 10, 5);
      ctx.fillStyle = wild.colors[1];
      ctx.fillRect(-2, -8, 6, 3);
      ctx.fillRect(4 * sx, -5, 4 * sx, 2);
      ctx.fillRect(-6 * sx, -5, 2 * sx, 2);
      pixelLine(-2, -1, -4, 1, wild.colors[1], 1);
      pixelLine(2, -1, 4, 1, wild.colors[1], 1);
    }
    ctx.fillStyle = palette.dark;
    ctx.fillRect(4 * sx, -7, 1, 1);
    const event = state.regionEvents[wild.regionKey];
    if (event?.status === "complete" && wild.kind !== "camp") {
      ctx.fillStyle = palette.gold;
      ctx.fillRect(-1, -13 - hop * 2, 2, 2);
    }
    ctx.restore();
  }

  function drawCreature(c) {
    const p = project(c.x, c.y, Math.abs(Math.sin(c.step)) * (activeLegs(c) ? 1 : 0));
    drawShadow(p, 20, 0.34);
    if (player.lockTargetId === c.id && c.hostile && !c.neutral) {
      const pulse = 11 + Math.sin(state.time * 7) * 1.2;
      ctx.strokeStyle = palette.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 1, pulse, pulse * 0.38, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = palette.gold;
      ctx.fillRect(p.x - 1, p.y - 25, 3, 3);
    }
    const dir = snap8(c.dirX, c.dirY);
    const sx = Math.sign(dir.x || 1);
    const stride = Math.sin(c.step) * 4;
    const limp = activeLegs(c) === 1 ? Math.abs(Math.sin(c.step * 0.5)) * 3 : 0;

    const feet = [
      { x: p.x - 6 * sx + stride, y: p.y + 1 },
      { x: p.x + 6 * sx - stride, y: p.y + 2 }
    ];
    for (let i = 0; i < 2; i++) {
      const hip = { x: p.x + (i ? 5 : -5), y: p.y - 7 + limp };
      if (c.joints[i]) {
        pixelLine(hip.x, hip.y, feet[i].x, feet[i].y, c.colors[2], 3);
        ctx.fillStyle = c.jointFlash[i] > 0 ? palette.white : palette.gold;
        ctx.fillRect(hip.x - 1, hip.y - 1, 3, 3);
      } else {
        pixelLine(hip.x, hip.y, hip.x + (i ? 3 : -3), hip.y + 7, "#4a4f4d", 2);
        ctx.fillStyle = c.jointFlash[i] > 0 ? palette.white : palette.red;
        ctx.fillRect(hip.x - 1, hip.y - 1, 3, 3);
      }
    }

    ctx.fillStyle = c.hurt > 0 && Math.floor(c.hurt * 20) % 2 ? palette.white : c.colors[0];
    ctx.fillRect(p.x - 9, p.y - 14 + limp, 18, 9);
    pixelLine(p.x - sx * 8, p.y - 11 + limp, p.x - sx * (14 + Math.sin(c.step) * 2), p.y - 16 + limp, c.colors[2], 2);
    ctx.fillStyle = c.colors[1];
    ctx.fillRect(p.x - 4, p.y - 13 + limp, 3, 2);
    ctx.fillRect(p.x + 3, p.y - 9 + limp, 3, 2);
    if (c.armorSide) {
      const armorX = p.x + c.armorSide * 7;
      ctx.fillStyle = "#71828b";
      ctx.fillRect(armorX - 4, p.y - 15 + limp, 7, 10);
      ctx.fillStyle = "#a8bbc0";
      ctx.fillRect(armorX - 3, p.y - 14 + limp, 5, 2);
    }
    ctx.fillStyle = c.colors[1];
    ctx.fillRect(p.x - 6, p.y - 16 + limp, 12, 4);
    const headX = p.x + sx * 9;
    ctx.fillStyle = c.colors[1];
    ctx.fillRect(headX - 4, p.y - 14 + limp, 8, 7);
    ctx.fillRect(headX - sx * 3, p.y - 18 + limp, 3, 5);
    ctx.fillStyle = palette.dark;
    ctx.fillRect(headX + sx * 2, p.y - 12 + limp, 1, 1);
    if (c.ally) {
      ctx.fillStyle = "#fff4a3";
      ctx.fillRect(p.x - 1, p.y - 19 + limp, 3, 3);
      ctx.fillStyle = "#ff8fa3";
      ctx.fillRect(p.x, p.y - 20 + limp, 1, 1);
    }

    if (c.joints[2]) {
      ctx.fillStyle = c.jointFlash[2] > 0 ? palette.white : palette.gold;
      ctx.fillRect(headX - sx * 5 - 1, p.y - 12 + limp, 3, 3);
      if (c.attackPulse > 0) {
        ctx.fillStyle = palette.white;
        ctx.fillRect(headX + sx * 4, p.y - 12 + limp, sx * 5, 2);
      }
    } else {
      ctx.fillStyle = palette.red;
      ctx.fillRect(headX - sx * 5 - 1, p.y - 12 + limp, 3, 3);
    }

    if (c.attackState === "windup") {
      const telegraph = clamp(c.attackTimer / 0.46, 0, 1);
      ctx.strokeStyle = telegraph < 0.28 ? palette.white : palette.red;
      ctx.lineWidth = telegraph < 0.28 ? 3 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 7, 14 - (1 - telegraph) * 4, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - telegraph));
      ctx.stroke();
      const direction = screenAngleForDirection(c.dirX, c.dirY);
      pixelLine(p.x + Math.cos(direction) * 8, p.y - 7 + Math.sin(direction) * 8, p.x + Math.cos(direction) * 19, p.y - 7 + Math.sin(direction) * 19, palette.red, 2);
    }

    if (c.neutral) {
      ctx.strokeStyle = "rgba(99,234,215,.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 11, 13 + Math.sin(state.time * 3 + c.x) * 2, 0, TAU);
      ctx.stroke();
    }
    if (c.weak) {
      const pulse = 2 + Math.sin(state.time * 9) * 1.2;
      ctx.fillStyle = palette.red;
      ctx.fillRect(p.x - 3, p.y - 12 + limp, 6, 6);
      ctx.fillStyle = palette.white;
      ctx.fillRect(p.x - 1, p.y - 10 + limp, 2, 2);
      ctx.strokeStyle = "rgba(255,214,107,.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 9 + limp, 7 + pulse, 0, TAU);
      ctx.stroke();
    }
    if (c.ally && c.joined) drawBondIcon(p.x, p.y - 25, 0.7 + Math.sin(state.time * 4) * 0.15);
  }

  function drawBondIcon(x, y, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.ink;
    ctx.fillRect(x - 4, y, 3, 3);
    ctx.fillRect(x + 1, y, 3, 3);
    ctx.fillRect(x - 5, y + 2, 10, 3);
    ctx.fillRect(x - 3, y + 5, 6, 2);
    ctx.fillRect(x - 1, y + 7, 2, 2);
    ctx.restore();
  }

  function drawEffects() {
    for (const p of state.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.ceil(p.size), Math.ceil(p.size));
      ctx.restore();
    }
    for (const r of state.rings) {
      ctx.save();
      ctx.globalAlpha = r.life / r.full;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1 + (r.life / r.full) * 2;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.radius, r.radius * 0.55, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    for (const s of state.slashes) {
      const t = s.life / s.full;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a);
      ctx.strokeStyle = palette.white;
      ctx.globalAlpha = t;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, -8);
      ctx.lineTo(12, 8);
      ctx.moveTo(-6, 8);
      ctx.lineTo(7, -6);
      ctx.stroke();
      ctx.restore();
    }
    for (const w of state.windArcs) {
      const t = w.life / w.full;
      ctx.save();
      ctx.globalAlpha = t * 0.85;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.width * t;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius * (1 + (1 - t) * 0.16), w.a0, w.a1, w.ccw ?? (w.a1 < w.a0));
      ctx.stroke();
      ctx.globalAlpha = t * 0.42;
      ctx.lineWidth = Math.max(1, w.width - 2);
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius + 5, w.a0 + 0.18, w.a1 - 0.12, w.ccw ?? (w.a1 < w.a0));
      ctx.stroke();
      ctx.restore();
    }
    if (state.toolBuilt) {
      ctx.save();
      for (const trail of state.tool.returnTrail) {
        ctx.globalAlpha = clamp(trail.life / 0.32, 0, 1) * 0.7;
        ctx.fillStyle = palette.gold;
        ctx.fillRect(Math.round(trail.x - 2), Math.round(trail.y - 2), 4, 4);
      }
      ctx.restore();
    }
  }

  function drawMovementHint() {
    if (state.moved || !state.started) return;
    const p = project(player.x, player.y, 22);
    const pulse = Math.sin(state.time * 4) * 1.5;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "center";
    const keys = [{ k: "W", x: 0, y: -15 }, { k: "A", x: -12, y: -5 }, { k: "S", x: 0, y: -5 }, { k: "D", x: 12, y: -5 }];
    for (const key of keys) {
      ctx.fillStyle = "rgba(7,16,22,.75)";
      ctx.fillRect(p.x + key.x - 4, p.y + key.y - 5 + pulse, 8, 8);
      ctx.fillStyle = palette.white;
      ctx.fillText(key.k, p.x + key.x, p.y + key.y + 1 + pulse);
    }
    ctx.fillStyle = "rgba(7,16,22,.72)";
    ctx.fillRect(p.x - 13, p.y + 7 + pulse, 26, 8);
    ctx.fillStyle = palette.gold;
    ctx.font = "bold 6px monospace";
    ctx.fillText("SHIFT", p.x, p.y + 13 + pulse);
    ctx.restore();
  }

  function drawAttackHint() {
    if (!state.toolBuilt || state.toolMoved) return;
    const p = project(player.x, player.y, 28);
    const pulse = 11 + Math.sin(state.time * 5) * 1.5;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = palette.ink2;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const x = p.x + Math.cos(a) * pulse;
      const y = p.y + Math.sin(a) * pulse * 0.6;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a + 2.45) * 3, y + Math.sin(a + 2.45) * 3);
      ctx.lineTo(x, y);
      ctx.lineTo(x + Math.cos(a - 2.45) * 3, y + Math.sin(a - 2.45) * 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.fillStyle = "rgba(7,16,22,.62)";
    ctx.fillRect(7, 7, 62, 14);
    for (let i = 0; i < 5; i++) {
      const x = 14 + i * 11;
      const alive = i < player.health;
      ctx.fillStyle = alive ? palette.red : "#33434a";
      ctx.fillRect(x - 3, 11, 3, 3);
      ctx.fillRect(x + 1, 11, 3, 3);
      ctx.fillRect(x - 4, 13, 8, 3);
      ctx.fillRect(x - 2, 16, 4, 2);
    }

    const mx = W - 52;
    const my = 8;
    ctx.fillStyle = "rgba(7,16,22,.72)";
    ctx.fillRect(mx - 4, my - 3, 49, 30);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        const key = `${x},${y}`;
        const px = mx + x * 14;
        const py = my + y * 12;
        ctx.fillStyle = state.discovered.has(key) ? (REGION_KIND_COLORS[state.regionKinds[key]] || "#527b69") : "#18272d";
        ctx.fillRect(px, py, 11, 9);
        if (state.regionEvents[key]?.status === "complete" && state.regionKinds[key] !== "camp") {
          ctx.fillStyle = palette.gold;
          ctx.fillRect(px + 7, py + 1, 2, 2);
        }
        if (key === state.currentRegion) {
          ctx.strokeStyle = palette.gold;
          ctx.lineWidth = 1;
          ctx.strokeRect(px - 1, py - 1, 13, 11);
        }
      }
    }

    if (state.toolBuilt) {
      ctx.fillStyle = "rgba(7,16,22,.72)";
      ctx.fillRect(8, H - 31, 70, 23);
      let x = 15;
      let y = H - 18;
      let a = -0.5;
      for (let i = 0; i < state.tool.segments.length; i++) {
        const nx = x + Math.cos(a) * state.tool.segments[i] * 0.45;
        const ny = y + Math.sin(a) * state.tool.segments[i] * 0.45;
      pixelLine(x, y, nx, ny, i % 2 ? palette.ink : palette.ink2, 2);
        if (i < state.tool.segments.length - 1) {
          ctx.fillStyle = palette.gold;
          ctx.fillRect(nx - 1, ny - 1, 3, 3);
          a += 0.8;
        }
        x = nx;
        y = ny;
      }
      drawToolTip({ x, y }, { x: x - Math.cos(a) * 5, y: y - Math.sin(a) * 5 }, TOOL_FORMS[state.tool.formIndex]);
      ctx.fillStyle = palette.white;
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("2", 44, H - 12);
      ctx.fillStyle = "#263d43";
      ctx.fillRect(51, H - 25, 21, 10);
      ctx.fillStyle = palette.white;
      ctx.font = "bold 6px monospace";
      ctx.fillText("TAB", 61, H - 18);
    }

    const phase = (state.time % 80) / 80;
    const daylight = Math.sin(phase * TAU - Math.PI / 2);
    const temperature = Math.round(17 + daylight * 7 + (player.y < WORLD.h * 0.35 ? -3 : 1));
    ctx.fillStyle = "rgba(7,16,22,.68)";
    ctx.fillRect(W / 2 - 31, 7, 62, 15);
    if (daylight > -0.15) {
      ctx.fillStyle = palette.gold;
      ctx.fillRect(W / 2 - 23, 11, 7, 7);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        ctx.fillRect(Math.round(W / 2 - 20 + Math.cos(a) * 6), Math.round(14 + Math.sin(a) * 6), 1, 1);
      }
    } else {
      ctx.fillStyle = "#b9d8ec";
      ctx.fillRect(W / 2 - 23, 10, 7, 8);
      ctx.fillStyle = "#273a48";
      ctx.fillRect(W / 2 - 20, 9, 6, 7);
    }
    ctx.fillStyle = temperature <= 10 ? palette.blue : temperature >= 24 ? palette.orange : palette.white;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${temperature}°`, W / 2 - 7, 17);

    // Compact metagame goals: map, bond, and neutralized threats.
    ctx.fillStyle = "rgba(7,16,22,.72)";
    ctx.fillRect(W - 102, H - 29, 94, 21);
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = palette.gold;
    ctx.fillRect(W - 96, H - 23, 8, 6);
    ctx.fillStyle = palette.white;
    ctx.fillText(`${state.discovered.size}/${REGION_TOTAL}`, W - 85, H - 17);
    drawBondIcon(W - 57, H - 23, state.allyJoined ? 1 : 0.18);
    ctx.fillStyle = palette.white;
    ctx.fillText(state.allyJoined ? "1/1" : "0/1", W - 49, H - 17);
    ctx.fillStyle = clearedThreats() >= 2 ? palette.ink : palette.red;
    ctx.fillRect(W - 27, H - 23, 3, 8);
    ctx.fillRect(W - 30, H - 20, 9, 3);
    ctx.fillStyle = palette.white;
    ctx.textAlign = "right";
    ctx.fillText(`${clearedThreats()}/2`, W - 10, H - 17);

    ctx.fillStyle = "rgba(7,16,22,.66)";
    ctx.fillRect(7, 24, 36, 11);
    ctx.fillStyle = palette.gold;
    ctx.fillRect(11, 27, 4, 4);
    ctx.fillStyle = palette.white;
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${state.reputation}`, 18, 32);
    ctx.fillStyle = state.savePulse > 0 ? palette.ink2 : "#476269";
    ctx.fillRect(34, 27, 5, 5);

    ctx.fillStyle = "rgba(7,16,22,.66)";
    ctx.fillRect(46, 24, 31, 11);
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.moveTo(52, 27);
    ctx.lineTo(49, 32);
    ctx.lineTo(55, 32);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.white;
    ctx.textAlign = "left";
    ctx.fillText(`${state.ink}`, 59, 32);
    ctx.restore();
  }

  function drawProgressToast() {
    if (!state.toast || state.mode === "title") return;
    const t = clamp(state.toast.life / state.toast.full, 0, 1);
    const rise = (1 - t) * 8;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2.5);
    ctx.fillStyle = "rgba(7,16,22,.82)";
    ctx.fillRect(W / 2 - 38, 30 - rise, 76, 19);
    ctx.strokeStyle = state.toast.unlocked ? palette.gold : palette.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 38, 30 - rise, 76, 19);
    ctx.fillStyle = state.toast.type === "threat" ? palette.red : state.toast.type === "bond" ? palette.ink : palette.gold;
    ctx.fillRect(W / 2 - 31, 36 - rise, 7, 7);
    ctx.fillStyle = palette.white;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`+${state.toast.amount}`, W / 2 - 18, 43 - rise);
    if (state.toast.unlocked) {
      ctx.fillStyle = palette.gold;
      ctx.fillText("NEW TOOL", W / 2 + 2, 43 - rise);
    }
    ctx.restore();
  }

  function drawToolPalette() {
    if (!state.toolPaletteOpen || !state.toolBuilt) return;
    ctx.save();
    ctx.fillStyle = "rgba(7,16,22,.58)";
    ctx.fillRect(0, 0, W, H);
    const panel = { x: W / 2 - 67, y: H / 2 - 48, w: 134, h: 96 };
    ctx.fillStyle = "#102b31";
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.strokeStyle = palette.ink2;
    ctx.lineWidth = 2;
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);
    for (let i = 0; i < TOOL_FORMS.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = panel.x + 14 + col * 42;
      const y = panel.y + 14 + row * 39;
      const locked = i >= state.unlockedTools;
      ctx.fillStyle = locked ? "#12282d" : i === state.tool.formIndex ? "#315f65" : "#1a3a40";
      ctx.fillRect(x, y, 34, 31);
      if (!locked && i === state.tool.formIndex) {
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 2, 38, 35);
      }
      ctx.globalAlpha = locked ? 0.22 : 1;
      pixelLine(x + 7, y + 16, x + 20, y + 16, "#a9ddd0", 3);
      drawToolTip({ x: x + 26, y: y + 16 }, { x: x + 19, y: y + 16 }, TOOL_FORMS[i]);
      ctx.globalAlpha = 1;
      if (locked) {
        ctx.fillStyle = "#60757a";
        ctx.fillRect(x + 15, y + 12, 5, 7);
        ctx.fillRect(x + 16, y + 9, 3, 4);
      }
    }
    ctx.fillStyle = palette.white;
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "center";
    ctx.fillText("TAB", W / 2, panel.y - 7);
    ctx.restore();
  }

  function drawStart() {
    const options = state.saveExists ? ["이어하기", "새 세계"] : ["새 세계"];
    state.menuIndex = clamp(state.menuIndex, 0, options.length - 1);
    ctx.fillStyle = "rgba(7,20,27,.68)";
    ctx.fillRect(0, 0, W, H);
    const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.05;
    ctx.save();
    ctx.translate(W / 2, 61);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(20, 0);
    ctx.lineTo(0, 20);
    ctx.lineTo(-20, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = palette.ink2;
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(10, 0);
    ctx.lineTo(-3, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = palette.white;
    ctx.font = "bold 15px monospace";
    ctx.textAlign = "center";
    ctx.fillText("DRAWN FRONTIER", W / 2, 103);
    ctx.fillStyle = palette.ink2;
    ctx.font = "bold 7px monospace";
    ctx.fillText("그려서 여는 개척 세계", W / 2, 116);
    for (let i = 0; i < options.length; i++) {
      const y = 137 + i * 24;
      const selected = i === state.menuIndex;
      ctx.fillStyle = selected ? "#315f65" : "rgba(13,37,44,.86)";
      ctx.fillRect(W / 2 - 48, y, 96, 18);
      ctx.strokeStyle = selected ? palette.gold : "#45636a";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(W / 2 - 48, y, 96, 18);
      ctx.fillStyle = selected ? palette.white : "#8aa3a7";
      ctx.font = "bold 8px monospace";
      ctx.fillText(options[i], W / 2, y + 12);
    }
    if (state.saveExists) {
      ctx.fillStyle = "#9bb5b6";
      ctx.font = "6px monospace";
      ctx.fillText("자동 저장됨", W / 2, 194);
    }
    ctx.fillStyle = "#c9ded8";
    ctx.font = "bold 6px monospace";
    ctx.fillText("WASD + SHIFT   ↑↓←→ TOOL   SPACE   TAB", W / 2, 208);
  }

  function drawPauseOverlay() {
    if (state.mode !== "paused") return;
    const options = ["계속", "저장", "타이틀"];
    ctx.fillStyle = "rgba(7,16,22,.74)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#102b31";
    ctx.fillRect(W / 2 - 62, 42, 124, 132);
    ctx.strokeStyle = palette.ink2;
    ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - 62, 42, 124, 132);
    ctx.fillStyle = palette.white;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("PAUSE", W / 2, 62);
    for (let i = 0; i < options.length; i++) {
      const y = 76 + i * 27;
      const selected = i === state.pauseIndex;
      ctx.fillStyle = selected ? "#315f65" : "#17343a";
      ctx.fillRect(W / 2 - 43, y, 86, 19);
      ctx.strokeStyle = selected ? palette.gold : "#45636a";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(W / 2 - 43, y, 86, 19);
      ctx.fillStyle = selected ? palette.white : "#8aa3a7";
      ctx.font = "bold 8px monospace";
      ctx.fillText(options[i], W / 2, y + 13);
    }
    ctx.fillStyle = state.savePulse > 0 ? palette.ink2 : "#789094";
    ctx.font = "6px monospace";
    ctx.fillText(state.savePulse > 0 ? "저장 완료" : `SEED ${state.worldSeed}`, W / 2, 164);
  }

  function drawEndingOverlay() {
    if (state.mode !== "ending") return;
    const glow = 0.72 + Math.sin(performance.now() * 0.003) * 0.1;
    ctx.fillStyle = "rgba(12,42,45,.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, 65);
    ctx.strokeStyle = `rgba(255,224,113,${glow})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 23 + i * 7 + Math.sin(performance.now() * 0.002 + i) * 2, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = palette.gold;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = palette.white;
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
    ctx.fillStyle = palette.white;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("개척 완료", W / 2, 113);
    ctx.fillStyle = palette.ink2;
    ctx.font = "bold 7px monospace";
    ctx.fillText(`MAP ${state.discovered.size}/${REGION_TOTAL}  BOND 1/1  THREAT ${clearedThreats()}/2`, W / 2, 127);
    ctx.fillStyle = palette.gold;
    ctx.fillText(`EVENT ${completedOptionalEvents()}/5   INK ${state.ink}`, W / 2, 139);
    const minutes = Math.floor(state.playSeconds / 60);
    const seconds = Math.floor(state.playSeconds % 60).toString().padStart(2, "0");
    ctx.fillStyle = palette.ink2;
    ctx.fillText(`${minutes}:${seconds}  SEED ${state.worldSeed}`, W / 2, 150);
    ctx.fillStyle = "#17343a";
    ctx.fillRect(W / 2 - 58, 158, 116, 20);
    ctx.strokeStyle = palette.gold;
    ctx.strokeRect(W / 2 - 58, 158, 116, 20);
    ctx.fillStyle = palette.white;
    ctx.font = "bold 8px monospace";
    ctx.fillText("ENTER 계속 탐험", W / 2, 171);
    ctx.fillStyle = "#94aaad";
    ctx.font = "6px monospace";
    ctx.fillText("N 새 세계", W / 2, 192);
  }

  function drawDrawingOverlay() {
    ctx.fillStyle = "rgba(4,10,15,.88)";
    ctx.fillRect(0, 0, W, H);
    const panel = { x: 58, y: 22, w: 268, h: 172 };
    ctx.fillStyle = "#10232a";
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.strokeStyle = "#54717a";
    ctx.lineWidth = 2;
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);
    ctx.strokeStyle = "rgba(99,234,215,.12)";
    ctx.lineWidth = 1;
    for (let x = panel.x + 12; x < panel.x + panel.w; x += 12) pixelLine(x, panel.y, x, panel.y + panel.h, "rgba(99,234,215,.1)", 1);
    for (let y = panel.y + 12; y < panel.y + panel.h; y += 12) pixelLine(panel.x, y, panel.x + panel.w, y, "rgba(99,234,215,.1)", 1);

    // Ink drop icon.
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.moveTo(75, 38);
    ctx.lineTo(69, 49);
    ctx.lineTo(75, 55);
    ctx.lineTo(81, 49);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.white;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`x${state.ink}`, 84, 48);
    if (state.redrawing) {
      ctx.fillStyle = palette.gold;
      ctx.font = "bold 7px monospace";
      ctx.fillText("REDESIGN  -1", 108, 48);
      ctx.fillStyle = "#8fa6aa";
      ctx.textAlign = "right";
      ctx.fillText("ESC CANCEL", 312, 48);
    }

    if (state.drawPoints.length > 1) {
      ctx.strokeStyle = palette.ink2;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(state.drawPoints[0].x, state.drawPoints[0].y);
      for (let i = 1; i < state.drawPoints.length; i++) ctx.lineTo(state.drawPoints[i].x, state.drawPoints[i].y);
      ctx.stroke();
      for (const t of state.tool.jointTs) {
        const joint = samplePath(state.drawPoints, t);
        ctx.fillStyle = palette.gold;
        ctx.fillRect(Math.round(joint.x - 4), Math.round(joint.y - 4), 8, 8);
        ctx.fillStyle = palette.dark;
        ctx.fillRect(Math.round(joint.x - 1), Math.round(joint.y - 1), 2, 2);
      }
      ctx.fillStyle = palette.white;
      const end = state.drawPoints[state.drawPoints.length - 1];
      ctx.fillRect(Math.round(end.x - 3), Math.round(end.y - 3), 6, 6);
    } else {
      const t = (performance.now() * 0.00035) % 1;
      const ghost = [
        { x: 119, y: 126 }, { x: 166, y: 82 }, { x: 218, y: 128 }, { x: 270, y: 77 }
      ];
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(ghost[0].x, ghost[0].y);
      for (let i = 1; i < ghost.length; i++) ctx.lineTo(ghost[i].x, ghost[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      const hand = samplePath(ghost, t);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = palette.white;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Gripper capacity: the item can host up to two joints, including zero.
    ctx.fillStyle = "#243b43";
    ctx.fillRect(274, 34, 38, 22);
    ctx.fillStyle = palette.gold;
    ctx.fillRect(280, 42, 10, 7);
    ctx.fillRect(283, 38, 2, 5);
    ctx.fillRect(287, 37, 2, 6);
    ctx.fillStyle = palette.white;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("2", 303, 49);
    ctx.fillStyle = palette.gold;
    ctx.font = "bold 8px monospace";
    ctx.fillText(String(state.tool.jointTs.length), 264, 49);

    // Small LUT tray: six canonical silhouettes can skin the same drawn physics body.
    for (let i = 0; i < TOOL_FORMS.length; i++) {
      const x = 108 + i * 25;
      const locked = i >= state.unlockedTools;
      ctx.fillStyle = locked ? "#11262b" : i === state.tool.formIndex ? "#315f65" : "#1b343b";
      ctx.fillRect(x - 10, 163, 21, 22);
      if (!locked && i === state.tool.formIndex) {
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 11, 162, 23, 24);
      }
      ctx.globalAlpha = locked ? 0.2 : 1;
      pixelLine(x - 7, 174, x + 2, 174, "#a9ddd0", 2);
      drawToolTip({ x: x + 6, y: 174 }, { x: x, y: 174 }, TOOL_FORMS[i]);
      ctx.globalAlpha = 1;
    }

    // Reset icon.
    ctx.strokeStyle = "#7f9aa0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(82, 175, 8, 0.4, Math.PI * 1.8);
    ctx.stroke();
    ctx.fillStyle = "#7f9aa0";
    ctx.beginPath();
    ctx.moveTo(87, 168);
    ctx.lineTo(91, 168);
    ctx.lineTo(89, 173);
    ctx.fill();

    const ready = pathLength(state.drawPoints) >= 28;
    ctx.fillStyle = ready ? palette.ink : "#30464c";
    ctx.beginPath();
    ctx.arc(300, 174, 12, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ready ? palette.white : "#60757a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(294, 174);
    ctx.lineTo(299, 179);
    ctx.lineTo(307, 168);
    ctx.stroke();
  }

  function render() {
    ctx.save();
    const sx = state.shake ? (Math.random() - 0.5) * state.shake : 0;
    const sy = state.shake ? (Math.random() - 0.5) * state.shake : 0;
    ctx.translate(Math.round(sx), Math.round(sy));
    drawGround();
    drawWorldObjects();
    for (const a of state.afterimages) drawPlayerAt(a.x, a.y, (a.life / a.full) * 0.18, true, a.dirX, a.dirY);

    const entities = [
      { type: "player", y: player.y },
      ...creatures.map(c => ({ type: "creature", y: c.y, c })),
      ...wildlife.map(wild => ({ type: "wildlife", y: wild.y, wild }))
    ];
    entities.sort((a, b) => a.y - b.y);
    for (const e of entities) {
      if (e.type === "player") drawPlayerAt(player.x, player.y);
      else if (e.type === "creature") drawCreature(e.c);
      else drawWildlife(e.wild);
    }
    drawEffects();
    drawMovementHint();
    drawAttackHint();
    ctx.restore();

    const dayPhase = (state.time % 80) / 80;
    const daylight = Math.sin(dayPhase * TAU - Math.PI / 2);
    const night = clamp((-daylight - 0.18) * 0.22, 0, 0.18);
    if (night > 0) {
      ctx.fillStyle = `rgba(35,48,96,${night})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (state.started) drawHUD();
    drawToolPalette();
    drawProgressToast();
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(238,252,242,${state.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.hurtFlash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, W * 0.62);
      g.addColorStop(0, "rgba(255,40,55,0)");
      g.addColorStop(1, `rgba(255,40,55,${state.hurtFlash * 0.62})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (!state.started) drawStart();
    if (state.drawing) drawDrawingOverlay();
    drawPauseOverlay();
    drawEndingOverlay();
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - state.last) / 1000 || 0);
    state.last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function canvasPoint(event) {
    const r = canvas.getBoundingClientRect();
    return { x: (event.clientX - r.left) * W / r.width, y: (event.clientY - r.top) * H / r.height };
  }

  function startGame(useSave = false) {
    if (state.started) return;
    const loaded = useSave && loadGame();
    if (!loaded) resetRun();
    state.started = true;
    state.mode = "playing";
    state.menuIndex = 0;
    canvas.focus();
    initAudio();
    if (audio?.state === "suspended") audio.resume();
    state.flash = 0.6;
    tone(260, 0.22, "triangle", 0.03, 190);
    if (!loaded) saveGame();
  }

  function activateTitleSelection() {
    if (state.saveExists && state.menuIndex === 0) startGame(true);
    else startGame(false);
  }

  function returnToTitle() {
    saveGame();
    state.started = false;
    state.mode = "title";
    state.drawing = false;
    state.toolPaletteOpen = false;
    state.keys = Object.create(null);
    refreshSaveExists();
  }

  function setPaused(paused) {
    if (!state.started || state.mode === "ending") return;
    state.mode = paused ? "paused" : "playing";
    state.pauseIndex = 0;
    state.keys = Object.create(null);
    if (paused) saveGame();
  }

  function activatePauseSelection() {
    if (state.pauseIndex === 0) setPaused(false);
    else if (state.pauseIndex === 1) saveGame();
    else returnToTitle();
  }

  window.addEventListener("keydown", event => {
    state.keys[event.code] = true;
    if (!state.started) {
      const optionCount = state.saveExists ? 2 : 1;
      if (["ArrowUp", "ArrowDown", "KeyW", "KeyS", "Space"].includes(event.code)) event.preventDefault();
      if (!event.repeat && (event.code === "ArrowUp" || event.code === "KeyW")) state.menuIndex = (state.menuIndex - 1 + optionCount) % optionCount;
      if (!event.repeat && (event.code === "ArrowDown" || event.code === "KeyS")) state.menuIndex = (state.menuIndex + 1) % optionCount;
      if (!event.repeat && (event.code === "Enter" || event.code === "Space")) activateTitleSelection();
      return;
    }
    if (state.mode === "ending") {
      if (event.code === "Enter" && !event.repeat) {
        state.mode = "playing";
        state.keys = Object.create(null);
        saveGame();
      }
      if (event.code === "KeyN" && !event.repeat) {
        state.started = false;
        startGame(false);
      }
      return;
    }
    if (state.mode === "paused") {
      if (["ArrowUp", "ArrowDown", "KeyW", "KeyS", "Space"].includes(event.code)) event.preventDefault();
      if (!event.repeat && (event.code === "Escape")) setPaused(false);
      if (!event.repeat && (event.code === "ArrowUp" || event.code === "KeyW")) state.pauseIndex = (state.pauseIndex + 2) % 3;
      if (!event.repeat && (event.code === "ArrowDown" || event.code === "KeyS")) state.pauseIndex = (state.pauseIndex + 1) % 3;
      if (!event.repeat && (event.code === "Enter" || event.code === "Space")) activatePauseSelection();
      return;
    }
    if (event.code === "Escape" && state.toolPaletteOpen) {
      toggleToolPalette();
      return;
    }
    if (event.code === "Escape" && state.drawing && state.redrawing) {
      cancelDrawing();
      return;
    }
    if (event.code === "Escape") {
      setPaused(true);
      return;
    }
    if (state.drawing) {
      if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
      return;
    }
    if (event.code === "Tab") {
      event.preventDefault();
      if (!event.repeat) toggleToolPalette();
      return;
    }
    if (state.toolPaletteOpen) {
      if (event.code.startsWith("Arrow")) {
        event.preventDefault();
        if (!event.repeat) {
          if (event.code === "ArrowLeft") moveToolPalette(-1, 0);
          if (event.code === "ArrowRight") moveToolPalette(1, 0);
          if (event.code === "ArrowUp") moveToolPalette(0, -1);
          if (event.code === "ArrowDown") moveToolPalette(0, 1);
        }
      }
      if ((event.code === "Enter" || event.code === "Escape") && !event.repeat) toggleToolPalette();
      return;
    }
    if (event.code === "KeyR" && !event.repeat && state.toolBuilt && atCamp()) {
      if (!beginDrawing(true)) tone(95, 0.06, "square", 0.018, -20);
      return;
    }
    if (!event.repeat) {
      if (event.code === "KeyA") player.vx -= 15;
      if (event.code === "KeyD") player.vx += 15;
      if (event.code === "KeyW") player.vy -= 15;
      if (event.code === "KeyS") player.vy += 15;
    }
    if (event.code.startsWith("Arrow") && state.toolBuilt) {
      const direction = arrowDirection();
      if (direction !== null) {
        if (state.tool.planted) {
          if (!state.tool.qAnchor && !event.repeat) {
            setToolTarget(direction);
            const moveAngle = indexAngle(direction);
            const n = norm(Math.cos(moveAngle), Math.sin(moveAngle) / 0.72);
            player.vx += n.x * 58;
            player.vy += n.y * 58;
            player.vz = Math.max(player.vz, 74);
          }
        } else if (!event.repeat) {
          handleToolDirection(direction);
        }
      }
    }
    if (event.code.startsWith("Arrow")) event.preventDefault();
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) {
        if (state.toolBuilt) plantTool();
        else jump();
      }
    }
    if (event.code === "KeyQ" && !event.repeat && state.keys.Space) lockSecondAnchor();
    if (event.code === "KeyE" && !event.repeat) startToolReturn();
  });
  window.addEventListener("keyup", event => {
    state.keys[event.code] = false;
    if (event.code === "Space") releaseTool();
  });
  window.addEventListener("blur", () => {
    state.keys = Object.create(null);
    state.pointer.down = false;
    state.pointer.touchMove = false;
    state.pointer.dx = 0;
    state.pointer.dy = 0;
  });

  canvas.addEventListener("pointerdown", event => {
    canvas.focus();
    const p = canvasPoint(event);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
    state.pointer.down = true;
    canvas.setPointerCapture(event.pointerId);
    if (!state.started) {
      const optionCount = state.saveExists ? 2 : 1;
      for (let i = 0; i < optionCount; i++) {
        const y = 137 + i * 24;
        if (p.x >= W / 2 - 52 && p.x <= W / 2 + 52 && p.y >= y - 3 && p.y <= y + 21) {
          state.menuIndex = i;
          activateTitleSelection();
          break;
        }
      }
      return;
    }
    if (state.mode === "ending") {
      if (p.x >= W / 2 - 64 && p.x <= W / 2 + 64 && p.y >= 153 && p.y <= 183) {
        state.mode = "playing";
        saveGame();
      }
      return;
    }
    if (state.mode === "paused") {
      for (let i = 0; i < 3; i++) {
        const y = 76 + i * 27;
        if (p.x >= W / 2 - 48 && p.x <= W / 2 + 48 && p.y >= y - 3 && p.y <= y + 22) {
          state.pauseIndex = i;
          activatePauseSelection();
          break;
        }
      }
      return;
    }
    if (state.drawing) {
      if (p.y >= 160 && p.y <= 188 && p.x >= 96 && p.x <= 270) {
        let nearest = 0;
        let nearestDistance = Infinity;
        for (let i = 0; i < TOOL_FORMS.length; i++) {
          const d = Math.abs(p.x - (108 + i * 25));
          if (d < nearestDistance) { nearest = i; nearestDistance = d; }
        }
        if (nearest < state.unlockedTools) {
          state.tool.formIndex = nearest;
          tone(280 + nearest * 45, 0.06, "triangle", 0.025, 80);
        } else {
          tone(95, 0.05, "square", 0.018, -20);
        }
        return;
      }
      if (Math.hypot(p.x - 300, p.y - 174) < 17) {
        confirmTool();
        return;
      }
      if (Math.hypot(p.x - 82, p.y - 175) < 17) {
        state.drawPoints.length = 0;
        state.tool.jointTs.length = 0;
        return;
      }
      if (p.x > 62 && p.x < 322 && p.y > 28 && p.y < 157) {
        if (pathLength(state.drawPoints) >= 28) {
          const nearest = nearestPathFraction(state.drawPoints, p.x, p.y);
          if (nearest && nearest.distance < 11 && nearest.t > 0.1 && nearest.t < 0.9) {
            const existing = state.tool.jointTs.findIndex(t => Math.abs(t - nearest.t) < 0.065);
            if (existing >= 0) state.tool.jointTs.splice(existing, 1);
            else if (state.tool.jointTs.length < state.tool.maxDof) state.tool.jointTs.push(nearest.t);
            state.tool.jointTs.sort((a, b) => a - b);
            tone(380 + state.tool.jointTs.length * 90, 0.06, "square", 0.025, 40);
          }
        } else {
          state.drawActive = true;
          state.drawPoints = [{ x: p.x, y: p.y }];
        }
      }
      return;
    }
    if (event.pointerType === "touch" && p.x < W * 0.48) {
      state.pointer.touchMove = true;
      state.pointer.ox = p.x;
      state.pointer.oy = p.y;
      state.pointer.dx = 0;
      state.pointer.dy = 0;
    }
  });

  canvas.addEventListener("pointermove", event => {
    const p = canvasPoint(event);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
    if (state.drawing && state.drawActive) {
      const last = state.drawPoints[state.drawPoints.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1.8) {
        state.drawPoints.push({ x: clamp(p.x, 64, 320), y: clamp(p.y, 30, 155) });
      }
    }
    if (state.pointer.touchMove) {
      const dx = p.x - state.pointer.ox;
      const dy = p.y - state.pointer.oy;
      const n = norm(dx, dy);
      const power = clamp(Math.hypot(dx, dy) / 20, 0, 1);
      state.pointer.dx = n.x * power;
      state.pointer.dy = n.y * power;
    }
  });

  function releasePointer() {
    state.pointer.down = false;
    state.drawActive = false;
    state.pointer.touchMove = false;
    state.pointer.dx = 0;
    state.pointer.dy = 0;
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("contextmenu", event => event.preventDefault());

  requestAnimationFrame(frame);
})();
