/**
 * Static, process-agnostic list of flavors whose ForkProvider implementations
 * live in fork-features/session-fork/providers/. Both hub and cli consume this:
 *
 *  - hub uses it to answer `GET /api/flavors/capabilities` (the UI then shows
 *    or hides the Fork menu item per session flavor).
 *  - cli's register.ts iterates it indirectly: every provider listed here MUST
 *    be wired in register.ts so the cli RPC dispatch can serve fork requests
 *    the hub sends out. register.test.ts pins that invariant.
 *
 * Adding a provider: implement it under providers/, wire it in register.ts,
 * append the flavor name here. Removing one: reverse the steps.
 *
 * Why static (not derived from the live registry): the registry is per-process
 * and populated on cli startup only. Hub never imports the cli-only provider
 * modules (they pull cli `@/*` paths the hub tsconfig excludes), so hub's
 * registry is always empty. A single static const is the unified source of
 * truth that both processes can consult.
 */
export const FORK_CAPABLE_FLAVORS = ['claude', 'codex'] as const

export type ForkCapableFlavor = (typeof FORK_CAPABLE_FLAVORS)[number]
