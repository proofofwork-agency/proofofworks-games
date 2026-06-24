// Game registry — every game on the Blobcade portal. Adding a game is:
//   1. create src/games/your-game.ts with defineGame({...})
//   2. import + list it here. Done.

import type { GameDef } from '../sdk'
import skyObby from './sky-obby'
import facingTowers from './facing-towers'
import squadfall from './squadfall'
import phobosReactorRun from './phobos-reactor-run'
import dustyard from './dustyard'
import riftYard from './rift-yard'
import voxelIsland from './voxel-island'
import castleRun from './castle-run'
import goldRunner from './gold-runner'
import wolfden from './wolfden'
import cinemaCarnage from './cinema-carnage'
import chompMaze from './chomp-maze'
import disasterIsland from './disaster-island'
import blobKart from './blob-kart'
import starter from './starter'
import battleChess from './battle-chess'

export const GAMES: GameDef[] = [dustyard, squadfall, phobosReactorRun, facingTowers, riftYard, skyObby, voxelIsland, castleRun, goldRunner, wolfden, cinemaCarnage, chompMaze, disasterIsland, blobKart, battleChess, starter]

export function findGame(id: string): GameDef | undefined {
  return GAMES.find((g) => g.meta.id === id)
}
