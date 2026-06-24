---
sidebar_position: 2
description: The seven built-in weapons, the combat config, and how to add your own.
---

# Weapons & combat reference

Setting `GameDef.combat` switches on the arsenal. Weapons are **pure data**
(`WeaponDef`); seven tournament-style archetypes ship built-in, every number tunable, and
`registerWeapon(def)` adds your own.

## The built-in arsenal (`WEAPONS`)

| Weapon | Type | Damage | Fire rate | Range | Notes |
| --- | --- | --- | --- | --- | --- |
| 🔫 **Sidearm** | hitscan | 15 | 3.4 | 90 | starting pistol — ammo never runs dry |
| ⚡ **Shock Lance** | hitscan beam | 40 | 1.5 | 140 | the long-range duel weapon |
| 🟢 **Pulse Blaster** | projectile | 12 | 7 | — | fast plasma spam |
| 🌀 **Minigun** | hitscan | 7 | 14 | 100 | high rate, wide spread |
| 💥 **Flak Scattergun** | 8-pellet projectile | 11/pellet | 1.15 | — | shotgun arcs with gravity |
| 🚀 **Rocket Launcher** | projectile + splash | 72 | 0.95 | — | knockback — rocket jumps work |
| 🎯 **Sniper Rifle** | hitscan | 70 | 0.85 | 220 | right-click zoom, 2× headshots |

`DEFAULT_LOADOUT` is all seven. The sidearm never runs dry; every other weapon tracks a
per-entity ammo pool. The HUD shows a live ammo counter + per-slot counts.

## Combat config

```ts
interface CombatConfig {
  health: number                       // starting/max HP
  respawnSeconds: number               // respawn delay
  weapons: Array<string | WeaponDef>   // the arsenal: ids (registry names) or full defs
  startWeapons?: string[]              // ids held at spawn (default: whole arsenal)
  infiniteAmmo?: boolean               // classic mode — nothing consumes ammo
}
```

A game adds the doc-only `selfTeam` to pick the local player's team:

```ts
combat: {
  health: 100,
  respawnSeconds: 2,
  weapons: ['sidearm', 'shock', 'pulse', 'minigun', 'flak', 'rockets', 'sniper'],
  startWeapons: ['sidearm', 'shock'],
  selfTeam: 'red',
}
```

Weapon ids resolve against the registry at build time. They also bind `weaponSpawn` parts
and text-map `weaponSpawn` tiles — so a pad named `'rockets'` grants the Rocket Launcher.

## Pickups

Maps place pickups that respawn on timers (bots loot them too):

- `w.weaponSpawn(at, weaponId)` — grants the weapon + ammo; respawns ~14s.
- `w.ammoSpawn(at)` — tops up every weapon you hold; respawns ~10s.
- `w.healthPack(at)` — +35 HP; respawns ~20s.

Everyone you hit shows it: overhead life bars shrink, bodies flash red, damage numbers
float up.

## Bots

`ctx.spawnBot({ name, team?, skill?, spawns, shirt? })` returns an `EntityApi`. Bots run
the **same character physics** as players. `skill` is 0–1. They:

- pick the right gun for the range, lead projectiles, fire in bursts,
- hunt whoever shot them,
- loot weapon/ammo/health pickups when low,
- hop low walls, strafe in fights,
- play CTF (carry → return, recover dropped flags, chase thieves).

## Add your own weapon

```ts
import { registerWeapon } from '../sdk'

registerWeapon({
  id: 'crossbow', name: 'Crossbow', icon: '🏹', kind: 'projectile',
  damage: 55, fireRate: 0.8, ammoMax: 10,
  projectile: { speed: 44, radius: 0.12, color: '#caffb0', life: 3 },
  sound: 'sniper',
})
```

Then reference `'crossbow'` in `combat.weapons`, `startWeapons`, and `weaponSpawn` pads
like any built-in. In GameDocs, custom weapon ids are namespaced by game id
(`<gameId>:<id>`) before registration so community docs don't collide with built-ins.

## Honest scope

Combat is **not** fully server-authoritative. Shots hurt bots locally; remote-human PvP
uses client hit claims with server-side plausibility caps (damage budget, range sanity)
and **server-owned HP verdicts**. Fully authoritative PvP is still on the roadmap.
