// Height fields cannot resolve tunnels or stacked floors, so only the highest support is safe.
export const WALK = Object.freeze({ radius: 0.32, height: 2.1, step: 0.26, drop: 0.32, slope: 0.65, stride: 0.2, speed: 1.8, fast: 4.2 });
export const JUMP = Object.freeze({ speed: 5.2, gravity: 16 });
const EPS = 1e-5;
const REASONS = {
  support: '脚下没有可靠支撑，请换一处落地', water: '水面不能落地或步行',
  slope: '这里坡度过陡，无法站稳', step: '前方台阶或墙体过高', edge: '前方是屋沿或落差过大',
  clearance: '净空不足，附近有墙体或障碍物', below: '上方有建筑或桥面，不能穿过它落地',
};
export const groundFailure = (code) => ({ ok: false, code, why: REASONS[code] || code });

function supportAt(env, x, z) {
  const land = env.terrain.heightAt(x, z);
  const top = env.solid?.heightAt(x, z) ?? -Infinity;
  const y = Math.max(land, top);
  if (!Number.isFinite(land) || !Number.isFinite(y) || y < -1e8) return groundFailure('support');
  const water = Math.max(0.25, env.river?.levelAt(x, z) ?? -Infinity);
  if (y <= water + 0.08) return groundFailure('water');
  return { ok: true, y };
}

// Some colliders move the probe without returning true; any displacement still blocks movement.
export function bodyClear(env, x, y, z, height = WALK.height, radius = WALK.radius) {
  const normal = { set() { return this; } };
  const n = Math.max(1, Math.ceil((height - radius * 2) / radius));
  for (const collider of [env.solid, env.props]) {
    if (!collider?.collide) continue;
    for (let i = 0; i <= n; i++) {
      const py = y + radius + Math.max(0, height - radius * 2) * i / n;
      const p = { x, y: py, z };
      const hit = collider.collide(p, radius, normal);
      if (hit || !Number.isFinite(p.x + p.y + p.z) || Math.hypot(p.x - x, p.y - py, p.z - z) > EPS) return false;
    }
  }
  return true;
}

// maxY prevents landing through the topmost solid when starting below it.
export function probeGround(env, x, z, { referenceY, maxY = Infinity } = {}) {
  const r = WALK.radius, points = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r],
    [r * 0.707, r * 0.707], [-r * 0.707, r * 0.707], [r * 0.707, -r * 0.707], [-r * 0.707, -r * 0.707]];
  const heights = [];
  for (const [dx, dz] of points) {
    const s = supportAt(env, x + dx, z + dz);
    if (!s.ok) return s;
    if (s.y > maxY + EPS) return groundFailure('below');
    heights.push(s.y);
  }
  const y = heights[0];
  if (referenceY !== undefined) {
    if (y - referenceY > WALK.step + EPS) return groundFailure('step');
    if (referenceY - y > WALK.drop + EPS) return groundFailure('edge');
  }
  if (Math.max(...heights) - y > WALK.step + EPS) return groundFailure('step');
  if (y - Math.min(...heights) > WALK.drop + EPS) return groundFailure('edge');
  const slope = Math.hypot(heights[1] - heights[2], heights[3] - heights[4]) / (2 * r);
  if (slope > WALK.slope + EPS) return groundFailure('slope');
  if (!bodyClear(env, x, y, z)) return groundFailure('clearance');
  return { ok: true, pos: { x, y, z } };
}

/** Axes in a stable camera frame, NOT flight pitch/invert or the character's facing. */
export function walkVector(x, z, yaw) {
  const n = Math.max(1, Math.hypot(x, z));
  return { x: (Math.cos(yaw) * x - Math.sin(yaw) * z) / n,
    z: (Math.sin(yaw) * x + Math.cos(yaw) * z) / n };
}

/** No input or world object is mutated. Each swept step is <= 20cm, at every frame rate. */
export function moveGround(env, pos, axes, yaw, dt, fast = false, lift = 0) {
  const dir = walkVector(axes.x || 0, axes.z || 0, yaw);
  const distance = Math.max(0, dt) * (fast ? WALK.fast : WALK.speed);
  const dx = dir.x * distance, dz = dir.z * distance;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / WALK.stride));
  let current = { ...pos }, travelled = 0, blocked = null;
  for (let i = 0; i < n; i++) {
    const result = probeGround(env, current.x + dx / n, current.z + dz / n, { referenceY: current.y });
    if (!result.ok) { blocked = result; break; }
    if (lift > 0 && !bodyClear(env, result.pos.x, result.pos.y, result.pos.z, WALK.height + lift)) {
      blocked = groundFailure('clearance'); break;
    }
    travelled += Math.hypot(result.pos.x - current.x, result.pos.z - current.z);
    current = result.pos;
  }
  return { pos: current, travelled, blocked };
}

// The floor a falling jump lands on: whatever now supports the feet, capped at the height the
// jump started from (a bridge overhead is not a floor for someone standing beneath it).
function jumpRest(env, x, z, startY) {
  const land = env.terrain.heightAt(x, z);
  const top = env.solid?.heightAt(x, z) ?? -Infinity;
  const water = Math.max(0.25, env.river?.levelAt(x, z) ?? -Infinity);
  const support = Math.max(land, top);
  const y = support <= startY + 1e-4 ? Math.max(support, water) : Math.max(land, water);
  return Number.isFinite(y) ? y : -Infinity;
}

export function moveJump(env, pos, jump, dt) {
  let { y, velocity, on } = jump;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n && on; i++) {
    const rest = jumpRest(env, pos.x, pos.z, pos.y);
    const next = Math.max(rest, y + velocity * h - JUMP.gravity * h * h / 2);
    if (bodyClear(env, pos.x, Math.min(y, next), pos.z, WALK.height + Math.abs(next - y))) {
      y = next;
      velocity -= JUMP.gravity * h;
    } else velocity = Math.min(0, velocity);
    if (y <= rest) { y = rest; velocity = 0; on = false; }
  }
  return { y, velocity, on };
}

/** Airborne steering during a jump: no ground support or edge rules, only the body's own clearance. */
export function moveAir(env, pos, dx, dz, feetY) {
  if (Math.hypot(dx, dz) < 1e-9 || bodyClear(env, pos.x + dx, feetY, pos.z + dz, WALK.height)) return true;
  return false;
}

/** A private anchor: deliberately not `pad.ground`, which already means a special town pad. */
export function groundAnchor(pos, yaw) {
  return { kind: 'ground', id: 'free-ground', name: '脚下落脚处', radius: 0.4, pos: { ...pos }, yaw, approach: yaw };
}

/** Carpet/body clearance along a heading; height fields represent solids all the way down. */
export function airClear(env, pos, yaw) {
  const dx = Math.sin(yaw), dz = -Math.cos(yaw);
  for (let d = -1.45; d <= 1.55; d += 0.2) {
    const x = pos.x + dx * d, z = pos.z + dz * d;
    for (const side of [-1, -0.5, 0, 0.5, 1]) {
      const sx = x - dz * side, sz = z + dx * side;
      const h = Math.max(env.terrain.heightAt(sx, sz), env.solid?.heightAt(sx, sz) ?? -Infinity,
        env.river?.levelAt(sx, sz) ?? -Infinity, 0);
      if (!Number.isFinite(h) || h > pos.y - 0.42) return false;
    }
    for (const side of [-0.66, -0.33, 0, 0.33, 0.66]) {
      if (!bodyClear(env, x - dz * side, pos.y - 0.35, z + dx * side, 1.8, 0.32)) return false;
    }
  }
  return true;
}
