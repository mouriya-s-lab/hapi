/**
 * Test-owned process/session registry for the runner integration suite.
 *
 * The production runner intentionally starts sessions with `detached: true`
 * so they survive runner restarts — that means stopping the runner (or a
 * failing test) never reaps its session children by itself. This registry is
 * the suite's ownership record: every runner, runner-spawned session, and
 * terminal-style process created by a test must be registered **immediately
 * after spawn** (not after happy-path assertions), so cleanup runs even when
 * the test body fails, times out, or is interrupted.
 *
 * Cleanup is two-stage:
 *  1. Logical shutdown — `stopRunnerSession` per tracked session id, which
 *     asks the runner to terminate the session's process tree.
 *  2. Bounded fallback — any tracked process (or session pid still reported
 *     by the runner) that is still alive is force tree-killed.
 *
 * The runner itself is NOT killed here — the suite stops it gracefully via
 * `stopRunner()` (which also removes its state file). The final safety net
 * lives in `auditTestProcesses.ts`: the suite hooks sweep every process
 * carrying the run's unique marker after each test, and the globalSetup
 * teardown audit reaps anything that still escaped (e.g. an agent tree that
 * reparented to PID 1 before the registry tree-kill ran).
 */

import type { ChildProcess } from 'node:child_process'
import { isProcessAlive } from '../utils/process'
import { listRunnerSessions, stopRunnerSession } from '../runner/controlClient'

export interface RegisteredProcess {
    /** Human-readable label for diagnostics, e.g. `runner-launcher`, `terminal-session`. */
    label: string
    kind: 'child' | 'runner' | 'session'
    pid?: number
    sessionId?: string
}

const registered: RegisteredProcess[] = []

/** Registers a ChildProcess immediately after spawn; auto-removes on exit. */
export function trackChildProcess(child: ChildProcess, label: string): ChildProcess {
    if (!child.pid) return child
    const entry: RegisteredProcess = { label, kind: 'child', pid: child.pid }
    registered.push(entry)
    child.once('exit', () => {
        const index = registered.indexOf(entry)
        if (index >= 0) registered.splice(index, 1)
    })
    return child
}

/** Registers a runner PID (from runner.state.json) for tree-cleanup. */
export function trackRunnerPid(pid: number, label: string): void {
    if (Number.isFinite(pid) && pid > 0) {
        registered.push({ label, kind: 'runner', pid })
    }
}

/**
 * Registers a runner-spawned session by its HAPI session id, immediately when
 * the spawn response arrives (the child PID is only known to the runner).
 */
export function trackSession(sessionId: string, label: string): void {
    if (sessionId) {
        registered.push({ label, kind: 'session', sessionId })
    }
}

export function trackedEntries(): readonly RegisteredProcess[] {
    return registered
}

function waitForAllDead(pids: number[], timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve) => {
        const poll = () => {
            const alive = pids.filter((pid) => isProcessAlive(pid))
            if (alive.length === 0 || Date.now() >= deadline) {
                resolve()
                return
            }
            setTimeout(poll, 100)
        }
        poll()
    })
}

/**
 * Two-stage cleanup of every registered resource. Safe to call repeatedly
 * (afterEach + afterAll) — already-dead entries are skipped and pruned.
 */
export async function cleanupAllRegisteredProcesses(): Promise<void> {
    // The runner control API carries a long HTTP timeout (setup.ts raises
    // HAPI_RUNNER_HTTP_TIMEOUT for the stress test), so the whole logical
    // phase is bounded: a hung-but-live runner must not exhaust the hook
    // budget before the process-tree fallback and marker sweep run.
    const LOGICAL_PHASE_BUDGET_MS = 15_000

    // Stage 1: logical shutdown through the runner control API (all sessions
    // in parallel) + resolve any surviving session PIDs from the runner's
    // own tracking for the fallback below.
    const sessionEntries = registered.filter((entry) => entry.kind === 'session' && entry.sessionId)
    const pidsToKill = new Set<number>()
    await Promise.race([
        (async () => {
            await Promise.allSettled(
                sessionEntries.map((entry) => stopRunnerSession(entry.sessionId!))
            )

            const trackedSessionIds = new Set(sessionEntries.map((entry) => entry.sessionId))
            try {
                const sessions = await listRunnerSessions()
                for (const session of sessions) {
                    if (
                        session?.happySessionId &&
                        trackedSessionIds.has(session.happySessionId) &&
                        typeof session.pid === 'number' &&
                        isProcessAlive(session.pid)
                    ) {
                        pidsToKill.add(session.pid)
                    }
                }
            } catch {
                // Runner unreachable — orphaned sessions are caught by the
                // final audit.
            }
        })(),
        new Promise((resolve) => setTimeout(resolve, LOGICAL_PHASE_BUDGET_MS)),
    ])

    // Stage 2: bounded termination for anything still alive. The runner
    // itself is deliberately NOT killed here: it is always stopped
    // via `stopRunner()` (graceful HTTP stop, which also removes its state
    // file). SIGKILLing the runner would leave a stale runner.state.json that
    // the next test's beforeEach can mistake for a live runner.
    for (const entry of registered) {
        if (entry.kind === 'session' || entry.kind === 'runner') continue
        if (entry.pid && isProcessAlive(entry.pid)) {
            pidsToKill.add(entry.pid)
        }
    }
    // Kill registered roots with a bare synchronous SIGKILL: no recursive
    // pgrep tree walk (unbounded under a large tree, and it would run before
    // any await could race it) and no per-PID waits. Descendants are reaped
    // by the unconditional marker sweep the suite runs right after this
    // cleanup — every descendant inherits the run marker.
    for (const pid of pidsToKill) {
        try {
            process.kill(pid, 'SIGKILL')
        } catch {
            // Already dead or racing exit; the wait below re-checks.
        }
    }

    await waitForAllDead([...pidsToKill], 5_000)

    // Prune dead entries so the registry does not grow across tests.
    for (let i = registered.length - 1; i >= 0; i--) {
        const entry = registered[i]
        const pid = entry.pid
        if (!pid || !isProcessAlive(pid)) {
            registered.splice(i, 1)
        }
    }
}
