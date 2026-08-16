import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { CREATABLE_AGENT_FLAVORS } from '@hapi/protocol/modes'
import {
    probeAgentSkillDeployment,
    registerAgentSkillProbeHandler,
    resolveCanonicalSkillSourcePath,
    resolveManagedSkillTargetPath,
    runAgentSkillDeployment
} from './deploy'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

let testHome: string
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
    savedEnv = {
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        CODEX_HOME: process.env.CODEX_HOME,
        GROK_HOME: process.env.GROK_HOME
    }
    testHome = mkdtempSync(join(tmpdir(), 'hapi-skill-deploy-'))
    process.env.HOME = testHome
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.CODEX_HOME
    delete process.env.GROK_HOME
})

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = value
        }
    }
    rmSync(testHome, { recursive: true, force: true })
})

const canonicalContent = () => readFileSync(resolveCanonicalSkillSourcePath(), 'utf-8')

function writeManagedManifest(targetPath: string, managedHashes: string[]): void {
    writeFileSync(join(dirname(targetPath), '.hapi-managed.json'), JSON.stringify({
        managedHashes,
        cliVersion: '0.0.0',
        deployedAt: 0
    }), 'utf-8')
}

describe('runAgentSkillDeployment', () => {
    test('first run deploys the shared artifact and reports deployed for every creatable harness', () => {
        const report = runAgentSkillDeployment()

        expect(Object.keys(report.harnesses).sort()).toEqual([...CREATABLE_AGENT_FLAVORS].sort())
        for (const result of Object.values(report.harnesses)) {
            expect(result.status).toBe('deployed')
            expect(result.discoveredHash).toBe(report.canonicalHash)
        }

        const deployed = readFileSync(resolveManagedSkillTargetPath(), 'utf-8')
        expect(deployed).toBe(canonicalContent())
        expect(report.canonicalHash).toBe(sha256(deployed))
    })

    test('second run is idempotent and reports current', () => {
        runAgentSkillDeployment()
        const before = readFileSync(resolveManagedSkillTargetPath(), 'utf-8')

        const report = runAgentSkillDeployment()
        for (const result of Object.values(report.harnesses)) {
            expect(result.status).toBe('current')
        }
        expect(readFileSync(resolveManagedSkillTargetPath(), 'utf-8')).toBe(before)
    })

    test('managed older version is atomically updated', () => {
        runAgentSkillDeployment()
        const targetPath = resolveManagedSkillTargetPath()
        const oldContent = 'old managed skill body\n'
        writeFileSync(targetPath, oldContent, 'utf-8')
        writeManagedManifest(targetPath, [sha256(oldContent)])

        const report = runAgentSkillDeployment()
        for (const result of Object.values(report.harnesses)) {
            expect(result.status).toBe('updated')
        }
        expect(readFileSync(targetPath, 'utf-8')).toBe(canonicalContent())
    })

    test('a crash between manifest and file writes still counts the file as managed', () => {
        // Simulates the in-flight state: manifest already lists the new hash
        // while the file still holds the managed old content.
        runAgentSkillDeployment()
        const targetPath = resolveManagedSkillTargetPath()
        const oldContent = 'interrupted managed skill body\n'
        writeFileSync(targetPath, oldContent, 'utf-8')
        writeManagedManifest(targetPath, [sha256(oldContent), sha256('never written new content')])

        const report = runAgentSkillDeployment()
        for (const result of Object.values(report.harnesses)) {
            expect(result.status).toBe('updated')
        }
        expect(readFileSync(targetPath, 'utf-8')).toBe(canonicalContent())
    })

    test('unmanaged same-name file is never overwritten and reports conflict', () => {
        const targetPath = resolveManagedSkillTargetPath()
        mkdirSync(dirname(targetPath), { recursive: true })
        const userContent = 'user-owned skill\n'
        writeFileSync(targetPath, userContent, 'utf-8')

        const report = runAgentSkillDeployment()
        for (const result of Object.values(report.harnesses)) {
            expect(result.status).toBe('conflict')
        }
        expect(readFileSync(targetPath, 'utf-8')).toBe(userContent)
    })

    test('unmanaged copy in a flavor config skills dir conflicts only that harness', () => {
        const claudeCopy = join(testHome, '.claude', 'skills', 'hapi-agent', 'SKILL.md')
        mkdirSync(dirname(claudeCopy), { recursive: true })
        writeFileSync(claudeCopy, 'stale claude-local hapi-agent skill\n', 'utf-8')

        const report = runAgentSkillDeployment()
        expect(report.harnesses.claude?.status).toBe('conflict')
        for (const [flavor, result] of Object.entries(report.harnesses)) {
            if (flavor === 'claude') continue
            expect(result.status).toBe('deployed')
        }
        expect(readFileSync(claudeCopy, 'utf-8')).toBe('stale claude-local hapi-agent skill\n')
    })

    test('honours CLAUDE_CONFIG_DIR for the claude harness probe', () => {
        const customConfigDir = join(testHome, 'custom-claude-config')
        process.env.CLAUDE_CONFIG_DIR = customConfigDir
        const customCopy = join(customConfigDir, 'skills', 'hapi-agent', 'SKILL.md')
        mkdirSync(dirname(customCopy), { recursive: true })
        writeFileSync(customCopy, 'unmanaged custom-config copy\n', 'utf-8')

        const report = runAgentSkillDeployment()
        expect(report.harnesses.claude?.status).toBe('conflict')
        expect(report.harnesses.codex?.status).toBe('deployed')
    })

    test('probe-only reports missing without writing anything', () => {
        const report = probeAgentSkillDeployment()
        for (const result of Object.values(report.harnesses)) {
            expect(result.status).toBe('missing')
        }
        expect(existsSync(resolveManagedSkillTargetPath())).toBe(false)
    })

    test('probe-only distinguishes current, outdated, and conflict', () => {
        runAgentSkillDeployment()
        expect(probeAgentSkillDeployment().harnesses.claude?.status).toBe('current')

        const targetPath = resolveManagedSkillTargetPath()
        const oldContent = 'managed but stale content\n'
        writeFileSync(targetPath, oldContent, 'utf-8')
        writeManagedManifest(targetPath, [sha256(oldContent)])
        const outdated = probeAgentSkillDeployment()
        expect(outdated.harnesses.claude?.status).toBe('outdated')
        expect(readFileSync(targetPath, 'utf-8')).toBe(oldContent)

        writeFileSync(targetPath, 'user replaced content\n', 'utf-8')
        expect(probeAgentSkillDeployment().harnesses.claude?.status).toBe('conflict')
        expect(readFileSync(targetPath, 'utf-8')).toBe('user replaced content\n')
    })

    test('canonical flavor-root copy keeps that harness ready when the shared artifact is stale', () => {
        runAgentSkillDeployment()
        const claudeCopy = join(testHome, '.claude', 'skills', 'hapi-agent', 'SKILL.md')
        mkdirSync(dirname(claudeCopy), { recursive: true })
        writeFileSync(claudeCopy, canonicalContent(), 'utf-8')

        const targetPath = resolveManagedSkillTargetPath()
        const oldContent = 'managed but stale content\n'
        writeFileSync(targetPath, oldContent, 'utf-8')
        writeManagedManifest(targetPath, [sha256(oldContent)])

        const report = probeAgentSkillDeployment()
        expect(report.harnesses.claude?.status).toBe('current')
        expect(report.harnesses.codex?.status).toBe('outdated')
    })
})

describe('registerAgentSkillProbeHandler', () => {
    test('persists the probe report before returning it', async () => {
        runAgentSkillDeployment()
        let handler: ((params: unknown) => unknown | Promise<unknown>) | undefined
        let persistedHash: string | undefined

        registerAgentSkillProbeHandler({
            registerHandler: (_method, registered) => {
                handler = registered
            }
        }, async (update) => {
            const metadata = update({
                host: 'runner',
                platform: process.platform,
                happyCliVersion: '1.0.0'
            })
            persistedHash = metadata.agentSkills?.canonicalHash
        })

        const response = await handler?.({})
        expect(response).toEqual({
            agentSkills: expect.objectContaining({ canonicalHash: persistedHash })
        })
    })

    test('fails the probe RPC when machine metadata cannot be persisted', async () => {
        let handler: ((params: unknown) => unknown | Promise<unknown>) | undefined
        registerAgentSkillProbeHandler({
            registerHandler: (_method, registered) => {
                handler = registered
            }
        }, async () => {
            throw new Error('metadata write failed')
        })

        expect(handler).toBeDefined()
        await expect(handler!({})).rejects.toThrow('metadata write failed')
    })
})
