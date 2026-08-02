import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'

const fetchVoiceBackend = vi.fn()
const fetchQwenToken = vi.fn()

vi.mock('@/api/voice', () => ({ fetchVoiceBackend, fetchQwenToken }))
vi.mock('@hapi/protocol/voicePickerCatalog', () => ({ resolveQwenRealtimeVoice: () => 'Cherry' }))
vi.mock('@/lib/voicePickerPreferences', () => ({ readStoredVoiceSelection: () => null }))
vi.mock('@/lib/voicePersonalitySession', () => ({
    encodeVoiceSystemPromptForProxy: (value: string) => value,
    truncatePromptForProxy: (value: string) => value
}))

class FakeAudioContext {
    state: AudioContextState = 'running'
    currentTime = 0
    destination = {}
    resume = vi.fn(async () => undefined)
    close = vi.fn(async () => { this.state = 'closed' })
    createBuffer = vi.fn(() => ({ copyToChannel: vi.fn(), duration: 1 }))
    createBufferSource = vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null
    }))
}

class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static instances: FakeWebSocket[] = []
    readonly readyState = FakeWebSocket.OPEN
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    sent: string[] = []
    close = vi.fn()
    send = vi.fn((value: string) => { this.sent.push(value) })

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this)
    }

    message(payload: unknown): void {
        this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
    }
}

const api = {
    getAuthToken: () => 'token'
} as ApiClient

const storage = new Map<string, string>()
const fakeLocalStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() }
}

describe('message summary speaker', () => {
    let audioContextDescriptor: PropertyDescriptor | undefined
    let webSocketDescriptor: PropertyDescriptor | undefined
    let windowDescriptor: PropertyDescriptor | undefined
    let localStorageDescriptor: PropertyDescriptor | undefined

    beforeEach(() => {
        vi.clearAllMocks()
        FakeWebSocket.instances = []
        audioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
        webSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
        windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
        localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        Object.defineProperty(globalThis, 'AudioContext', { value: FakeAudioContext, configurable: true })
        Object.defineProperty(globalThis, 'WebSocket', { value: FakeWebSocket, configurable: true })
        Object.defineProperty(globalThis, 'window', {
            value: { location: { protocol: 'https:', host: 'hapi.example' } },
            configurable: true
        })
        Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, configurable: true })
        localStorage.clear()
        fetchVoiceBackend.mockResolvedValue({ backend: 'qwen-realtime', backends: ['qwen-realtime'] })
        fetchQwenToken.mockResolvedValue({ allowed: true, wsUrl: 'ws://hub/api/voice/qwen-ws' })
    })

    afterEach(async () => {
        const speaker = await import('./messageSummarySpeaker')
        speaker.stopSpeaking()
        restoreGlobal('AudioContext', audioContextDescriptor)
        restoreGlobal('WebSocket', webSocketDescriptor)
        restoreGlobal('window', windowDescriptor)
        restoreGlobal('localStorage', localStorageDescriptor)
    })

    it('reports availability only when Qwen Realtime is configured', async () => {
        const { isQwenSpeakerAvailable } = await import('./messageSummarySpeaker')
        expect(await isQwenSpeakerAvailable(api)).toBe(true)
        fetchVoiceBackend.mockResolvedValue({ backend: 'elevenlabs', backends: ['elevenlabs'] })
        expect(await isQwenSpeakerAvailable({ getAuthToken: () => 'other' } as ApiClient)).toBe(false)
    })

    it('starts one summary and sends the reply after setup acknowledgment', async () => {
        const speaker = await import('./messageSummarySpeaker')
        await speaker.speakSummary(api, 'message-1', 'Completed the migration.')
        expect(speaker.getSpeakerPhase('message-1')).toBe('loading')

        const ws = FakeWebSocket.instances[0]
        expect(ws.url).toContain('voice=Cherry')
        ws.message({ type: 'session.updated' })

        expect(speaker.getSpeakerPhase('message-1')).toBe('speaking')
        expect(ws.sent).toHaveLength(2)
        expect(ws.sent[0]).toContain('Completed the migration.')
        expect(ws.sent[1]).toBe('{"type":"response.create"}')
    })

    it('stops immediately and ignores a superseded token response', async () => {
        let resolveToken!: (value: { allowed: true; wsUrl: string }) => void
        fetchQwenToken.mockReturnValue(new Promise((resolve) => { resolveToken = resolve }))
        const speaker = await import('./messageSummarySpeaker')
        const starting = speaker.speakSummary(api, 'message-1', 'text')
        speaker.stopSpeaking()
        resolveToken({ allowed: true, wsUrl: 'ws://hub/api/voice/qwen-ws' })
        await starting

        expect(speaker.getSpeakerPhase('message-1')).toBe('idle')
        expect(FakeWebSocket.instances).toHaveLength(0)
    })

    it('stops an active connection immediately on a second click or session exit', async () => {
        const speaker = await import('./messageSummarySpeaker')
        await speaker.speakSummary(api, 'message-1', 'text')
        const ws = FakeWebSocket.instances[0]
        ws.message({ type: 'session.updated' })

        speaker.stopSpeaking()

        expect(speaker.getSpeakerPhase('message-1')).toBe('idle')
        expect(ws.close).toHaveBeenCalledWith(1000)
    })

    it('exposes a rejected Qwen token as a per-message error', async () => {
        fetchQwenToken.mockResolvedValue({ allowed: false, error: 'Qwen is disabled' })
        const speaker = await import('./messageSummarySpeaker')
        await speaker.speakSummary(api, 'message-1', 'text')

        expect(speaker.getSpeakerPhase('message-1')).toBe('idle')
        expect(speaker.getSpeakerError('message-1')).toBe('Qwen is disabled')
        expect(FakeWebSocket.instances).toHaveLength(0)
    })

    it('surfaces malformed upstream events and closes playback', async () => {
        const speaker = await import('./messageSummarySpeaker')
        await speaker.speakSummary(api, 'message-1', 'text')
        FakeWebSocket.instances[0].message({ delta: 'missing type' })

        expect(speaker.getSpeakerPhase('message-1')).toBe('idle')
        expect(speaker.getSpeakerError('message-1')).toContain('string type')
    })
})

function restoreGlobal(key: string, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
    } else {
        Reflect.deleteProperty(globalThis, key)
    }
}
