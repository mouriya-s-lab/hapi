// Audible cue for server notification toasts (agent finished a turn and waits
// for input, permission request, background task done). Browsers refuse to
// start audio before the page has seen a user gesture, so the first pointer or
// key interaction pre-creates and resumes one shared AudioContext; toast-time
// playback then only needs an already-running context.

const MIN_CHIME_INTERVAL_MS = 2000
const CHIME_PEAK_GAIN = 0.08

type AudioContextCtor = new () => AudioContext

let sharedContext: AudioContext | null = null
let lastChimeAt = 0

function getAudioContextCtor(): AudioContextCtor | null {
    if (typeof window === 'undefined') {
        return null
    }
    const ctor = window.AudioContext
        ?? (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
    return ctor ?? null
}

function getOrCreateContext(): AudioContext | null {
    if (sharedContext) {
        return sharedContext
    }
    const Ctor = getAudioContextCtor()
    if (!Ctor) {
        return null
    }
    try {
        sharedContext = new Ctor()
    } catch {
        return null
    }
    return sharedContext
}

function tryResume(context: AudioContext): void {
    if (context.state !== 'suspended') {
        return
    }
    try {
        void Promise.resolve(context.resume()).catch(() => {})
    } catch {
        // Ignore — stays suspended until the next gesture.
    }
}

function scheduleTone(context: AudioContext, frequency: number, startAt: number, durationS: number): void {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(CHIME_PEAK_GAIN, startAt + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + durationS + 0.02)
}

/**
 * Play the notification chime (A5 → E6, ~400ms). Returns true when tones were
 * actually scheduled; false when rate-limited, unsupported, or the context is
 * still locked by the autoplay policy.
 */
export function playNotificationChime(now: number = Date.now()): boolean {
    if (now - lastChimeAt < MIN_CHIME_INTERVAL_MS) {
        return false
    }
    const context = getOrCreateContext()
    if (!context) {
        return false
    }
    tryResume(context)
    if (context.state !== 'running') {
        return false
    }
    lastChimeAt = now
    const startAt = context.currentTime + 0.01
    scheduleTone(context, 880, startAt, 0.28)
    scheduleTone(context, 1318.51, startAt + 0.09, 0.34)
    return true
}

/**
 * Keep the shared AudioContext unlocked: create it on the first gesture and
 * re-resume it whenever the platform suspends it again (e.g. iOS after an
 * audio interruption). Returns a cleanup that removes the listeners.
 */
export function installNotificationChimeUnlock(): () => void {
    if (typeof window === 'undefined') {
        return () => {}
    }
    const unlock = () => {
        const context = getOrCreateContext()
        if (context) {
            tryResume(context)
        }
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
        window.removeEventListener('pointerdown', unlock, true)
        window.removeEventListener('keydown', unlock, true)
    }
}

export function resetNotificationChimeForTests(): void {
    sharedContext = null
    lastChimeAt = 0
}
