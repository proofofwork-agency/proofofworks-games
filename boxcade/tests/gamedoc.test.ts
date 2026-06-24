// GameDoc schema validation — the format docs live forever in URLs, files
// and the DB, so the validator's accept/warn/reject behavior is contract.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateGameDoc, GAMEDOC_VERSION, GAMEDOC_LIMITS, slugifyName } from '../src/sdk/gamedoc'
import { decodeGameDoc, encodeGameDoc } from '../src/sdk/codec'
import { RESERVED_EVENT_PREFIXES } from '../src/sdk/rules'

const minimal = () => ({ blobcade: 'gamedoc', v: 1, meta: { name: 'Test' } })
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/gamedoc/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>

describe('validateGameDoc', () => {
  it('accepts a minimal valid doc', () => {
    const res = validateGameDoc(minimal())
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.doc?.meta.name).toBe('Test')
  })

  it('accepts a JSON string input', () => {
    const res = validateGameDoc(JSON.stringify(minimal()))
    expect(res.ok).toBe(true)
  })

  it('accepts and normalizes the legacy boxcade marker', () => {
    const legacy = { boxcade: 'gamedoc', v: 1, meta: { name: 'Legacy' } }
    const res = validateGameDoc(legacy)
    expect(res.ok).toBe(true)
    expect(res.doc?.blobcade).toBe('gamedoc')
    expect('boxcade' in (res.doc as object)).toBe(false)
  })

  it('reads legacy .boxcade.json content and re-encodes with the blobcade marker', async () => {
    const legacyFileText = JSON.stringify({ boxcade: 'gamedoc', v: 1, meta: { name: 'Legacy File' } })
    const imported = validateGameDoc(legacyFileText)
    expect(imported.ok).toBe(true)
    expect(imported.doc?.blobcade).toBe('gamedoc')
    expect('boxcade' in (imported.doc as object)).toBe(false)

    const payload = await encodeGameDoc(imported.doc!)
    const decoded = await decodeGameDoc(payload) as Record<string, unknown>
    expect(decoded.blobcade).toBe('gamedoc')
    expect(decoded.boxcade).toBeUndefined()
  })

  it('rejects non-JSON strings and non-objects', () => {
    expect(validateGameDoc('not json{').ok).toBe(false)
    expect(validateGameDoc(42).ok).toBe(false)
    expect(validateGameDoc(null).ok).toBe(false)
    expect(validateGameDoc([]).ok).toBe(false)
  })

  it('rejects a missing marker / missing version', () => {
    expect(validateGameDoc({ v: 1, meta: { name: 'x' } }).ok).toBe(false)
    expect(validateGameDoc({ blobcade: 'gamedoc', meta: { name: 'x' } }).ok).toBe(false)
  })

  it('rejects newer versions with an update message', () => {
    const res = validateGameDoc({ ...minimal(), v: GAMEDOC_VERSION + 1 })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/newer Blobcade/)
  })

  it('round-trips the canonical current-version fixture', async () => {
    const doc = fixture('current-v2.json')
    expect(doc.v).toBe(GAMEDOC_VERSION)

    const before = validateGameDoc(doc)
    expect(before.ok, before.errors.join('\n')).toBe(true)

    const payload = await encodeGameDoc(before.doc!)
    const decoded = await decodeGameDoc(payload)
    expect(decoded).toEqual(before.doc)

    const after = validateGameDoc(decoded)
    expect(after.ok, after.errors.join('\n')).toBe(true)
  })

  it('rejects the future-version fixture with a clear update message', () => {
    const res = validateGameDoc(fixture('future-v999.json'))
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/newer Blobcade/)
    expect(res.errors.join(' ')).toMatch(/refresh|update/)
  })

  it.each([
    ['missing-version.json', /missing or invalid version number v/],
    ['invalid-version.json', /missing or invalid version number v/],
    ['too-old-v0.json', /unsupported\/too-old GameDoc version v0/],
  ])('rejects %s with a predictable version error', (file, message) => {
    const res = validateGameDoc(fixture(file))
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(message)
  })

  it('requires meta.name', () => {
    expect(validateGameDoc({ blobcade: 'gamedoc', v: 1, meta: {} }).ok).toBe(false)
    expect(validateGameDoc({ blobcade: 'gamedoc', v: 1 }).ok).toBe(false)
  })

  it('warns (not errors) on unknown top-level fields', () => {
    const res = validateGameDoc({ ...minimal(), futureThing: true })
    expect(res.ok).toBe(true)
    expect(res.warnings.join(' ')).toMatch(/futureThing/)
  })

  it('validates maxPlayers', () => {
    expect(validateGameDoc({ ...minimal(), maxPlayers: 64 }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), maxPlayers: 1 }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), maxPlayers: 250 }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), maxPlayers: 0 }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), maxPlayers: 251 }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), maxPlayers: 64.5 }).ok).toBe(false)
  })

  it('warns (not errors) on unknown part kinds and rule types', () => {
    const res = validateGameDoc({
      ...minimal(),
      parts: [{ kind: 'hovercraft', at: [0, 0, 0] }],
      rules: [
        { when: { type: 'fullMoon' }, do: [{ type: 'toast', text: 'hi' }] },
        { when: { type: 'start' }, do: [{ type: 'explode' }] },
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.warnings.length).toBeGreaterThanOrEqual(3)
  })

  it('rejects oversized documents and arrays', () => {
    const bigStr = '{"blobcade":"gamedoc","v":1,"meta":{"name":"x","blurb":"' + 'a'.repeat(GAMEDOC_LIMITS.json) + '"}}'
    expect(validateGameDoc(bigStr).ok).toBe(false)

    const manyParts = Array.from({ length: GAMEDOC_LIMITS.parts + 1 }, () => ({ kind: 'coin', at: [0, 0, 0] }))
    expect(validateGameDoc({ ...minimal(), parts: manyParts }).ok).toBe(false)
  })

  it('validates part shapes', () => {
    const bad = (parts: unknown[]) => validateGameDoc({ ...minimal(), parts })
    expect(bad([{ kind: 'part', at: [0, 0, 0] }]).ok).toBe(false) // no size
    expect(bad([{ kind: 'label', at: [0, 0, 0] }]).ok).toBe(false) // no text
    expect(bad([{ kind: 'part', at: 'nope', size: [1, 1, 1] }]).ok).toBe(false)
    expect(bad([{ kind: 'mover', at: [0, 0, 0], size: [1, 1, 1] }]).ok).toBe(false) // no by
    expect(bad([{ kind: 'part', at: [0, 0, 0], size: [1, 1, 1], color: '#fff' }]).ok).toBe(true)
    expect(bad([{ kind: 'water', at: [0, 0, 0], size: [8, 1, 8] }]).ok).toBe(true)
    expect(bad([{ kind: 'water', at: [0, 0, 0], size: [8, 0] }]).ok).toBe(false)
    expect(bad([{ kind: 'button', at: [0, 0, 0] }]).ok).toBe(true)
    expect(bad([{ kind: 'door', at: [0, 0, 0], tag: 'gate' }]).ok).toBe(true)
  })

  describe('vehicle parts', () => {
    const withVehicle = (part: Record<string, unknown>) =>
      validateGameDoc({ ...minimal(), parts: [{ kind: 'vehicle', at: [0, 1, 0], ...part }] })

    it('accepts a valid vehicle part', () => {
      const res = withVehicle({ vehicle: 'plane', speed: 34, fuel: 60, color: '#e8edf2' })
      expect(res.ok).toBe(true)
      expect(res.warnings).toEqual([])
    })

    it('requires the vehicle type field', () => {
      expect(withVehicle({}).ok).toBe(false)
    })

    it('rejects an unknown vehicle type', () => {
      expect(withVehicle({ vehicle: 'hovercraft' }).ok).toBe(false)
    })

    it('enforces the speed range', () => {
      expect(withVehicle({ vehicle: 'car', speed: 0 }).ok).toBe(false)
      expect(withVehicle({ vehicle: 'car', speed: 81 }).ok).toBe(false)
      expect(withVehicle({ vehicle: 'car', speed: 26 }).ok).toBe(true)
    })

    it('enforces the fuel range', () => {
      expect(withVehicle({ vehicle: 'jetpack', fuel: 0 }).ok).toBe(false)
      expect(withVehicle({ vehicle: 'jetpack', fuel: 601 }).ok).toBe(false)
      expect(withVehicle({ vehicle: 'jetpack', fuel: 10 }).ok).toBe(true)
    })
  })

  describe('physics, hitboxes and gravity zones', () => {
    const withPart = (part: Record<string, unknown>) =>
      validateGameDoc({ ...minimal(), parts: [part] })

    it('accepts fallDamage only as a boolean', () => {
      expect(validateGameDoc({ ...minimal(), physics: { fallDamage: true } }).ok).toBe(true)
      expect(validateGameDoc({ ...minimal(), physics: { fallDamage: false } }).ok).toBe(true)
      expect(validateGameDoc({ ...minimal(), physics: { fallDamage: 'yes' } }).ok).toBe(false)
    })

    it('validates part hitbox as a positive V3', () => {
      expect(withPart({ kind: 'part', at: [0, 0, 0], size: [2, 2, 2], hitbox: [1, 2, 1] }).ok).toBe(true)
      expect(withPart({ kind: 'part', at: [0, 0, 0], size: [2, 2, 2], hitbox: [1, 2] }).ok).toBe(false)
      expect(withPart({ kind: 'part', at: [0, 0, 0], size: [2, 2, 2], hitbox: [1, 0, 1] }).ok).toBe(false)
    })

    it('requires gravityZone size and gravity', () => {
      expect(withPart({ kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6], gravity: 0.3 }).ok).toBe(true)
      expect(withPart({ kind: 'gravityZone', at: [0, 3, 0], gravity: 0.3 }).ok).toBe(false)
      expect(withPart({ kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6] }).ok).toBe(false)
    })

    it('enforces the gravityZone gravity range', () => {
      expect(withPart({ kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6], gravity: 0.04 }).ok).toBe(false)
      expect(withPart({ kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6], gravity: 3.01 }).ok).toBe(false)
      expect(withPart({ kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6], gravity: 3 }).ok).toBe(true)
    })
  })

  // rotY is visual-only yaw, honored for the kinds the interpreter places via a
  // single w.add slab (door, mover, button, portal, ladder — 'part' already carried it).
  const withPart = (part: Record<string, unknown>) => validateGameDoc({ ...minimal(), parts: [part] })

  it('accepts a numeric rotY on door/mover/button/portal', () => {
    expect(withPart({ kind: 'door', at: [0, 0, 0], rotY: Math.PI / 4 }).ok).toBe(true)
    expect(withPart({ kind: 'mover', at: [0, 0, 0], size: [1, 1, 1], by: [0, 2, 0], rotY: 0 }).ok).toBe(true)
    expect(withPart({ kind: 'button', at: [0, 0, 0], rotY: -1.5 }).ok).toBe(true)
    expect(withPart({ kind: 'portal', at: [0, 0, 0], target: 'home', rotY: 3.14 }).ok).toBe(true)
    expect(withPart({ kind: 'ladder', at: [0, 2.5, 0], size: [1.4, 5, 0.25], rotY: Math.PI / 2 }).ok).toBe(true)
  })

  it('rejects a non-numeric rotY on door/mover/button/portal', () => {
    expect(withPart({ kind: 'door', at: [0, 0, 0], rotY: '90deg' }).ok).toBe(false)
    expect(withPart({ kind: 'mover', at: [0, 0, 0], size: [1, 1, 1], by: [0, 2, 0], rotY: 'x' }).ok).toBe(false)
    expect(withPart({ kind: 'button', at: [0, 0, 0], rotY: NaN }).ok).toBe(false)
    expect(withPart({ kind: 'portal', at: [0, 0, 0], target: 'home', rotY: 'left' }).ok).toBe(false)
    expect(withPart({ kind: 'ladder', at: [0, 0, 0], rotY: 'left' }).ok).toBe(false)
  })

  it('validates rule shapes', () => {
    const bad = (rules: unknown[]) => validateGameDoc({ ...minimal(), rules })
    expect(bad([{ when: { type: 'start' }, do: [] }]).ok).toBe(false) // empty do
    expect(bad([{ when: { type: 'touch' }, do: [{ type: 'kill' }] }]).ok).toBe(false) // touch w/o part
    expect(bad([{ when: { type: 'start' }, do: [{ type: 'movePart', part: 'x' }] }]).ok).toBe(false) // no to/by
    expect(bad([{ when: { type: 'start' }, do: [{ type: 'teleport', to: [1, 2] }] }]).ok).toBe(false)
    expect(bad([{ when: { type: 'touch', part: 'button' }, do: [{ type: 'openDoor', part: 'door' }] }]).ok).toBe(true)
    expect(bad([
      { when: { type: 'varReaches', var: 'score', gte: 5 }, if: [{ var: 'lives', op: 'gt', value: 0 }], do: [{ type: 'win' }] },
    ]).ok).toBe(true)
  })

  it('validates vars', () => {
    expect(validateGameDoc({ ...minimal(), vars: { score: 0, lives: 3 } }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), vars: { score: 'high' } }).ok).toBe(false)
  })

  it('validates scripted GameDoc v2 documents', () => {
    expect(validateGameDoc({ ...minimal(), v: 2, script: 'blobcade.toast("hi")' }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), script: 'blobcade.toast("hi")' }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), levels: [{ script: 'blobcade.toast("hi")' }] }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), v: 2, script: 'x'.repeat(GAMEDOC_LIMITS.script + 1) }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), v: 2, script: 42 }).ok).toBe(false)
  })

  it('validates editor-only Studio mode metadata', () => {
    const valid = validateGameDoc({
      ...minimal(),
      studio: { schema: 1, mode: 'waves', settings: { baseBots: 2 }, scriptManaged: true },
    })
    expect(valid.ok).toBe(true)
    expect(valid.warnings).toEqual([])

    expect(validateGameDoc({ ...minimal(), studio: { mode: 'racing' } }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), studio: { schema: 2 } }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), studio: { scriptManaged: 'yes' } }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), studio: { settings: 'waves' } }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), studio: { settings: { text: 'x'.repeat(GAMEDOC_LIMITS.studioSettings + 1) } } }).ok).toBe(false)
  })

  it('accepts the new rule triggers and actions', () => {
    const res = validateGameDoc({
      ...minimal(),
      rules: [
        { when: { type: 'checkpoint' }, do: [{ type: 'toast', text: 'saved!' }] },
        { when: { type: 'hurt' }, do: [{ type: 'givePoints', var: 'score', amount: -1 }] },
        { when: { type: 'hurt' }, do: [{ type: 'givePoints' }] }, // bare sugar
        { when: { type: 'start' }, do: [{ type: 'restart' }] },
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([])
  })

  it('rejects malformed new-action fields but still warns on unknown ones', () => {
    const bad = (rules: unknown[]) => validateGameDoc({ ...minimal(), rules })
    expect(bad([{ when: { type: 'start' }, do: [{ type: 'givePoints', var: 5 }] }]).ok).toBe(false)
    expect(bad([{ when: { type: 'start' }, do: [{ type: 'givePoints', amount: 'lots' }] }]).ok).toBe(false)
    // unknown trigger/action still warn-not-error (forward-compat contract)
    const fwd = bad([{ when: { type: 'fullMoon' }, do: [{ type: 'restart' }] }, { when: { type: 'hurt' }, do: [{ type: 'teleportToMoon' }] }])
    expect(fwd.ok).toBe(true)
    expect(fwd.warnings.length).toBeGreaterThanOrEqual(2)
  })
})

describe('validateGameDoc — services and store (W4)', () => {
  const item = (patch: Record<string, unknown> = {}) => ({
    id: 'red-shirt',
    name: 'Red Shirt',
    kind: 'shirt',
    color: '#ff0033',
    price: 25,
    ...patch,
  })

  it('accepts valid services', () => {
    const res = validateGameDoc({
      ...minimal(),
      services: {
        chat: true,
        leaderboard: false,
        store: [item(), item({ id: 'blue-trail', name: 'Blue Trail', kind: 'trail', color: '#3366ff', price: 50 })],
      },
    })
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([])
  })

  it('rejects non-boolean service toggles', () => {
    expect(validateGameDoc({ ...minimal(), services: { chat: 'yes' } }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), services: { leaderboard: 1 } }).ok).toBe(false)
  })

  it('caps store items at 8', () => {
    const store = Array.from({ length: GAMEDOC_LIMITS.storeItems + 1 }, (_, i) => item({ id: `item-${i}`, name: `Item ${i}` }))
    expect(validateGameDoc({ ...minimal(), services: { store } }).ok).toBe(false)
  })

  it('rejects bad store kind, price, and color', () => {
    const bad = (patch: Record<string, unknown>) => validateGameDoc({ ...minimal(), services: { store: [item(patch)] } })
    expect(bad({ kind: 'hat' }).ok).toBe(false)
    expect(bad({ price: 0 }).ok).toBe(false)
    expect(bad({ price: 501 }).ok).toBe(false)
    expect(bad({ price: 12.5 }).ok).toBe(false)
    expect(bad({ color: 'red' }).ok).toBe(false)
  })

  it('rejects duplicate or malformed store ids', () => {
    expect(validateGameDoc({ ...minimal(), services: { store: [item(), item({ name: 'Other' })] } }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), services: { store: [item({ id: 'Red Shirt' })] } }).ok).toBe(false)
  })
})

