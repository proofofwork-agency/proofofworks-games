// Rendering core. The look follows the modern AAA post-processing playbook:
//   - ACES filmic tone mapping (the industry-standard filmic curve)
//   - bloom (three.js's UnrealBloomPass addon)
//   - GTAO ground-truth ambient occlusion
//   - PCF soft cascading-ish sun shadows that follow the player
// ...applied to deliberately simple blocky geometry. Premium light on
// friendly shapes is the whole Blobcade aesthetic.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js'
import { SkyDome, SKY_PRESETS, type SkyPreset } from './sky'

export class Renderer {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  sky: SkyDome
  preset: SkyPreset
  composer: EffectComposer
  /** screen-space ray-traced reflections currently running */
  ssrActive = false
  private renderPass: RenderPass
  private ssr: SSRPass | null = null
  private gtao: GTAOPass | null = null
  private bloom: UnrealBloomPass
  private output: OutputPass
  private envRT: THREE.WebGLRenderTarget | null = null
  private envSky: SkyDome | null = null
  private onResizeBound: () => void
  private host: HTMLElement
  private disposed = false

  constructor(host: HTMLElement, presetName: string) {
    this.host = host
    this.preset = SKY_PRESETS[presetName] ?? SKY_PRESETS.noon

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.setSize(host.clientWidth, host.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.18
    host.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(new THREE.Color(this.preset.fog), 70, this.preset.fogFar ?? 420)

    this.camera = new THREE.PerspectiveCamera(
      70,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.1,
      1200,
    )
    // the camera lives in the scene graph so children (FP weapon viewmodels)
    // actually render
    this.scene.add(this.camera)

    // sun + sky + ambient
    this.sun = new THREE.DirectionalLight(this.preset.sunColor, this.preset.sunIntensity)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const s = 55
    this.sun.shadow.camera.left = -s
    this.sun.shadow.camera.right = s
    this.sun.shadow.camera.top = s
    this.sun.shadow.camera.bottom = -s
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 320
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.hemi = new THREE.HemisphereLight(
      new THREE.Color(this.preset.horizon),
      new THREE.Color(this.preset.ground),
      this.preset.ambient * 2.5,
    )
    this.scene.add(this.hemi)

    // sky-tinted fill from the opposite side of the sun (fakes bounce/GI so
    // shadowed faces stay readable instead of crushing to black)
    const fillDir = this.preset.sun.clone().normalize()
    const fill = new THREE.DirectionalLight(new THREE.Color(this.preset.horizon), 0.7)
    fill.position.set(-fillDir.x * 80, 50, -fillDir.z * 80)
    fill.castShadow = false
    this.scene.add(fill)
    this.scene.add(fill.target)

    this.sky = new SkyDome(this.preset)
    this.scene.add(this.sky.mesh)

    // Image-based lighting: bake the procedural sky into an environment map.
    // Every standard material gets sky-colored ambient + real reflections —
    // metal/ice/gold mirror the sun, clouds, even the space planet.
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      const envScene = new THREE.Scene()
      this.envSky = new SkyDome(this.preset)
      envScene.add(this.envSky.mesh)
      const envRT = pmrem.fromScene(envScene, 0.05, 1, 1100)
      this.envRT = envRT
      this.scene.environment = envRT.texture
      this.scene.environmentIntensity = 0.5
      pmrem.dispose()
    } catch (err) {
      console.warn('[blobcade] environment map unavailable, continuing without IBL', err)
    }

    // ---- post-processing stack ----
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)

    try {
      this.gtao = new GTAOPass(this.scene, this.camera, host.clientWidth, host.clientHeight)
      this.gtao.updateGtaoMaterial({
        radius: 0.5,
        distanceExponent: 1.6,
        thickness: 1.0,
        scale: 1.1,
        samples: 12,
        distanceFallOff: 1.0,
        screenSpaceRadius: false,
      })
      this.gtao.blendIntensity = 0.6
      this.composer.addPass(this.gtao)
    } catch (err) {
      console.warn('[blobcade] GTAO unavailable, continuing without AO', err)
    }

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(host.clientWidth, host.clientHeight),
      0.32, // strength: subtle — lava, neon and the sun should glow, not the world
      0.55,
      0.88,
    )
    this.composer.addPass(this.bloom)
    this.output = new OutputPass()
    this.composer.addPass(this.output)

    this.onResizeBound = () => this.onResize()
    window.addEventListener('resize', this.onResizeBound)
  }

  private onResize() {
    const w = this.host.clientWidth
    const h = Math.max(1, this.host.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }

  /**
   * Screen-space ray-traced reflections (SSR): rays are marched through the
   * depth buffer each frame, so the listed meshes mirror whatever is actually
   * on screen — towers, neon, avatars, rocket trails. Pass the live array of
   * reflective meshes; meshes added to it later are picked up automatically.
   */
  enableReflections(selects: THREE.Mesh[]) {
    if (this.ssr) return
    try {
      const ssr = new SSRPass({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        width: this.host.clientWidth,
        height: Math.max(1, this.host.clientHeight),
        selects,
        groundReflector: null,
      })
      ssr.maxDistance = 36
      ssr.opacity = 0.55
      ssr.thickness = 0.06
      this.composer.removePass(this.renderPass)
      this.composer.insertPass(ssr, 0)
      this.ssr = ssr
      this.ssrActive = true
    } catch (err) {
      console.warn('[blobcade] SSR unavailable, continuing without reflections', err)
    }
  }

  /** drop SSR and fall back to the plain render pass (perf guard) */
  disableReflections() {
    if (!this.ssr) return
    this.composer.removePass(this.ssr)
    this.composer.insertPass(this.renderPass, 0)
    this.ssr.dispose()
    this.ssr = null
    this.ssrActive = false
  }

  /** Keep the shadow frustum centered on the player, snapped to texels to avoid shimmer. */
  updateSun(focus: THREE.Vector3) {
    const dir = this.preset.sun.clone().normalize()
    const snap = 2
    const fx = Math.round(focus.x / snap) * snap
    const fz = Math.round(focus.z / snap) * snap
    this.sun.position.set(fx + dir.x * 120, dir.y * 120, fz + dir.z * 120)
    this.sun.target.position.set(fx, 0, fz)
  }

  render(t: number) {
    this.sky.update(t, this.camera.position)
    this.composer.render()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    window.removeEventListener('resize', this.onResizeBound)
    this.disableReflections()
    this.gtao?.dispose()
    this.gtao = null
    this.bloom.dispose()
    this.output.dispose()
    this.renderPass.dispose()
    this.composer.dispose()
    this.sky.dispose()
    this.envSky?.dispose()
    this.envSky = null
    this.scene.environment = null
    this.envRT?.dispose()
    this.envRT = null
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
