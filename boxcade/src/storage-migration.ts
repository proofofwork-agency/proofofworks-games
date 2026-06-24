function storageKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && !keys.includes(key)) keys.push(key)
  }
  for (const key of Object.keys(storage)) {
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

function migrateLocalStorageKey(storage: Storage, from: string, to: string) {
  if (from === to) return
  const value = storage.getItem(from)
  if (value === null) return
  const existing = storage.getItem(to)
  if (existing === null) {
    storage.setItem(to, value)
    storage.removeItem(from)
  } else if (existing === value) {
    storage.removeItem(from)
  }
}

/** Carry client data through historical localStorage prefixes without overwriting newer values. */
export function migrateBlobcadeLocalStorage(storage: Storage = localStorage) {
  for (const key of storageKeys(storage)) {
    if (key.startsWith('freeblox.')) {
      migrateLocalStorageKey(storage, key, key.replace('freeblox.', 'blobcade.').replace('.blux', '.blobcash'))
    } else if (key.startsWith('boxcade.')) {
      migrateLocalStorageKey(storage, key, key.replace('boxcade.', 'blobcade.').replace('.bolts', '.blobcash'))
    }
  }
}
