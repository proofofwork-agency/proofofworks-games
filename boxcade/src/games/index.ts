// Game registry — every game on the Blobcade portal. Adding a game is:
//   1. create src/games/your-game.ts with defineGame({...})
//   2. import + list it here. Done.

import type { GameDef } from '../sdk'
import skyObby from './sky-obby'
import facingTowers from './facing-towers'
import squadfall from './squadfall'
import voxelIsland from './voxel-island'
import castleRun from './castle-run'
import wolfden from './wolfden'
import starter from './starter'

export const GAMES: GameDef[] = [squadfall, facingTowers, skyObby, voxelIsland, castleRun, wolfden, starter]

export function findGame(id: string): GameDef | undefined {
  return GAMES.find((g) => g.meta.id === id)
}
