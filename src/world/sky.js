// Sky: analytic clear-sky gradient + sun, with a cloud layer baked into a lat-long texture.
import * as THREE from 'three';
import { U, shared } from '../core/ctx.js';
import { NOISE, ATMOSPHERE } from '../shaders/common.js';

export const SKY_UNIFORMS = ['uSunDir', 'uSunColor', 'uSkyZenith', 'uSkyMid', 'uSkyHorizon', 'uSunHalo', 'uAmbSky', 'uAmbGround', 'uFog', 'uCamPos', 'uClimate', 'uWeather', 'uDayNight'];

const tri = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
};

/** Cloud lookup shared with the water (reflections). Cloud map: RGB = lit colour (premultiplied), A = opacity. */
export const CLOUD_LOOKUP = /* glsl */`
uniform sampler2D uCloudTex;
uniform float uCloudOn;
// direction -> lat-long uv (upper hemisphere stretched so the horizon gets the texels)
vec2 cloudUV(vec3 d){
  float az = atan(d.z, d.x) * 0.15915494 + 0.5;
  float el = asin(clamp(d.y, -1.0, 1.0)) * 0.63661977;       // 0 at horizon, 1 at zenith
  return vec2(az, sqrt(clamp(el, 0.0, 1.0)));
}
vec4 sampleClouds(vec3 d){
  if (uCloudOn < 0.5 || d.y < -0.005) return vec4(0.0);
  vec2 uv = cloudUV(d);
  // manual gradients avoid the seam at the azimuth wrap
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);
  vec4 baked = textureGrad(uCloudTex, uv, dx, dy);
  baked.rgb *= mix(vec3(0.14, 0.2, 0.32), vec3(1.0), uDayNight.x);
  baked.rgb *= mix(vec3(1.0), vec3(1.2, 0.65, 0.48), uDayNight.z * 0.65);
  // Never rebake the static layer. Zero strength preserves even its premultiplied RGB exactly.
  float strength = clamp(uClimate.x, 0.0, 1.0);
  float cover = clamp(uWeather.y, 0.0, 1.0) * strength;
  if (cover <= 0.0) return baked;
  float overcast = smoothstep(0.30, 0.90, cover);
  float veil = cover * (0.34 + 0.56 * overcast) * (0.80 + 0.20 * baked.a);
  float alpha = baked.a + (1.0 - baked.a) * veil;
  vec3 grey = (uAmbSky * 0.95 + uSunColor * 0.075) * vec3(0.88, 0.93, 1.0);
  grey *= 1.0 - 0.28 * clamp(uWeather.x, 0.0, 1.0);
  // Tint occupied cloud texels in premultiplied space; fill gaps with the same grey radiance.
  vec3 rgb = mix(baked.rgb, grey * baked.a, overcast * 0.86);
  rgb += grey * (alpha - baked.a);
  return vec4(rgb, alpha);
}
`;

export class Sky {
  constructor() {
    this.cloudTex = { value: null };
    this.cloudOn = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared(...SKY_UNIFORMS),
        uProjInv: { value: new THREE.Vector2(1, 1) },
        uCamWorld: { value: new THREE.Matrix4() },
        uCloudTex: this.cloudTex,
        uCloudOn: this.cloudOn,
        uEnv: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vNdc;
        void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vNdc;
        uniform vec2 uProjInv;
        uniform mat4 uCamWorld;
        uniform float uEnv;       // 1 while baking the rider's environment map
        ${NOISE}
        ${ATMOSPHERE}
        ${CLOUD_LOOKUP}
        void main(){
          vec3 d = normalize(mat3(uCamWorld) * vec3(vNdc * uProjInv, -1.0));
          vec3 col = skyBase(d);
          float mu = dot(d, uSunDir);
          // sun: hot core with a soft limb; the bloom pass does the rest
          float disc = smoothstep(0.99982, 0.99994, mu);
          float corona = pow(max(mu, 0.0), 3000.0);
          vec3 sun = uSunColor * (disc * 55.0 + corona * 6.0) * (1.0 - uEnv) * uDayNight.x;
          vec2 starUv = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 160.0;
          vec2 starCell = floor(starUv);
          vec2 starOffset = fract(starUv) - 0.2 - hash22(starCell) * 0.6;
          float star = (1.0 - smoothstep(0.015, 0.16, length(starOffset))) * step(0.975, hash12(starCell + 17.0));
          float moonMu = dot(d, normalize(vec3(-0.42, 0.72, -0.55)));
          float moon = smoothstep(0.99935, 0.99958, moonMu);
          vec3 nightSky = vec3(0.62, 0.76, 1.0) * star * 1.6 + vec3(0.85, 0.9, 1.0) * moon * 1.8;
          nightSky += vec3(0.15, 0.22, 0.38) * pow(max(moonMu, 0.0), 180.0) * 0.15;
          col += nightSky * uDayNight.y * smoothstep(0.0, 0.12, d.y) * (1.0 - uEnv);
          vec4 cl = sampleClouds(d);
          col = col * (1.0 - cl.a) + cl.rgb + sun * (1.0 - cl.a) * (1.0 - cl.a);
          // under the horizon: haze into deep sea colour (only ever seen in reflections / at great height)
          float below = smoothstep(0.0, -0.08, d.y);
          col = mix(col, mix(uSkyHorizon * vec3(0.55, 0.7, 0.85), uAmbGround * 2.4, uEnv), below);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(tri(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    const sync = (renderer, scene, camera) => {
      const u = this.material.uniforms;
      u.uProjInv.value.set(1 / camera.projectionMatrix.elements[0], 1 / camera.projectionMatrix.elements[5]);
      u.uCamWorld.value.copy(camera.matrixWorld);
      this.material.uniformsNeedUpdate = true;
    };
    this.mesh.onBeforeRender = sync;
    this.envMesh = new THREE.Mesh(this.mesh.geometry, this.material);
    this.envMesh.frustumCulled = false;
    this.envMesh.onBeforeRender = sync;
  }

  /** Prefiltered environment (sky + clouds, no sun disc) for the rider's PBR materials. */
  bakeEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    scene.add(this.envMesh);
    this.material.uniforms.uEnv.value = 1;
    const rt = pmrem.fromScene(scene, 0, 0.1, 100);
    this.material.uniforms.uEnv.value = 0;
    pmrem.dispose();
    return rt.texture;
  }
}
