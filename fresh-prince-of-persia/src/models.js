import * as THREE from 'three';

// Procedural low-poly character builder. Characters face +X; the group origin is at the feet.
// One builder makes the hero and every guard tier via options — no external assets.

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.ei ?? 1,
    })
  );
  m.castShadow = true;
  return m;
}

export function buildCharacter(opts = {}) {
  const {
    skin = 0x8d5a3b, top = 0x14d4c0, bottom = 0x5b2d8e, shoe = 0xf5f5f5,
    capColor = 0xe5273e, hat = 'cap', chain = false, shades = false,
    sword = false, swordColor = 0xd8e6ff,
  } = opts;

  const g = new THREE.Group();
  const parts = {};

  const mkLeg = (z) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.88, z);
    const thigh = box(0.19, 0.88, 0.19, bottom);
    thigh.geometry.translate(0, -0.44, 0);
    pivot.add(thigh);
    const sneaker = box(0.34, 0.13, 0.2, shoe, { rough: 0.45 });
    sneaker.position.set(0.07, -0.84, 0);
    pivot.add(sneaker);
    const sole = box(0.36, 0.05, 0.22, capColor, { rough: 0.5 });
    sole.position.set(0.07, -0.92, 0);
    pivot.add(sole);
    return pivot;
  };
  parts.legL = mkLeg(-0.13); parts.legR = mkLeg(0.13);
  g.add(parts.legL, parts.legR);

  const torso = box(0.5, 0.64, 0.34, top);
  torso.position.set(0, 1.18, 0);
  g.add(torso); parts.torso = torso;
  const hood = box(0.18, 0.22, 0.28, top);
  hood.position.set(-0.3, 1.4, 0);
  g.add(hood);

  if (chain) {
    const ch = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.03, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 0.9, roughness: 0.2, emissive: 0x6b5200, emissiveIntensity: 0.5 })
    );
    ch.position.set(0.26, 1.3, 0);
    ch.rotation.y = Math.PI / 2;
    g.add(ch);
  }

  const head = box(0.34, 0.34, 0.3, skin);
  head.position.set(0, 1.68, 0);
  g.add(head); parts.head = head;

  if (hat === 'cap') {
    const crown = box(0.38, 0.13, 0.34, capColor, { rough: 0.6 });
    crown.position.set(0.01, 1.89, 0);
    const brim = box(0.28, 0.045, 0.3, capColor, { rough: 0.6 });
    brim.position.set(-0.31, 1.85, 0);              // backwards. obviously.
    g.add(crown, brim);
  } else if (hat === 'turban') {
    const tb = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 12, 10),
      new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.8 })
    );
    tb.position.set(0, 1.9, 0);
    tb.scale.set(1.1, 0.75, 1.05);
    tb.castShadow = true;
    const jewel = box(0.05, 0.09, 0.05, 0xffd54a, { metal: 0.9, rough: 0.2, emissive: 0x6b5200, ei: 0.8 });
    jewel.position.set(0.2, 1.92, 0);
    g.add(tb, jewel);
  } else if (hat === 'phones') {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.045, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 0.85, roughness: 0.3, emissive: 0x6b5200, emissiveIntensity: 0.6 })
    );
    band.position.set(0, 1.78, 0);
    band.rotation.y = Math.PI / 2;
    g.add(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0x16161d, metalness: 0.6, roughness: 0.35, emissive: 0xff2d95, emissiveIntensity: 0.35 })
      );
      cup.rotation.x = Math.PI / 2;
      cup.position.set(0, 1.68, s * 0.19);
      g.add(cup);
    }
  }

  if (shades) {
    const sh = box(0.06, 0.1, 0.3, 0x0a0a0a, { rough: 0.15, metal: 0.5, emissive: 0x19e3ff, ei: 0.12 });
    sh.position.set(0.18, 1.72, 0);
    g.add(sh);
  }

  const mkArm = (z) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.45, z);
    const arm = box(0.16, 0.58, 0.16, top);
    arm.geometry.translate(0, -0.29, 0);
    pivot.add(arm);
    const hand = box(0.14, 0.14, 0.14, skin);
    hand.position.set(0, -0.6, 0);
    pivot.add(hand);
    return pivot;
  };
  parts.armL = mkArm(-0.28); parts.armR = mkArm(0.28);
  g.add(parts.armL, parts.armR);

  if (sword) {
    const sw = new THREE.Group();
    sw.position.set(0, -0.6, 0);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: swordColor, metalness: 0.95, roughness: 0.12,
      emissive: 0x334455, emissiveIntensity: 0.5,
    });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.025), bladeMat);
    blade.geometry.translate(0, -0.5, 0);
    blade.castShadow = true;
    const hilt = box(0.2, 0.05, 0.07, 0xffd54a, { metal: 0.9, rough: 0.25 });
    hilt.position.set(0, -0.06, 0);
    sw.add(blade, hilt);
    parts.sword = sw;
    parts.swordMat = bladeMat;
    parts.armR.add(sw);
  }

  return { group: g, parts };
}

// Smoothly drive limb rotations toward a pose target each frame.
// target: { aL, aR, lL, lR, sw } (radians; rotation around Z — the swing plane).
// Keys left undefined are not driven — lets attack code own the sword arm directly.
export function applyPose(parts, target, k) {
  const f = Math.min(1, k);
  const d = (o, v) => { if (v === undefined || !o) return; o.rotation.z += (v - o.rotation.z) * f; };
  d(parts.armL, target.aL);
  d(parts.armR, target.aR);
  d(parts.legL, target.lL);
  d(parts.legR, target.lR);
  if (parts.sword && target.sw !== undefined) {
    parts.sword.rotation.z += (target.sw - parts.sword.rotation.z) * f;
  }
}

// Overhead slash: arm angle as a function of attack progress p in [0,1].
// Wind-up raises the arm up-and-back (θ≈3.35), then a fast eased whip down
// through the FRONT arc to θ≈1.0, then recover. Never sweeps the bottom.
export function slashArmAngle(p, windEnd, slashEnd, rest = 0) {
  if (p < windEnd) {
    const k = p / windEnd;
    return rest + (3.35 - rest) * k * k;
  }
  if (p < slashEnd) {
    const k = (p - windEnd) / (slashEnd - windEnd);
    return 3.35 + (1.0 - 3.35) * (1 - Math.pow(1 - k, 3));
  }
  const k = (p - slashEnd) / (1 - slashEnd);
  const s = k * k * (3 - 2 * k);
  return 1.0 + (rest - 1.0) * s;
}

// Glowing arc the blade sweeps through — child of the character group.
export function makeSlashArc(color = 0xffe08a) {
  const geo = new THREE.RingGeometry(0.5, 1.55, 26, 1, -0.55, 2.4);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0.12, 1.45, 0.38);
  m.renderOrder = 5;
  return m;
}
