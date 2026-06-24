// Procedural sky dome: gradient atmosphere, sun disc with glow, animated FBM
// clouds and night stars — one shader, no textures. Presets drive both the
// sky colors and the scene's sun/fog so worlds always feel coherent.

import * as THREE from 'three'

export interface SkyPreset {
  name: string
  /** sun direction (normalized-ish, y up) */
  sun: THREE.Vector3
  sunColor: number
  sunIntensity: number
  zenith: string
  horizon: string
  ground: string
  fog: string
  fogFar?: number
  ambient: number
  cloudTint: string
  starAmount: number // 0..1
  /** 0/1 — show the big planet (space preset) */
  planet?: number
}

/**
 * Registry-pattern extension point: add a custom sky/lighting preset, then
 * use its name in w.lighting('my-preset') or an @lighting map directive.
 */
export function registerSkyPreset(name: string, preset: SkyPreset) {
  if (SKY_PRESETS[name]) console.warn(`[blobcade] registerSkyPreset: overwriting '${name}'`)
  SKY_PRESETS[name] = preset
}

export const SKY_PRESETS: Record<string, SkyPreset> = {
  noon: {
    name: 'noon',
    sun: new THREE.Vector3(0.6, 0.85, 0.45),
    sunColor: 0xfff3e0,
    sunIntensity: 3.0,
    zenith: '#2f6fde',
    horizon: '#aee2ff',
    ground: '#8fb6c9',
    fog: '#bfe3f7',
    ambient: 0.55,
    cloudTint: '#ffffff',
    starAmount: 0,
  },
  morning: {
    name: 'morning',
    sun: new THREE.Vector3(0.9, 0.55, 0.2),
    sunColor: 0xffe7c4,
    sunIntensity: 2.9,
    zenith: '#3f7ad6',
    horizon: '#cfe9f7',
    ground: '#9fc0cf',
    fog: '#d3ecf9',
    ambient: 0.5,
    cloudTint: '#fff6ea',
    starAmount: 0,
  },
  goldenHour: {
    name: 'goldenHour',
    sun: new THREE.Vector3(-0.85, 0.38, 0.45),
    sunColor: 0xffc16e,
    sunIntensity: 3.4,
    zenith: '#3c5da8',
    horizon: '#ffb877',
    ground: '#7c6a8c',
    fog: '#f4bd8d',
    ambient: 0.42,
    cloudTint: '#ffd9ae',
    starAmount: 0.06,
  },
  night: {
    name: 'night',
    sun: new THREE.Vector3(0.3, 0.5, -0.6),
    sunColor: 0xbfd3ff,
    sunIntensity: 0.9,
    zenith: '#070b1d',
    horizon: '#1b2a55',
    ground: '#0b1020',
    fog: '#141d3a',
    ambient: 0.22,
    cloudTint: '#5b6c9c',
    starAmount: 1,
  },
  space: {
    name: 'space',
    sun: new THREE.Vector3(0.55, 0.62, -0.45),
    sunColor: 0xe6eeff,
    sunIntensity: 3.2,
    zenith: '#03040c',
    horizon: '#27316b',
    ground: '#1a2140',
    fog: '#0a1028',
    fogFar: 1000,
    ambient: 1.1, // hemisphere colors are dark — push intensity so interiors don't crush
    cloudTint: '#241a3f',
    starAmount: 1,
    planet: 1,
  },
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudTint;
uniform float uTime;
uniform float uStars;
uniform float uPlanet;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p *= 2.04;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  // atmosphere gradient
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
  sky = mix(uGround, sky, smoothstep(-0.12, 0.02, h));

  // sun disc + halo
  vec3 sunDir = normalize(uSunDir);
  float d = max(dot(dir, sunDir), 0.0);
  float halo = pow(d, 24.0) * 0.55 + pow(d, 350.0) * 2.4;
  float disc = smoothstep(0.9996, 0.99985, d) * 4.0;
  sky += uSunColor * (halo + disc);

  // big planet hanging in the sky (deep-space vibes)
  if (uPlanet > 0.5) {
    vec3 pDir = normalize(vec3(-0.4, 0.42, -0.82));
    float pd = dot(dir, pDir);
    float disc = smoothstep(0.978, 0.9815, pd);
    if (disc > 0.0) {
      // banded gas-giant surface
      vec3 flat3 = dir - pDir * pd;
      float band = fbm(vec2(flat3.y * 36.0 + 3.0, flat3.x * 9.0));
      vec3 pCol = mix(vec3(0.16, 0.32, 0.55), vec3(0.45, 0.66, 0.75), band);
      pCol = mix(pCol, vec3(0.83, 0.88, 0.92), smoothstep(0.55, 0.8, fbm(vec2(flat3.x * 22.0, flat3.y * 22.0 + 9.0))) * 0.5);
      // day/night terminator from the sun side
      float lit2 = clamp(dot(normalize(uSunDir - pDir * dot(uSunDir, pDir)), normalize(flat3 + vec3(1e-4))) * 0.5 + 0.62, 0.08, 1.0);
      sky = mix(sky, pCol * lit2, disc);
    }
    // atmosphere rim glow
    float rim = smoothstep(0.965, 0.979, pd) * (1.0 - smoothstep(0.979, 0.9835, pd));
    sky += vec3(0.25, 0.5, 0.9) * rim * 0.5;
  }

  // stars (night)
  if (uStars > 0.01 && h > 0.0) {
    vec2 sp = dir.xz / (dir.y + 0.6) * 80.0;
    float star = step(0.9982, hash21(floor(sp)));
    float tw = 0.6 + 0.4 * sin(uTime * 2.4 + hash21(floor(sp)) * 40.0);
    sky += vec3(star * tw * uStars * smoothstep(0.0, 0.25, h));
  }

  // clouds: two FBM layers drifting at different speeds
  if (h > 0.015) {
    vec2 cp = dir.xz / (h + 0.18);
    float c1 = fbm(cp * 0.9 + vec2(uTime * 0.012, uTime * 0.004));
    float c2 = fbm(cp * 2.1 - vec2(uTime * 0.02, 0.0));
    float cloud = smoothstep(0.52, 0.78, c1 * 0.72 + c2 * 0.38);
    float horizonFade = smoothstep(0.015, 0.18, h);
    float lit = 0.7 + 0.5 * max(dot(sunDir, vec3(0.0, 1.0, 0.0)), 0.15);
    vec3 cloudCol = uCloudTint * lit + uSunColor * pow(d, 6.0) * 0.25;
    sky = mix(sky, cloudCol, cloud * horizonFade * 0.85);
  }

  gl_FragColor = vec4(sky, 1.0);
}
`

export class SkyDome {
  mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial

  constructor(preset: SkyPreset) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(preset.zenith) },
        uHorizon: { value: new THREE.Color(preset.horizon) },
        uGround: { value: new THREE.Color(preset.ground) },
        uSunDir: { value: preset.sun.clone().normalize() },
        uSunColor: { value: new THREE.Color(preset.sunColor) },
        uCloudTint: { value: new THREE.Color(preset.cloudTint) },
        uTime: { value: 0 },
        uStars: { value: preset.starAmount },
        uPlanet: { value: preset.planet ?? 0 },
      },
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -100
  }

  update(t: number, cameraPos: THREE.Vector3) {
    this.mat.uniforms.uTime.value = t
    this.mesh.position.copy(cameraPos)
  }
}
