import { GeminiAudioPlayer } from './gemini/audioPlayer'
import { fetchQwenToken, fetchVoiceBackend } from '@/api/voice'
import { resolveQwenRealtimeVoice } from '@hapi/protocol/voicePickerCatalog'
import { readStoredVoiceSelection } from '@/lib/voicePickerPreferences'
import { encodeVoiceSystemPromptForProxy, truncatePromptForProxy } from '@/lib/voicePersonalitySession'
import type { ApiClient } from '@/api/client'

export type SpeakerPhase = 'idle' | 'loading' | 'speaking'

type QwenEvent =
    | { type: 'session.updated' }
    | { type: 'response.audio.delta'; delta: string }
    | { type: 'response.done' }
    | { type: 'error'; error: { message?: string } }
    | { type: 'ignored' }

interface SpeakerState {
    ws: WebSocket | null
    player: GeminiAudioPlayer | null
    playbackContext: AudioContext | null
    phase: SpeakerPhase
    activeKey: string | null
    operation: number
    drainTimer: ReturnType<typeof setInterval> | null
    error: string | null
}

const state: SpeakerState = {
    ws: null,
    player: null,
    playbackContext: null,
    phase: 'idle',
    activeKey: null,
    operation: 0,
    drainTimer: null,
    error: null
}
const listeners = new Set<() => void>()

function narratorPrompt(language: string | null): string {
    const languageRule = language?.toLowerCase().startsWith('zh')
        ? 'Speak in Chinese (中文).'
        : language ? `Speak in the language with code "${language}".` : "Speak in the reply's main language."
    return [
        'You are the voice narrator of a coding assistant app. Immediately speak a moderately detailed summary',
        'of the supplied assistant reply: outcome first, then key actions, findings or numbers, and decisions or risks.',
        'Do not read code or URLs verbatim. No greeting, meta commentary, or closing question.',
        languageRule
    ].join(' ')
}

function parseQwenEvent(value: unknown): QwenEvent {
    if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') {
        throw new Error('Qwen event must contain a string type')
    }
    switch (value.type) {
        case 'session.updated':
        case 'response.done':
            return { type: value.type }
        case 'response.audio.delta':
            if (!('delta' in value) || typeof value.delta !== 'string') {
                throw new Error('Qwen audio delta must contain string audio')
            }
            return { type: value.type, delta: value.delta }
        case 'error': {
            if (!('error' in value) || typeof value.error !== 'object' || value.error === null) {
                throw new Error('Qwen error event has an invalid payload')
            }
            const message = 'message' in value.error && typeof value.error.message === 'string'
                ? value.error.message
                : undefined
            return { type: value.type, error: { message } }
        }
        default:
            return { type: 'ignored' }
    }
}

function notify(): void {
    for (const listener of listeners) listener()
}

export function subscribeSpeaker(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function getSpeakerPhase(messageKey: string): SpeakerPhase {
    return state.activeKey === messageKey ? state.phase : 'idle'
}

export function getSpeakerError(messageKey: string): string | null {
    return state.activeKey === messageKey ? state.error : null
}

function teardown(): void {
    if (state.drainTimer !== null) {
        clearInterval(state.drainTimer)
        state.drainTimer = null
    }
    const ws = state.ws
    state.ws = null
    if (ws) {
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000)
    }
    state.player?.dispose()
    state.player = null
    if (state.playbackContext?.state !== 'closed') void state.playbackContext?.close()
    state.playbackContext = null
}

function finish(error?: string): void {
    teardown()
    state.phase = 'idle'
    state.error = error ?? null
    if (!error) state.activeKey = null
    notify()
}

export function stopSpeaking(): void {
    state.operation += 1
    finish()
}

const availabilityByApi = new WeakMap<ApiClient, Promise<boolean>>()

export function isQwenSpeakerAvailable(api: ApiClient): Promise<boolean> {
    const cached = availabilityByApi.get(api)
    if (cached) return cached
    const probe = fetchVoiceBackend(api).then((response) => response.backends.includes('qwen-realtime'))
    availabilityByApi.set(api, probe)
    probe.catch(() => availabilityByApi.delete(api))
    return probe
}

export async function speakSummary(api: ApiClient, messageKey: string, text: string): Promise<void> {
    stopSpeaking()
    const operation = state.operation
    state.activeKey = messageKey
    state.phase = 'loading'
    state.error = null
    notify()

    try {
        const playbackContext = new AudioContext({ sampleRate: 24000 })
        void playbackContext.resume()
        state.playbackContext = playbackContext
        state.player = new GeminiAudioPlayer(playbackContext)

        const token = await fetchQwenToken(api)
        if (state.operation !== operation) return
        if (!token.allowed) {
            finish(token.error ?? 'Voice backend unavailable')
            return
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const proxyUrl = token.wsUrl || `${protocol}//${window.location.host}/api/voice/qwen-ws`
        const language = localStorage.getItem('hapi-voice-lang')
        const voice = resolveQwenRealtimeVoice(readStoredVoiceSelection('qwen-realtime'))
        const systemPrompt = encodeVoiceSystemPromptForProxy(truncatePromptForProxy(narratorPrompt(language)))
        const query = new URLSearchParams({
            token: api.getAuthToken() || '',
            voice,
            systemPrompt,
            ...(language ? { language } : {})
        })
        const ws = new WebSocket(`${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}${query}`)
        state.ws = ws

        ws.onmessage = (event) => {
            if (state.ws !== ws) return
            try {
                const parsed: unknown = JSON.parse(String(event.data))
                const data = parseQwenEvent(parsed)
                if (data.type === 'session.updated' && state.phase === 'loading') {
                    state.phase = 'speaking'
                    notify()
                    ws.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: {
                            type: 'message',
                            role: 'user',
                            content: [{ type: 'input_text', text: `Summarize and read this reply aloud:\n<reply>\n${text}\n</reply>` }]
                        }
                    }))
                    ws.send(JSON.stringify({ type: 'response.create' }))
                } else if (data.type === 'response.audio.delta') {
                    state.player?.enqueue(data.delta)
                } else if (data.type === 'response.done') {
                    ws.onclose = null
                    ws.close(1000)
                    state.ws = null
                    state.drainTimer = setInterval(() => {
                        if (!state.player?.isPlaying()) finish()
                    }, 50)
                } else if (data.type === 'error') {
                    finish(data.error.message ?? 'Voice narration failed')
                }
            } catch (error) {
                finish(error instanceof Error ? error.message : 'Invalid Qwen event')
            }
        }
        ws.onerror = () => { if (state.ws === ws) finish('WebSocket connection failed') }
        ws.onclose = (event) => {
            if (state.ws === ws) finish(event.reason || 'Connection closed before narration completed')
        }
    } catch (error) {
        if (state.operation === operation) finish(error instanceof Error ? error.message : 'Voice narration failed')
    }
}
