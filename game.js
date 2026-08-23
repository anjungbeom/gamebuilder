(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const WORLD = { w: 920, h: 560 };
  const TAU = Math.PI * 2;

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

  const state = {
    started: false,
    time: 22,
    last: performance.now(),
    hitstop: 0,
    shake: 0,
    flash: 0,
    hurtFlash: 0,
    moved: false,
    attacked: false,
    toolMoved: false,
    drawing: false,
    drawingDelay: 0,
    drawPoints: [],
    drawActive: false,
    toolBuilt: false,
    tool: {
      maxDof: 2,
      jointTs: [],
      segments: [30],
      jointAngles: [],
      jointVels: [],
      points: [],
      hand: 1,
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
      charge: 0,
      chargePower: 0,
      chargeKey: null,
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
    pointer: { x: W / 2, y: H / 2, down: false, touchMove: false, ox: 0, oy: 0, dx: 0, dy: 0 }
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
    bob: 0
  };

  function creature(id, x, y, colors, hostile = true) {
    return {
      id,
      x,
      y,
      vx: 0,
      vy: 0,
      dirX: -1,
      dirY: 0,
      colors,
      hostile,
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
      hitCooldown: 0
    };
  }

  const creatures = [
    creature("bramble", 425, 300, ["#bc704d", "#e49a5f", "#7b443d"], true),
    creature("moss", 610, 294, ["#57a96b", "#8ee28a", "#35675a"], false),
    creature("ember", 700, 282, ["#b8575b", "#ef7d69", "#713b53"], true)
  ];

  const shrine = { x: 245, y: 296 };
  const grass = [];
  const stones = [];
  const flowers = [];
  const trees = [];
  let audio = null;

  function hash(x, y, z = 0) {
    let n = Math.imul(x + z * 131, 374761393) + Math.imul(y - z * 17, 668265263);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

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
    const a = Math.atan2(player.dirY, player.dirX);
    return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  }
  function spawnWindArc(side, charged = false) {
    const p = project(player.x, player.y, player.z + 8);
    const base = indexAngle(facingIndex());
    const dof = state.tool.jointTs.length;
    state.windArcs.push({
      x: p.x,
      y: p.y,
      a0: base - side * (charged ? 2.7 : 1.35),
      a1: base + side * (charged ? 0.35 : 1.05),
      radius: state.tool.segments.reduce((a, b) => a + b, 0) + 5 + dof * 3,
      color: charged ? (dof === 2 ? palette.gold : dof === 1 ? palette.ink2 : palette.white) : "#d7fff2",
      life: charged ? 0.42 : 0.25,
      full: charged ? 0.42 : 0.25,
      width: charged ? 4 + dof : 2
    });
    if (charged && dof === 2) {
      state.windArcs.push({
        x: p.x,
        y: p.y,
        a0: base - side * 2.15,
        a1: base + side * 0.72,
        radius: state.tool.segments.reduce((a, b) => a + b, 0) - 3,
        color: palette.ink2,
        life: 0.34,
        full: 0.34,
        width: 3
      });
    }
  }
  function triggerSwing(side) {
    const tool = state.tool;
    if (!state.toolBuilt || tool.planted || tool.mode === "charging" || tool.mode === "returning") return;
    tool.mode = "swing";
    tool.modeTimer = 0.24;
    tool.swingSide = side;
    tool.routeSteps = 2;
    setToolTarget((facingIndex() + side * 2 + 8) % 8);
    spawnWindArc(side, false);
    tone(260 + (side > 0 ? 50 : 0), 0.1, "triangle", 0.035, 220);
  }
  function beginCharge(keyCode) {
    const tool = state.tool;
    if (!state.toolBuilt || tool.planted || tool.mode === "returning") return;
    tool.mode = "charging";
    tool.charge = 0;
    tool.chargeKey = keyCode;
    tool.routeSteps = 2;
    setToolTarget((facingIndex() + 4) % 8);
    tone(110, 0.18, "sawtooth", 0.025, 65);
  }
  function releaseCharge() {
    const tool = state.tool;
    if (tool.mode !== "charging") return;
    tool.chargePower = clamp(tool.charge, 0.18, 1);
    tool.mode = "chargeRelease";
    tool.modeTimer = 0.34 + tool.jointTs.length * 0.06;
    tool.routeSteps = 4;
    setToolTarget(facingIndex());
    spawnWindArc(tool.swingSide || 1, true);
    state.flash = Math.max(state.flash, 0.2 + tool.chargePower * 0.25);
    state.shake = Math.max(state.shake, 2 + tool.chargePower * 3);
    tone(170, 0.16, "sawtooth", 0.055, 620);
  }
  function handleToolDirection(index, keyCode) {
    if (!state.toolBuilt) return;
    const delta = (index - facingIndex() + 8) % 8;
    if (delta === 0) {
      if (state.tool.mode === "charging") releaseCharge();
      else setToolTarget(facingIndex());
    } else if (delta === 1 || delta === 2) {
      triggerSwing(1);
    } else if (delta === 6 || delta === 7) {
      triggerSwing(-1);
    } else {
      beginCharge(keyCode);
    }
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

  function discoverRegion(key) {
    if (state.discovered.has(key)) return;
    state.discovered.add(key);
    state.flash = Math.max(state.flash, 0.35);
    burstAtWorld(player.x, player.y, palette.gold, true);
    sfx("discover");
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

  function beginDrawing() {
    state.drawing = true;
    state.drawPoints.length = 0;
    state.tool.jointTs.length = 0;
    state.drawActive = false;
    state.flash = 0.45;
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
    const tool = state.tool;
    const cuts = [0, ...tool.jointTs.slice().sort((a, b) => a - b), 1];
    const totalVisualLength = clamp(pathLength(state.drawPoints) * 0.18, 24, 42);
    tool.segments = [];
    for (let i = 1; i < cuts.length; i++) tool.segments.push(Math.max(6, (cuts[i] - cuts[i - 1]) * totalVisualLength));
    tool.jointAngles = tool.jointTs.map(() => 0);
    tool.jointVels = tool.jointTs.map(() => 0);
    tool.points = state.drawPoints.map(p => ({ x: p.x, y: p.y }));
    tool.angle = indexAngle(tool.targetIndex);
    tool.angularVelocity = 0;
    tool.planted = false;
    state.toolBuilt = true;
    state.drawing = false;
    state.flash = 0.6;
    const p = project(player.x, player.y, 13);
    particle(p.x, p.y, palette.ink, 28, 70, 18);
    ring(p.x, p.y, palette.ink2, 5, 55, 0.8);
    sfx("draw");
  }

  function toolPose() {
    const tool = state.tool;
    const rootBase = project(player.x, player.y, player.z + 9);
    const side = tool.hand;
    const perpX = -Math.sin(tool.angle);
    const perpY = Math.cos(tool.angle);
    const points = [{ x: rootBase.x + perpX * side * 4, y: rootBase.y + perpY * side * 3 }];
    let angle = tool.angle;
    for (let i = 0; i < tool.segments.length; i++) {
      if (i > 0) angle += tool.jointAngles[i - 1] || 0;
      const prev = points[points.length - 1];
      points.push({ x: prev.x + Math.cos(angle) * tool.segments[i], y: prev.y + Math.sin(angle) * tool.segments[i] });
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
    const arrow = arrowDirection();
    if (tool.mode === "idle" && !tool.planted) setToolTarget(facingIndex());
    if (tool.mode === "charging") {
      tool.charge = clamp(tool.charge + dt * 0.85, 0, 1);
      if (Math.random() < dt * (8 + tool.charge * 18)) {
        const chargePose = toolPose();
        const chargeTip = chargePose[chargePose.length - 1];
        particle(chargeTip.x, chargeTip.y, TOOL_FORMS[tool.formIndex].color, 1, 9 + tool.charge * 12, -5);
      }
    }
    if (tool.mode === "swing") {
      tool.modeTimer -= dt;
      if (tool.modeTimer < 0.12) setToolTarget(facingIndex());
      if (tool.modeTimer <= 0) tool.mode = "idle";
    } else if (tool.mode === "chargeRelease") {
      tool.modeTimer -= dt;
      if (tool.modeTimer <= 0) {
        tool.mode = "idle";
        tool.charge = 0;
        tool.chargePower = 0;
      }
    } else if (tool.mode === "returning") {
      tool.modeTimer -= dt;
      setToolTarget(facingIndex());
      if (tool.modeTimer <= 0) {
        tool.mode = "idle";
        tool.returnTrail.length = 0;
      }
    }
    const target = indexAngle(tool.targetIndex);
    let remaining = tool.routeSign > 0 ? (target - tool.angle + TAU) % TAU : (tool.angle - target + TAU) % TAU;
    if (remaining > TAU - 0.02) remaining = 0;
    const speeds = [0, 2.7, 4.0, 5.8, 7.8];
    let wantedSpeed = speeds[tool.routeSteps] || 2.7;
    if (tool.mode === "chargeRelease") wantedSpeed = 8.8 + tool.jointTs.length * 1.8 + tool.chargePower * 2.5;
    if (tool.mode === "returning") wantedSpeed = 10.5;
    if (remaining > 0.018) {
      const braking = clamp(remaining / 0.38, 0.12, 1);
      tool.angularVelocity += tool.routeSign * wantedSpeed * 11 * braking * dt;
      tool.angularVelocity = clamp(tool.angularVelocity, -wantedSpeed, wantedSpeed);
      const step = Math.abs(tool.angularVelocity * dt);
      if (step >= remaining) {
        tool.angle = target;
        tool.angularVelocity *= -0.16;
        remaining = 0;
      } else {
        tool.angle = wrapAngle(tool.angle + tool.angularVelocity * dt);
      }
    } else {
      tool.angle = target;
      tool.angularVelocity *= Math.pow(0.002, dt);
    }

    for (let i = 0; i < tool.jointAngles.length; i++) {
      const chargeWave = tool.mode === "chargeRelease" ? Math.sin((1 - tool.modeTimer / 0.46) * Math.PI * (i + 1)) * (0.35 + i * 0.18) : 0;
      const tuck = tool.mode === "charging" ? (i % 2 ? -1 : 1) * tool.charge * 0.32 : 0;
      const coupling = -tool.angularVelocity * (0.46 + i * 0.18) * (tool.mode === "chargeRelease" ? 1.5 : 1);
      tool.jointVels[i] += (-(tool.jointAngles[i] - chargeWave - tuck) * 13 + coupling - tool.jointVels[i] * 4.8) * dt;
      tool.jointAngles[i] = clamp(tool.jointAngles[i] + tool.jointVels[i] * dt, -0.95, 0.95);
      if (Math.abs(tool.jointAngles[i]) >= 0.94) tool.jointVels[i] *= -0.3;
    }

    const pose = toolPose();
    const tip = pose[pose.length - 1];
    if (!tool.prevTipX && !tool.prevTipY) {
      tool.prevTipX = tip.x;
      tool.prevTipY = tip.y;
    }
    const tipSpeed = Math.hypot(tip.x - tool.prevTipX, tip.y - tool.prevTipY) / Math.max(dt, 0.001);
    tool.sweepCooldown = Math.max(0, tool.sweepCooldown - dt);
    if (tipSpeed > 70 && tool.sweepCooldown <= 0 && !tool.planted && player.z < 5) {
      for (const c of creatures) {
        if (!c.hostile || c.neutral || c.hitCooldown > 0) continue;
        const cp = project(c.x, c.y, 8);
        if (distanceToSegment(cp.x, cp.y, tool.prevTipX, tool.prevTipY, tip.x, tip.y) < 18) {
          const power = tipSpeed * (tool.mode === "chargeRelease" ? 1.8 + tool.chargePower + tool.jointTs.length * 0.35 : 1);
          damageCreature(c, player.x, player.y, power);
          tool.sweepCooldown = 0.28;
          break;
        }
      }
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

    if (tool.planted && !tool.qAnchor && arrow !== null) {
      const moveAngle = indexAngle(arrow);
      const wx = Math.cos(moveAngle);
      const wy = Math.sin(moveAngle) / 0.72;
      const n = norm(wx, wy);
      player.vx += n.x * 360 * dt;
      player.vy += n.y * 360 * dt;
      if (player.z < 8) player.vz = Math.max(player.vz, 72);
      state.shake = Math.max(state.shake, 1.2);
      if (Math.random() < dt * 20) {
        const p = project(tool.plantX, tool.plantY, 0);
        particle(p.x, p.y, palette.gold, 2, 16, 20);
      }
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
    let ix = 0;
    let iy = 0;
    if (state.keys.KeyA) ix--;
    if (state.keys.KeyD) ix++;
    if (state.keys.KeyW) iy--;
    if (state.keys.KeyS) iy++;
    if (state.pointer.touchMove) {
      ix += state.pointer.dx;
      iy += state.pointer.dy / 0.72;
    }
    const moving = Math.abs(ix) + Math.abs(iy) > 0.05;
    if (moving) {
      state.moved = true;
      player.moveTime += dt;
      const n = norm(ix, iy);
      const snapped = snap8(n.x, n.y);
      player.dirX = snapped.x;
      player.dirY = snapped.y;
      const running = state.keys.ShiftLeft || state.keys.ShiftRight;
      const maxSpeed = running ? 82 : 42;
      player.vx += n.x * 270 * dt;
      player.vy += n.y * 270 * dt;
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
    } else {
      player.moveTime = 0;
      player.vx *= Math.pow(0.0008, dt);
      player.vy *= Math.pow(0.0008, dt);
    }

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
    player.bob = Math.abs(Math.sin(player.foot)) * Math.min(2, Math.hypot(player.vx, player.vy) / 28);
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
      desire = d < 130 ? 1 : 0;
      if (d < 18 && c.joints[2] && c.attackCooldown <= 0 && (target !== player || player.z < 5)) {
        c.attackCooldown = 1.05;
        c.attackPulse = 0.28;
        if (target === player) hurtPlayer(c);
        else damageCreature(target, c.x, c.y);
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
      const p = project(c.x, c.y, 15);
      ring(p.x, p.y, palette.ink, 4, 48, 0.9);
      particle(p.x, p.y, palette.ink2, 18, 38, -8);
      sfx("discover");
    }
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
    state.flash = Math.max(0, state.flash - dt * 1.8);
    state.hurtFlash = Math.max(0, state.hurtFlash - dt * 2.3);
    state.shake = Math.max(0, state.shake - dt * 22);
  }

  function update(dt) {
    if (!state.started || state.drawing) {
      updateEffects(dt);
      return;
    }
    if (state.hitstop > 0) {
      state.hitstop -= dt;
      updateEffects(dt * 0.15);
      return;
    }

    state.time += dt;
    if (state.drawingDelay > 0) {
      state.drawingDelay -= dt;
      if (state.drawingDelay <= 0) beginDrawing();
    }
    updatePlayer(dt);
    updateTool(dt);
    for (const c of creatures) updateCreature(c, dt);
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

  function drawWorldObjects() {
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

  function drawPlayerAt(x, y, alpha = 1, ghost = false) {
    const p = project(x, y, player.z + player.bob);
    const ground = project(x, y, 0);
    const air = clamp(player.z / 76, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawShadow(ground, 14 * lerp(1, 0.34, air), (ghost ? 0.1 : 0.24) * lerp(1, 0.42, air));
    const phase = Math.sin(player.foot);
    const side = Math.abs(player.dirX) > 0.2;
    ctx.fillStyle = ghost ? palette.ink : "#31536b";
    const legA = Math.round(phase * 2);
    ctx.fillRect(p.x - 4, p.y - 5 + legA, 3, 6);
    ctx.fillRect(p.x + 1, p.y - 5 - legA, 3, 6);
    ctx.fillStyle = player.invuln > 0 && Math.floor(player.invuln * 14) % 2 ? palette.white : "#f2c99f";
    ctx.fillRect(p.x - 5, p.y - 16, 10, 10);
    ctx.fillStyle = "#4e9e9a";
    ctx.fillRect(p.x - 5, p.y - 9, 10, 7);
    ctx.fillStyle = "#31536b";
    ctx.fillRect(p.x - 5, p.y - 17, 10, 4);
    ctx.fillRect(p.x - 6, p.y - 15, 12, 2);
    ctx.fillStyle = palette.gold;
    ctx.fillRect(p.x - 5, p.y - 10, 10, 2);
    if (!ghost && player.z > 1) {
      ctx.fillStyle = `rgba(255,252,232,${0.35 + air * 0.55})`;
      ctx.fillRect(p.x - 4, p.y - 15, 2, 7);
      ctx.fillRect(p.x - 3, p.y - 9, 6, 1);
    }
    ctx.fillStyle = "#9b5c4c";
    ctx.fillRect(p.x - Math.sign(player.dirX || 1) * 7 - 2, p.y - 10, 4, 7);
    if (!ghost && (state.keys.ShiftLeft || state.keys.ShiftRight) && Math.hypot(player.vx, player.vy) > 35) {
      const tailX = p.x - player.dirX * 10;
      const tailY = p.y - 10 - player.dirY * 4 + Math.sin(state.time * 14) * 2;
      pixelLine(p.x - player.dirX * 3, p.y - 10, tailX, tailY, "#ff6f69", 2);
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(Math.round(tailX - 1), Math.round(tailY - 1), 3, 2);
    }
    ctx.fillStyle = palette.white;
    const eyeX = side ? Math.sign(player.dirX) * 3 : -2;
    const eyeY = player.dirY > 0.2 ? 0 : -1;
    ctx.fillRect(p.x + eyeX, p.y - 13 + eyeY, 1, 1);
    if (!ghost && state.toolBuilt) drawWeapon(p);
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
    ctx.fillStyle = tool.hand > 0 ? palette.orange : palette.purple;
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
    if (tool.mode === "charging") {
      ctx.strokeStyle = TOOL_FORMS[tool.formIndex].color;
      ctx.globalAlpha = 0.45 + tool.charge * 0.4;
      ctx.lineWidth = 1 + tool.charge * 2;
      ctx.beginPath();
      ctx.arc(root.x, root.y, 8 + tool.charge * 10, -Math.PI * 0.9, Math.PI * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawCreature(c) {
    const p = project(c.x, c.y, Math.abs(Math.sin(c.step)) * (activeLegs(c) ? 1 : 0));
    drawShadow(p, 20, 0.34);
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
    for (const a of state.afterimages) drawPlayerAt(a.x, a.y, (a.life / a.full) * 0.18, true);
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
      ctx.arc(w.x, w.y, w.radius * (1 + (1 - t) * 0.16), w.a0, w.a1, w.a1 < w.a0);
      ctx.stroke();
      ctx.globalAlpha = t * 0.42;
      ctx.lineWidth = Math.max(1, w.width - 2);
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius + 5, w.a0 + 0.18, w.a1 - 0.12, w.a1 < w.a0);
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
        ctx.fillStyle = state.discovered.has(key) ? "#527b69" : "#18272d";
        ctx.fillRect(px, py, 11, 9);
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
      ctx.fillStyle = state.tool.hand < 0 ? palette.purple : "#63747a";
      ctx.fillRect(51, H - 25, 8, 10);
      ctx.fillStyle = state.tool.hand > 0 ? palette.orange : "#63747a";
      ctx.fillRect(63, H - 25, 8, 10);
      ctx.fillStyle = palette.white;
      ctx.font = "7px monospace";
      ctx.fillText("[", 55, H - 16);
      ctx.fillText("]", 67, H - 16);
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
    ctx.restore();
  }

  function drawStart() {
    ctx.fillStyle = "rgba(22,72,71,.34)";
    ctx.fillRect(0, 0, W, H);
    const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.08;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(26, 0);
    ctx.lineTo(0, 26);
    ctx.lineTo(-26, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = palette.white;
    ctx.beginPath();
    ctx.moveTo(-5, -9);
    ctx.lineTo(11, 0);
    ctx.lineTo(-5, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
    ctx.fillStyle = state.tool.hand > 0 ? palette.orange : palette.purple;
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
      ctx.fillStyle = i === state.tool.formIndex ? "#315f65" : "#1b343b";
      ctx.fillRect(x - 10, 163, 21, 22);
      if (i === state.tool.formIndex) {
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 11, 162, 23, 24);
      }
      pixelLine(x - 7, 174, x + 2, 174, "#a9ddd0", 2);
      drawToolTip({ x: x + 6, y: 174 }, { x: x, y: 174 }, TOOL_FORMS[i]);
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
    for (const a of state.afterimages) drawPlayerAt(a.x, a.y, (a.life / a.full) * 0.12, true);

    const entities = [{ type: "player", y: player.y }, ...creatures.map(c => ({ type: "creature", y: c.y, c }))];
    entities.sort((a, b) => a.y - b.y);
    for (const e of entities) {
      if (e.type === "player") drawPlayerAt(player.x, player.y);
      else drawCreature(e.c);
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

    drawHUD();
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

  function startGame() {
    if (state.started) return;
    state.started = true;
    initAudio();
    if (audio?.state === "suspended") audio.resume();
    state.flash = 0.6;
    tone(260, 0.22, "triangle", 0.03, 190);
  }

  window.addEventListener("keydown", event => {
    state.keys[event.code] = true;
    if (!state.started) startGame();
    if (state.drawing) {
      if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
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
          handleToolDirection(direction, event.code);
        }
      }
    }
    if (event.code.startsWith("Arrow")) event.preventDefault();
    if (event.code === "BracketLeft") {
      state.tool.hand = -1;
      tone(240, 0.05, "square", 0.02, 50);
    }
    if (event.code === "BracketRight") {
      state.tool.hand = 1;
      tone(310, 0.05, "square", 0.02, 50);
    }
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
    if (event.code === state.tool.chargeKey && state.tool.mode === "charging") releaseCharge();
    if (event.code === "Space") releaseTool();
  });

  canvas.addEventListener("pointerdown", event => {
    canvas.focus();
    const p = canvasPoint(event);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
    state.pointer.down = true;
    canvas.setPointerCapture(event.pointerId);
    if (!state.started) {
      startGame();
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
        state.tool.formIndex = nearest;
        tone(280 + nearest * 45, 0.06, "triangle", 0.025, 80);
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
