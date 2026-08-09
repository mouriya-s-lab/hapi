/**
 * Per-flavor session-fork capability, expressed as a two-dimensional
 * discriminated shape:
 *
 *   fork:
 *     'none'       — flavor has no fork primitive; UI hides all fork entries.
 *     'head-only'  — provider forks from HEAD only. UI shows the
 *                    session-level "Fork session" menu but no message-level
 *                    rewind button; hub rejects requests carrying forkPoint.
 *                    (Currently no shipped provider hits this branch — kept
 *                    as a shape for future providers whose native surface is
 *                    HEAD-only.)
 *     'at-message' — provider can fork at an arbitrary user message. UI
 *                    shows both session-level menu and the trailing-row
 *                    rewind button on user messages. Two provider-native
 *                    forms are supported: boundary-based (Codex app-server
 *                    `thread/fork { lastTurnId }` — provider resolves the
 *                    hub's `tailOffset` against `thread/read`) and
 *                    id-based (Claude CLI hidden `--fork-session --resume
 *                    <sid> --resume-session-at <assistantUuid>` — hub emits
 *                    `providerMessageId`).
 *
 *   files:
 *     'none' — no filesystem checkpoint / rewind support wired in this
 *              umbrella. Reserved so the shape can grow without breaking the
 *              consumer contract.
 *
 * Both hub and cli consume this static table:
 *
 *   - hub's `GET /api/flavors/capabilities` returns the full map so web can
 *     capability-gate menu items + the user-message rewind button.
 *   - hub's forkController rejects (400) when the source session's flavor
 *     reports `fork === 'none'`, and (per #57 c4) when forkPoint is passed
 *     against `fork !== 'at-message'`.
 *   - cli's register.ts iterates flavors where `fork !== 'none'` to install
 *     the corresponding ForkProvider; register.test.ts pins that invariant.
 *
 * Why static (not derived from the live provider registry): the registry is
 * per-process and populated on cli startup only. Hub never imports the
 * cli-only provider modules (they pull cli `@/*` paths the hub tsconfig
 * excludes), so hub's registry is always empty. A single static table is the
 * unified source of truth that both processes can consult.
 */
export type FlavorForkCapability = {
    fork: 'none' | 'head-only' | 'at-message'
    files: 'none'
}

const NONE_CAPABILITY: FlavorForkCapability = { fork: 'none', files: 'none' }

const FLAVOR_FORK_CAPABILITIES = {
    claude: { fork: 'at-message', files: 'none' },
    codex: { fork: 'at-message', files: 'none' },
    cursor: { fork: 'none', files: 'none' },
    gemini: { fork: 'none', files: 'none' },
    kimi: { fork: 'none', files: 'none' },
    opencode: { fork: 'none', files: 'none' },
    pi: { fork: 'none', files: 'none' },
    omp: { fork: 'at-message', files: 'none' }
} as const satisfies Record<string, FlavorForkCapability>

export function getForkCapability(flavor: string): FlavorForkCapability {
    return (FLAVOR_FORK_CAPABILITIES as Record<string, FlavorForkCapability>)[flavor] ?? NONE_CAPABILITY
}

export function isForkCapableFlavor(flavor: string): boolean {
    return getForkCapability(flavor).fork !== 'none'
}

export function getAllForkCapabilities(): Record<string, FlavorForkCapability> {
    return { ...FLAVOR_FORK_CAPABILITIES }
}