describe('validateGameDoc — custom weapons', () => {
  const validWeapon = () => ({
    id: 'blaster', name: 'Blaster', kind: 'projectile' as const, damage: 18, fireRate: 6,
  })

  it('accepts a minimal valid weapon and a fully-loaded one', () => {
    expect(validateGameDoc({ ...minimal(), weapons: [validWeapon()] }).ok).toBe(true)
    const full = validateGameDoc({
      ...minimal(),
      weapons: [{
        id: 'super-rail', name: 'Super Rail', kind: 'hitscan', damage: 90, fireRate: 0.8,
        icon: '🎯', pellets: 1, spread: 0, range: 300, beamColor: '#fff', beamWidth: 0.04,
        zoomFov: 20, ammoMax: 12, ammoPickup: 4, sound: 'sniper',
      }],
    })
    expect(full.ok).toBe(true)
    expect(full.warnings).toEqual([])
  })

  it('accepts a projectile sub-object within range', () => {
    const res = validateGameDoc({
      ...minimal(),
      weapons: [{ ...validWeapon(), projectile: { speed: 40, radius: 0.16, color: '#5f5', gravity: -14, splash: 4, life: 2 } }],
    })
    expect(res.ok).toBe(true)
  })

  it('enforces required weapon fields', () => {
    const bad = (w: unknown) => validateGameDoc({ ...minimal(), weapons: [w] })
    expect(bad({ name: 'No Id', kind: 'hitscan', damage: 10, fireRate: 2 }).ok).toBe(false)
    expect(bad({ id: 'x', kind: 'hitscan', damage: 10, fireRate: 2 }).ok).toBe(false) // no name
    expect(bad({ id: 'x', name: 'X', kind: 'laser', damage: 10, fireRate: 2 }).ok).toBe(false) // bad kind
    expect(bad({ id: 'x', name: 'X', kind: 'hitscan', fireRate: 2 }).ok).toBe(false) // no damage
    expect(bad({ id: 'x', name: 'X', kind: 'hitscan', damage: 10 }).ok).toBe(false) // no fireRate
  })

  it('enforces id slug + length rules', () => {
    const bad = (id: unknown) => validateGameDoc({ ...minimal(), weapons: [{ ...validWeapon(), id }] })
    expect(bad('Blaster').ok).toBe(false) // uppercase
    expect(bad('big gun').ok).toBe(false) // space
    expect(bad('a'.repeat(25)).ok).toBe(false) // too long
    expect(bad('rail-gun-2').ok).toBe(true) // dashes + digits ok
  })

  it('enforces numeric ranges', () => {
    const bad = (patch: Record<string, unknown>) => validateGameDoc({ ...minimal(), weapons: [{ ...validWeapon(), ...patch }] })
    expect(bad({ damage: 0 }).ok).toBe(false)
    expect(bad({ damage: 101 }).ok).toBe(false)
    expect(bad({ fireRate: 0 }).ok).toBe(false)
    expect(bad({ fireRate: 21 }).ok).toBe(false)
    expect(bad({ pellets: 0 }).ok).toBe(false)
    expect(bad({ pellets: 13 }).ok).toBe(false)
    expect(bad({ range: 401 }).ok).toBe(false)
    expect(bad({ zoomFov: 7 }).ok).toBe(false)
    expect(bad({ zoomFov: 71 }).ok).toBe(false)
    expect(bad({ ammoMax: 1000 }).ok).toBe(false)
    expect(bad({ projectile: { speed: 0, radius: 0.16, color: '#fff' } }).ok).toBe(false)
    expect(bad({ projectile: { speed: 40, radius: 2, color: '#fff' } }).ok).toBe(false)
    expect(bad({ projectile: { speed: 40, radius: 0.16, color: '#fff', splash: 11 } }).ok).toBe(false)
  })

  it('rejects non-arrays and oversized weapon lists', () => {
    expect(validateGameDoc({ ...minimal(), weapons: 'rockets' }).ok).toBe(false)
    const many = Array.from({ length: GAMEDOC_LIMITS.weapons + 1 }, (_, i) => ({ ...validWeapon(), id: `w${i}` }))
    expect(validateGameDoc({ ...minimal(), weapons: many }).ok).toBe(false)
  })
})

