/**
 * One-shot "read this reply aloud" speaker.
 *
 * Opens a short-lived Qwen Realtime connection through the hub's
 * /api/voice/qwen-ws proxy, overrides the assistant persona with a narrator
 * prompt via the systemPrompt query param, sends the message text once and
 * plays the returned audio. Independent from the interactive voice session
 * (no microphone, no tools expected) — at most one summary plays at a time.
 */

import { GeminiAudioPlayer } from './gemini/audioPlayer'
import { fetchQwenToken, fetchVoiceBackend } from '@/api/voice'
import { resolveQwenRealtimeVoice } from '@hapi/protocol/voicePickerCatalog'
import { readStoredVoiceSelection } from '@/lib/voicePickerPreferences'
import {
    encodeVoiceSystemPromptForProxy,
    truncatePromptForProxy
} from '@/lib/voicePersonalitySession'
import type { ApiClient } from '@/api/client'

export type SpeakerPhase = 'idle' | 'loading' | 'speaking'

// Bounds the realtime-model input cost for very long replies.
const MAX_SPEAK_INPUT_CHARS = 8000
const PLAYBACK_POLL_MS = 250

function buildNarratorPrompt(language: string | null): string {
    const languageRule = language?.toLowerCase().startsWith('zh')
        ? 'Speak in Chinese (中文).'
        : language
            ? `Speak in the language with code "${language}".`
            : "Speak in the reply's main language."
    return [
        'You are the voice narrator of a coding assistant app. The user tapped',
        '"read aloud" on one assistant reply. Immediately speak a moderately',
        'detailed spoken summary of that reply: outcome/conclusion first, then',
        'the key actions taken, important findings or numbers, and anything the',
        'user must decide or watch out for. Do not read code or URLs verbatim —',
        'describe them in a short phrase. No greeting, no meta commentary, no',
        `closing question. ${languageRule}`
    ].join(' ')
}

interface SpeakerState {
    ws: WebSocket | null
    player: GeminiAudioPlayer | null
    playbackContext: AudioContext | null
    phase: SpeakerPhase
    activeKey: string | null
    pollTimer: ReturnType<typeof setInterval> | null
    error: string | null
}

const state: SpeakerState = {
    ws: null,
    player: null,
    playbackContext: null,
    phase: 'idle',
    activeKey: null,
    pollTimer: null,
    error: null
}

const listeners = new Set<() => void>()

function notify(): void {
    for (const listener of listeners) listener()
}

export function subscribeSpeaker(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** Phase of the given message: 'idle' unless it is the one currently active. */
export function getSpeakerPhase(messageKey: string): SpeakerPhase {
    return state.activeKey === messageKey ? state.phase : 'idle'
}

export function getSpeakerError(messageKey: string): string | null {
    return state.activeKey === messageKey ? state.error : null
}

function teardown(): void {
    if (state.pollTimer !== null) {
        clearInterval(state.pollTimer)
        state.pollTimer = null
    }
    if (state.ws) {
        const ws = state.ws
        state.ws = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(1000)
        }
    }
    if (state.player) {
        state.player.dispose()
        state.player = null
    }
    if (state.playbackContext && state.playbackContext.state !== 'closed') {
        void state.playbackContext.close()
    }
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
    finish()
}

// Availability is per hub config — cache the lookup for the app lifetime.
let qwenAvailable: boolean | null = null
let qwenAvailabilityProbe: Promise<boolean> | null = null

export function isQwenSpeakerAvailable(api: ApiClient): Promise<boolean> {
    if (qwenAvailable !== null) return Promise.resolve(qwenAvailable)
    if (!qwenAvailabilityProbe) {
        qwenAvailabilityProbe = fetchVoiceBackend(api)
            .then((resp) => {
                qwenAvailable = resp.backends.includes('qwen-realtime')
                return qwenAvailable
            })
            .catch(() => {
                qwenAvailabilityProbe = null
                return false
            })
    }
    return qwenAvailabilityProbe
}

/**
 * Speak a moderately detailed summary of one assistant reply.
 * Must be called directly from a user gesture (creates the AudioContext).
 */
export async function speakSummary(api: ApiClient, messageKey: string, text: string): Promise<void> {
    stopSpeaking()

    state.activeKey = messageKey
    state.phase = 'loading'
    state.error = null
    notify()

    // Created synchronously inside the gesture — mobile autoplay policy.
    const playbackContext = new AudioContext({ sampleRate: 24000 })
    void playbackContext.resume()
    state.playbackContext = playbackContext
    state.player = new GeminiAudioPlayer(playbackContext)

    const tokenResp = await fetchQwenToken(api)
    if (state.activeKey !== messageKey) return // superseded meanwhile
    if (!tokenResp.allowed) {
        finish(tokenResp.error ?? 'Voice backend unavailable')
        return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const proxyUrl = tokenResp.wsUrl || `${protocol}//${window.location.host}/api/voice/qwen-ws`
    const authToken = api.getAuthToken() || ''
    const language = localStorage.getItem('hapi-voice-lang')
    const voice = resolveQwenRealtimeVoice(readStoredVoiceSelection('qwen-realtime'))
    const narratorPrompt = encodeVoiceSystemPromptForProxy(
        truncatePromptForProxy(buildNarratorPrompt(language))
    )
    const separator = proxyUrl.includes('?') ? '&' : '?'
    const langParam = language ? `&language=${encodeURIComponent(language)}` : ''
    const wsUrl = `${proxyUrl}${separator}token=${encodeURIComponent(authToken)}${langParam}`
        + `&voice=${encodeURIComponent(voice)}&systemPrompt=${encodeURIComponent(narratorPrompt)}`

    const ws = new WebSocket(wsUrl)
    state.ws = ws

    const speakText = text.length > MAX_SPEAK_INPUT_CHARS
        ? `${text.slice(0, MAX_SPEAK_INPUT_CHARS)}\n[reply truncated]`
        : text

    ws.onmessage = (event) => {
        if (state.ws !== ws) return
        let data: { type?: string; delta?: unknown; error?: { message?: string } }
        try {
            data = JSON.parse(event.data as string) as typeof data
        } catch {
            return
        }

        // First session.updated = hub-owned setup acked; client frames flow after it.
        if (data.type === 'session.updated' && state.phase === 'loading') {
            state.phase = 'speaking'
            notify()
            ws.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{
                        type: 'input_text',
                        text: `Read this assistant reply aloud as instructed:\n<reply>\n${speakText}\n</reply>`
                    }]
                }
            }))
            ws.send(JSON.stringify({ type: 'response.create' }))
            return
        }

        if (data.type === 'response.audio.delta' && typeof data.delta === 'string') {
            state.player?.enqueue(data.delta)
            return
        }

        if (data.type === 'response.done') {
            // Audio is fully enqueued locally — close upstream, wait for drain.
            if (state.pollTimer === null) {
                state.pollTimer = setInterval(() => {
                    if (!state.player || !state.player.isPlaying()) finish()
                }, PLAYBACK_POLL_MS)
            }
            ws.onclose = null
            ws.close(1000)
            return
        }

        if (data.type === 'error') {
            finish(data.error?.message || 'Voice narration failed')
        }
    }

    ws.onerror = () => {
        if (state.ws !== ws) return
        finish('WebSocket connection failed')
    }

    ws.onclose = (event) => {
        if (state.ws !== ws) return
        // Drain poller owns shutdown after response.done; anything else is premature.
        if (state.pollTimer === null) {
            finish(state.phase === 'loading' ? (event.reason || 'Connection closed') : undefined)
        }
    }
}
