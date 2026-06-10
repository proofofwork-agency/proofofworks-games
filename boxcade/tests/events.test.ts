import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../src/engine/events'

describe('EventBus on / emit / off', () => {
  it('delivers payloads to subscribers', () => {
    const bus = new EventBus()
    const seen: number[] = []
    bus.on('player:coin', (p) => seen.push(p.total))
    bus.emit('player:coin', { total: 3 })
    bus.emit('player:coin', { total: 7 })
    expect(seen).toEqual([3, 7])
  })

  it('emit to a type with no subscribers is a no-op', () => {
    const bus = new EventBus()
    expect(() => bus.emit('mygame:nothing', { a: 1 })).not.toThrow()
  })

  it('on() returns an unsubscribe function', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    const off = bus.on('mygame:x', fn)
    bus.emit('mygame:x', 1)
    off()
    bus.emit('mygame:x', 1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('off() removes a specific handler', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.on('mygame:x', a)
    bus.on('mygame:x', b)
    bus.off('mygame:x', a)
    bus.emit('mygame:x', 1)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('the same handler added twice still fires once (Set semantics)', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    bus.on('mygame:x', fn)
    bus.on('mygame:x', fn)
    bus.emit('mygame:x', 1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('EventBus once', () => {
  it('fires at most one time', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    bus.once('mygame:x', fn)
    bus.emit('mygame:x', 1)
    bus.emit('mygame:x', 2)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(1)
  })

  it('can be cancelled before it ever fires', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    const off = bus.once('mygame:x', fn)
    off()
    bus.emit('mygame:x', 1)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('EventBus safety', () => {
  it('unsubscribing during emit does not skip other handlers', () => {
    const bus = new EventBus()
    const order: string[] = []
    const offB = bus.on('mygame:x', () => { order.push('b') })
    bus.on('mygame:x', () => { order.push('a'); offB() })
    bus.on('mygame:x', () => { order.push('c') })
    // first emit: snapshot taken before iteration, so all three run in
    // insertion order (b was registered first)
    bus.emit('mygame:x', 1)
    expect(order).toEqual(['b', 'a', 'c'])
    // second emit: b is now gone
    order.length = 0
    bus.emit('mygame:x', 1)
    expect(order).toEqual(['a', 'c'])
  })

  it('subscribing during emit does not fire the new handler this round', () => {
    const bus = new EventBus()
    const late = vi.fn()
    bus.on('mygame:x', () => { bus.on('mygame:x', late) })
    bus.emit('mygame:x', 1)
    expect(late).not.toHaveBeenCalled()
    bus.emit('mygame:x', 1)
    expect(late).toHaveBeenCalled()
  })

  it('a throwing handler does not break the others (try/catch)', () => {
    const bus = new EventBus()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    bus.on('mygame:x', () => { throw new Error('boom') })
    bus.on('mygame:x', after)
    expect(() => bus.emit('mygame:x', 1)).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('EventBus clear', () => {
  it('drops every subscription', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    bus.on('mygame:a', fn)
    bus.on('mygame:b', fn)
    bus.clear()
    bus.emit('mygame:a', 1)
    bus.emit('mygame:b', 1)
    expect(fn).not.toHaveBeenCalled()
  })
})
