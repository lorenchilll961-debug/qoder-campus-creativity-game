import * as THREE from 'three';

const WING_CLEARANCE = 34;
const seaLevel = terrain => Math.max(2, terrain.meta.sea ?? 0);
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x,y,z);
const LOCAL_TIME = 29;
const approach = [
  [-82,66,-45],[-25,73,-93],[57,70,-82],[91,62,-31],[77,52,14],
  [43,35,10],[20,24,4],[-8,25,-4],[-39,43,-12],[-79,59,-14],
];

// Cross the fjord around its inland end and stay on the landward side of the southern bay.
const passes = {
  'east-estate': [[1510,-140],[1270,185],[845,477]],
  'south-estate': [[196,553],[-177,465]],
  'west-estate': [[-1070,-325]],
  'north-estate': [[-655,-470],[-287,-365],[26,-395],[360,-476]],
};

function footprint(terrain, p) {
  const sea = seaLevel(terrain);
  let floor = terrain.heightAt(p.x,p.z);
  if (floor <= sea) return Infinity;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const y = terrain.heightAt(p.x + WING_CLEARANCE*Math.cos(a), p.z + WING_CLEARANCE*Math.sin(a));
    if (y <= sea) return Infinity;
    floor = Math.max(floor,y);
  }
  return floor;
}

export function islandRoute(terrain, site) {
  const ground = terrain.heightAt(site.x,site.z);
  for (const degrees of [0,-45,45,-90,90,-135,135,180]) {
    const a = THREE.MathUtils.degToRad(degrees), cos = Math.cos(a), sin = Math.sin(a);
    const path = new THREE.CatmullRomCurve3(approach.map(([x,y,z]) =>
      v(site.x+1.12*(x*cos-z*sin),ground+y,site.z+1.12*(x*sin+z*cos))),true);
    if (path.getPoints(360).every(p=>p.y-footprint(terrain,p)>=17)) return path;
  }
  return null;
}

function flightBetween(terrain, from, to, waypoints) {
  const start = from.getPoint(0), end = to.getPoint(0);
  const departure = start.clone().addScaledVector(from.getTangent(0),42);
  const arrival = end.clone().addScaledVector(to.getTangent(0),-42);
  const planar = value => value.clone().setY(0);
  const path = new THREE.CatmullRomCurve3([
    planar(start),planar(departure),...waypoints.map(([x,z])=>v(x,0,z)),planar(arrival),planar(end),
  ]);
  const length = path.getLength(), count = Math.ceil(length/7);
  const floor = path.getSpacedPoints(count).map(p=>footprint(terrain,p));
  if (floor.some(y=>!Number.isFinite(y))) return null;
  const heights = floor.map((y,i) => {
    const t = i/count;
    const baseline = THREE.MathUtils.lerp(start.y,end.y,t);
    return Math.max(y + 24,baseline + 52*Math.sin(Math.PI*t));
  });
  heights[0] = start.y;
  heights[count] = end.y;
  // Spread climbs ahead of rising ground while leaving the patrol join fixed.
  for (let i=count-2;i>0;i--) heights[i]=Math.max(heights[i],heights[i+1]-7);
  for (let i=2;i<count;i++) heights[i]=Math.max(heights[i],heights[i-1]-7);
  const samples = path.getSpacedPoints(count);
  samples.forEach((p,i)=>p.y=heights[i]);
  const bridge = new THREE.CatmullRomCurve3(samples);
  const safe = bridge.getPoints(count*2).every(p=>p.y-footprint(terrain,p)>=17);
  return safe ? { path:bridge, duration:Math.max(8,length/68) } : null;
}

export function planPatrol(terrain, sites) {
  const local = sites.map(site=>islandRoute(terrain,site));
  if (local.some(path=>!path)) return null;
  const missions = [];
  let duration = 0;
  for (let i=0;i<sites.length;i++) {
    const bridge = flightBetween(terrain,local[i],local[(i+1)%sites.length],passes[sites[i].id]??[]);
    if (!bridge) return null;
    missions.push({ index:i, start:duration, end:duration+LOCAL_TIME, path:local[i], bridge });
    duration += LOCAL_TIME+bridge.duration;
  }
  return { duration, missions };
}

export function flightPhase(progress) {
  const slot = progress * approach.length;
  return slot < 2.55 ? 'patrol' : slot < 4.45 ? 'circle' : slot < 5.65 ? 'dive'
    : slot < 6.43 ? 'fire' : slot < 8.15 ? 'climb' : 'retreat';
}
