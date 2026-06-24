import { slugifyName, type GameDoc } from './gamedoc'

export function gameDocToTypeScript(doc: GameDoc): string {
  const name = slugifyName(doc.meta.name || 'studio-game')
  const json = JSON.stringify(doc, null, 2)
  return `// Generated from Blobcade Studio. This is a trusted developer starter:
// edit it locally, review it like code, and bundle it as a curated/native game.

import { buildGameFromDoc, type GameDoc } from '../sdk'

const doc = ${json} satisfies GameDoc

const game = buildGameFromDoc(doc, { allowScripts: true })
game.meta.id = '${name}'

export default game
`
}
