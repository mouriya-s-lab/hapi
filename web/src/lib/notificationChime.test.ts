import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    installNotificationChimeUnlock,
    playNotificationChime,
    resetNotificationChimeForTests,
} from './notificationChime'

class FakeAudioParam {
    value = 0
    setValueAtTime = vi.fn()
    linearRampToValueAtTime = vi.fn()
    exponentialRampToValueAtTime = vi.fn()
}

class FakeOscillator {
    type = 'sine'
    frequency = { value: 0 }
    connect = vi.fn()
    start = vi.fn()
    stop = vi.fn()
}

class FakeGain {
    gain = new FakeAudioParam()
    connect = vi.fn()
}

class FakeAudioContext {
    static instances: FakeAudioContext[] = []
    state: AudioContextState = 'running'
    currentTime = 0
    destination = {}
    oscillators: FakeOscillator[] = []
    resume = vi.fn(async () => {
        this.state = 'running'
    })

    constructor() {
        FakeAudioContext.instances.push(this)
    }

    createOscillator(): FakeOscillator {
        const oscillator = new FakeOscillator()
        this.oscillators.push(oscillator)
        return oscillator
    }

    createGain(): FakeGain {
        return new FakeGain()
    }
}

// Models a context the autoplay policy keeps locked: resume() settles but the
// state stays suspended (no user gesture has happened yet).
class SuspendedAudioContext extends FakeAudioContext {
    constructor() {
        super()
        this.state = 'suspended'
        this.resume = vi.fn(async () => {})
    }
}

describe('playNotificationChime', () => {
    beforeEach(() => {
        resetNotificationChimeForTests()
        FakeAudioContext.instances = []
        vi.stubGlobal('AudioContext', FakeAudioContext)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('schedules a two-tone chime on a running context', () => {
        expect(playNotificationChime(10_000)).toBe(true)

        expect(FakeAudioContext.instances).toHaveLength(1)
        const context = FakeAudioContext.instances[0]!
        expect(context.oscillators).toHaveLength(2)
        expect(context.oscillators.map((o) => o.frequency.value)).toEqual([880, 1318.51])
        for (const oscillator of context.oscillators) {
            expect(oscillator.start).toHaveBeenCalledTimes(1)
            expect(oscillator.stop).toHaveBeenCalledTimes(1)
        }
    })

    it('rate-limits chimes closer than 2s apart', () => {
        expect(playNotificationChime(10_000)).toBe(true)
        expect(playNotificationChime(11_000)).toBe(false)
        expect(playNotificationChime(12_500)).toBe(true)

        expect(FakeAudioContext.instances[0]!.oscillators).toHaveLength(4)
    })

    it('stays silent while the context is locked, without consuming the rate budget', () => {
        vi.stubGlobal('AudioContext', SuspendedAudioContext)

        expect(playNotificationChime(10_000)).toBe(false)
        const context = FakeAudioContext.instances[0]!
        expect(context.oscillators).toHaveLength(0)
        expect(context.resume).toHaveBeenCalled()

        // A user gesture unlocks the context moments later — the next chime
        // plays even though the blocked attempt was < 2s ago.
        context.state = 'running'
        expect(playNotificationChime(10_100)).toBe(true)
        expect(context.oscillators).toHaveLength(2)
    })

    it('reports false when the platform has no AudioContext', () => {
        vi.stubGlobal('AudioContext', undefined)
        expect(playNotificationChime(10_000)).toBe(false)
    })
})

describe('installNotificationChimeUnlock', () => {
    beforeEach(() => {
        resetNotificationChimeForTests()
        FakeAudioContext.instances = []
        vi.stubGlobal('AudioContext', SuspendedAudioContext)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('creates and resumes the shared context on the first gesture', () => {
        const cleanup = installNotificationChimeUnlock()

        expect(FakeAudioContext.instances).toHaveLength(0)
        window.dispatchEvent(new Event('pointerdown'))

        expect(FakeAudioContext.instances).toHaveLength(1)
        expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalled()

        cleanup()
    })

    it('stops listening after cleanup', () => {
        const cleanup = installNotificationChimeUnlock()
        cleanup()

        window.dispatchEvent(new Event('pointerdown'))
        window.dispatchEvent(new Event('keydown'))

        expect(FakeAudioContext.instances).toHaveLength(0)
    })
})