describe('validateGameDoc — portal parts (W2)', () => {
  const withPortal = (portal: Record<string, unknown>) =>
    validateGameDoc({ ...minimal(), parts: [{ kind: 'portal', at: [0, 0, 0], ...portal }] })

  it('accepts every valid target form', () => {
    expect(withPortal({ target: 'g:lavamaze7' }).ok).toBe(true)
    expect(withPortal({ target: 'draft:my-wip_2' }).ok).toBe(true)
    expect(withPortal({ target: 'level:3' }).ok).toBe(true)
    expect(withPortal({ target: 'home' }).ok).toBe(true)
    // optional label/size/color
    expect(withPortal({ target: 'home', label: 'Back to lobby', size: [3, 4, 0.5], color: '#fff' }).ok).toBe(true)
  })

  it('requires target and rejects malformed targets', () => {
    expect(withPortal({}).ok).toBe(false) // no target
    expect(withPortal({ target: '' }).ok).toBe(false) // empty
    expect(withPortal({ target: 'g:Lava-Maze' }).ok).toBe(false) // uppercase + dash in published id
    expect(withPortal({ target: 'level:12' }).ok).toBe(false) // multi-digit not allowed by /level:\d/
    expect(withPortal({ target: 'level:x' }).ok).toBe(false)
    expect(withPortal({ target: 'house' }).ok).toBe(false) // not 'home'
    expect(withPortal({ target: 'draft:' }).ok).toBe(false) // empty draft key
    expect(withPortal({ target: 42 }).ok).toBe(false) // not a string
  })

  it('enforces the label length cap (40)', () => {
    expect(withPortal({ target: 'home', label: 'a'.repeat(40) }).ok).toBe(true)
    expect(withPortal({ target: 'home', label: 'a'.repeat(41) }).ok).toBe(false)
    expect(withPortal({ target: 'home', label: 123 }).ok).toBe(false)
  })

  it('rejects a bad portal size', () => {
    expect(withPortal({ target: 'home', size: [1, 2] }).ok).toBe(false)
  })
})

