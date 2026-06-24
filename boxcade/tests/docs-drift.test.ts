import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOC_PART_KINDS, GAMEDOC_LIMITS } from '../src/sdk/gamedoc'
import { RESERVED_EVENT_PREFIXES, RULE_ACTION_TYPES, RULE_TRIGGER_TYPES } from '../src/sdk/rules'

const gamedoc = readFileSync(new URL('../docs/GAMEDOC.md', import.meta.url), 'utf8')

describe('docs drift checks', () => {
  it('documents every GameDoc part kind', () => {
    for (const kind of DOC_PART_KINDS) {
      expect(gamedoc, `docs/GAMEDOC.md should document DocPart kind '${kind}'`).toContain(`\`${kind}\``)
    }
  })

  it('documents every rule trigger, action, and reserved prefix', () => {
    for (const trigger of RULE_TRIGGER_TYPES) {
      expect(gamedoc, `docs/GAMEDOC.md should document rule trigger '${trigger}'`).toContain(trigger)
    }
    for (const action of RULE_ACTION_TYPES) {
      expect(gamedoc, `docs/GAMEDOC.md should document rule action '${action}'`).toContain(action)
    }
    for (const prefix of RESERVED_EVENT_PREFIXES) {
      expect(gamedoc, `docs/GAMEDOC.md should document reserved prefix '${prefix}'`).toContain(`\`${prefix}\``)
    }
  })

  it('documents every GameDoc format limit', () => {
    for (const key of Object.keys(GAMEDOC_LIMITS)) {
      expect(gamedoc, `docs/GAMEDOC.md should document GAMEDOC_LIMITS.${key}`).toContain(`\`${key}\``)
    }
  })
})
