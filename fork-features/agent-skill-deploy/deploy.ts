/**
 * Fork feature (#271): deploy the canonical `hapi-agent` skill from the
 * running HAPI binary into the runner user environment, then probe each
 * creatable harness through its own discovery chain.
 *
 * Deployment writes exactly one managed artifact to the shared user-level
 * skills root (`$HOME/.agents/skills/hapi-agent/SKILL.md`), which every
 * harness flavor discovers (see cli/src/modules/common/skills.ts). Harness
 * flavors with an additional flavor-specific skills root are probed for
 * unmanaged same-name copies that could shadow the shared artifact inside
 * that harness; such copies are reported as `conflict` and never touched.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CREATABLE_AGENT_FLAVORS } from '@hapi/protocol/modes'
import type { AgentSkillHarnessResult, MachineAgentSkills } from '@hapi/protocol/schemas'
import { isBunCompiled, projectPath, runtimePath } from '../../cli/src/projectPath'
import { getHomeDirectory, getUserSkillsRoots } from '../../cli/src/modules/common/skills'
import packageJson from '../../cli/package.json'

export const HAPI_AGENT_SKILL_NAME = 'hapi-agent'
const SKILL_FILE_NAME = 'SKILL.md'
const MANIFEST_FILE_NAME = '.hapi-managed.json'

/**
 * Where this build's canonical skill content lives on disk. Compiled
 * binaries stage it into the runtime dir via embedded assets
 * (cli/src/runtime/embeddedAssets.bun.ts); dev builds read the repo file.
 */
export function resolveCanonicalSkillSourcePath(): string {
    if (isBunCompiled()) {
        return join(runtimePath(), 'skills', HAPI_AGENT_SKILL_NAME, SKILL_FILE_NAME)
    }
    return join(projectPath(), '..', '.agents', 'skills', HAPI_AGENT_SKILL_NAME, SKILL_FILE_NAME)
}

export function resolveManagedSkillTargetPath(): string {
    return join(getHomeDirectory(), '.agents', 'skills', HAPI_AGENT_SKILL_NAME, SKILL_FILE_NAME)
}

function sha256Hex(content: Buffer | string): string {
    return createHash('sha256').update(content).digest('hex')
}

/**
 * Proof of HAPI ownership for the deployed artifact. `managedHashes` keeps
 * both the old and the new content hash while an update is in flight, so a
 * crash between the two writes never strands a managed file as unmanaged.
 */
type ManagedManifest = {
    managedHashes: string[]
    cliVersion: string
    deployedAt: number
}

function manifestPathFor(targetPath: string): string {
    return join(dirname(targetPath), MANIFEST_FILE_NAME)
}

function readManifest(targetPath: string): ManagedManifest | null {
    try {
        const parsed = JSON.parse(readFileSync(manifestPathFor(targetPath), 'utf-8')) as Partial<ManagedManifest>
        if (!Array.isArray(parsed.managedHashes) || !parsed.managedHashes.every((hash) => typeof hash === 'string')) {
            return null
        }
        return {
            managedHashes: parsed.managedHashes,
            cliVersion: typeof parsed.cliVersion === 'string' ? parsed.cliVersion : '',
            deployedAt: typeof parsed.deployedAt === 'number' ? parsed.deployedAt : 0
        }
    } catch {
        return null
    }
}

function writeFileAtomic(targetPath: string, content: string): void {
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tempPath, content, 'utf-8')
    try {
        renameSync(tempPath, targetPath)
    } catch (error) {
        rmSync(tempPath, { force: true })
        throw error
    }
}

function writeManifest(targetPath: string, manifest: ManagedManifest): void {
    writeFileAtomic(manifestPathFor(targetPath), JSON.stringify(manifest, null, 2))
}

type SharedDeployOutcome =
    | { status: 'deployed' | 'current' | 'updated' }
    | { status: 'conflict' | 'failed'; error: string }