describe('validateGameDoc — goTo action (W2)', () => {
  const withGoTo = (action: Record<string, unknown>) =>
    validateGameDoc({ ...minimal(), rules: [{ when: { type: 'start' }, do: [{ type: 'goTo', ...action }] }] })

  it('is a known action and validates its target', () => {
    const ok = withGoTo({ target: 'g:arena' })
    expect(ok.ok).toBe(true)
    expect(ok.warnings).toEqual([]) // not treated as an unknown action
    expect(withGoTo({ target: 'level:1' }).ok).toBe(true)
    expect(withGoTo({ target: 'home' }).ok).toBe(true)
  })

  it('rejects a missing or malformed target', () => {
    expect(withGoTo({}).ok).toBe(false)
    expect(withGoTo({ target: 'nope:zone' }).ok).toBe(false)
    expect(withGoTo({ target: 'level:99' }).ok).toBe(false)
  })

  it('reserves the platform: prefix from the user emit action', () => {
    // a goTo action is fine; a raw emit of platform:* is blocked at runtime
    // (see rules.test / interpret), but validation accepts the emit shape —
    // here we just confirm platform: is now in the reserved list.
    expect(RESERVED_EVENT_PREFIXES).toContain('platform:')
  })
})

describe('validateGameDoc — multi-level docs (W2)', () => {
  const lvl = (extra: Record<string, unknown> = {}) => ({
    parts: [{ kind: 'coin', at: [0, 1, 0] }],
    ...extra,
  })

  it('accepts a doc with levels that omit blobcade/v/meta', () => {
    const res = validateGameDoc({ ...minimal(), lighting: 'noon', levels: [lvl(), lvl({ lighting: 'night' })] })
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([])
  })

  it('validates a level when it does carry its own meta', () => {
    expect(validateGameDoc({ ...minimal(), levels: [lvl({ meta: { name: 'Stage 2' } })] }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), levels: [lvl({ meta: { name: '' } })] }).ok).toBe(false) // empty name
    expect(validateGameDoc({ ...minimal(), levels: [lvl({ meta: { name: 'x'.repeat(49) } })] }).ok).toBe(false)
  })

  it('rejects nested levels (depth 1 only)', () => {
    const res = validateGameDoc({ ...minimal(), levels: [lvl({ levels: [lvl()] })] })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/nested levels/)
  })

  it('caps the number of levels at 8', () => {
    const eight = Array.from({ length: GAMEDOC_LIMITS.levels }, () => lvl())
    expect(validateGameDoc({ ...minimal(), levels: eight }).ok).toBe(true)
    expect(validateGameDoc({ ...minimal(), levels: [...eight, lvl()] }).ok).toBe(false)
  })

  it('validates each level body like a top-level doc', () => {
    // a bad part inside a level is a hard error (with a levels[i] path)
    const res = validateGameDoc({ ...minimal(), levels: [lvl({ parts: [{ kind: 'part', at: [0, 0, 0] }] })] })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/levels\[0\]\.parts\[0\]/)
  })

  it('rejects a non-array / non-object level', () => {
    expect(validateGameDoc({ ...minimal(), levels: 'two' }).ok).toBe(false)
    expect(validateGameDoc({ ...minimal(), levels: [42] }).ok).toBe(false)
  })

  it('still applies the whole-doc JSON size cap across levels', () => {
    const fat = { parts: [{ kind: 'label', at: [0, 0, 0], text: 'x' }], textmap: 'a'.repeat(GAMEDOC_LIMITS.textmap + 1) }
    // an oversized textmap inside a level is caught by the per-level body check
    expect(validateGameDoc({ ...minimal(), levels: [fat] }).ok).toBe(false)
  })
})

describe('slugifyName', () => {
  it('slugs names', () => {
    expect(slugifyName('Lava Maze!')).toBe('lava-maze')
    expect(slugifyName('  ÜBER   Tower  ')).toBe('ber-tower')
    expect(slugifyName('!!!')).toBe('untitled')
  })
})