function deploySharedArtifact(canonicalContent: string, canonicalHash: string): SharedDeployOutcome {
    const targetPath = resolveManagedSkillTargetPath()
    try {
        if (!existsSync(targetPath)) {
            mkdirSync(dirname(targetPath), { recursive: true })
            writeManifest(targetPath, {
                managedHashes: [canonicalHash],
                cliVersion: packageJson.version,
                deployedAt: Date.now()
            })
            writeFileAtomic(targetPath, canonicalContent)
            return { status: 'deployed' }
        }

        const existingHash = sha256Hex(readFileSync(targetPath))
        const manifest = readManifest(targetPath)
        if (!manifest || !manifest.managedHashes.includes(existingHash)) {
            return {
                status: 'conflict',
                error: 'an unmanaged hapi-agent skill already exists in the shared user skills root'
            }
        }

        if (existingHash === canonicalHash) {
            return { status: 'current' }
        }

        // Keep the previous hash managed until the new content is fully in
        // place, then drop it so stale copies stop counting as managed.
        writeManifest(targetPath, {
            managedHashes: [existingHash, canonicalHash],
            cliVersion: packageJson.version,
            deployedAt: Date.now()
        })
        writeFileAtomic(targetPath, canonicalContent)
        writeManifest(targetPath, {
            managedHashes: [canonicalHash],
            cliVersion: packageJson.version,
            deployedAt: Date.now()
        })
        return { status: 'updated' }
    } catch (error) {
        return {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

/**
 * Probe one harness through its own user-level discovery roots. The first
 * root returned by getUserSkillsRoots is always the shared root the managed
 * artifact lives in; any additional flavor-specific root can shadow it
 * inside that harness, so an unmanaged same-name copy there is a conflict.
 */
function probeHarness(flavor: string, shared: SharedDeployOutcome, canonicalHash: string): AgentSkillHarnessResult {
    try {
        const [, ...flavorRoots] = getUserSkillsRoots(flavor)
        for (const root of flavorRoots) {
            const candidatePath = join(root, HAPI_AGENT_SKILL_NAME, SKILL_FILE_NAME)
            if (!existsSync(candidatePath)) {
                continue
            }
            const candidateHash = sha256Hex(readFileSync(candidatePath))
            if (candidateHash !== canonicalHash) {
                return {
                    status: 'conflict',
                    discoveredHash: candidateHash,
                    error: `an unmanaged hapi-agent skill in the ${flavor} config skills directory shadows the canonical skill`
                }
            }
        }

        if (shared.status === 'conflict' || shared.status === 'failed') {
            return { status: shared.status, error: shared.error }
        }
        return { status: shared.status, discoveredHash: canonicalHash }
    } catch (error) {
        return {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

/**
 * Deploy the canonical skill and report per-harness results. Never throws:
 * a broken canonical source degrades to `failed` for every harness so the
 * runner can still start and report the failure to the hub.
 */
export function runAgentSkillDeployment(): MachineAgentSkills {
    let canonicalContent: string
    try {
        canonicalContent = readFileSync(resolveCanonicalSkillSourcePath(), 'utf-8')
    } catch (error) {
        const message = `canonical skill source unavailable: ${error instanceof Error ? error.message : String(error)}`
        return {
            canonicalHash: '',
            cliVersion: packageJson.version,
            checkedAt: Date.now(),
            harnesses: Object.fromEntries(CREATABLE_AGENT_FLAVORS.map((flavor) => [
                flavor,
                { status: 'failed', error: message } satisfies AgentSkillHarnessResult
            ]))
        }
    }

    const canonicalHash = sha256Hex(canonicalContent)
    const shared = deploySharedArtifact(canonicalContent, canonicalHash)
    return {
        canonicalHash,
        cliVersion: packageJson.version,
        checkedAt: Date.now(),
        harnesses: Object.fromEntries(CREATABLE_AGENT_FLAVORS.map((flavor) => [
            flavor,
            probeHarness(flavor, shared, canonicalHash)
        ]))
    }
}
