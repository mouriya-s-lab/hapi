import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { CREATABLE_AGENT_FLAVORS } from '@hapi/protocol/modes'
import {
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
        writeFileSync(join(dirname(targetPath), '.hapi-managed.json'), JSON.stringify({
            managedHashes: [sha256(oldContent)],
            cliVersion: '0.0.0',
            deployedAt: 0
        }), 'utf-8')

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
        writeFileSync(join(dirname(targetPath), '.hapi-managed.json'), JSON.stringify({
            managedHashes: [sha256(oldContent), sha256('never written new content')],
            cliVersion: '0.0.0',
            deployedAt: 0
        }), 'utf-8')

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

    test('flavor-root copy that matches canonical content is not a conflict', () => {
        runAgentSkillDeployment()
        const claudeCopy = join(testHome, '.claude', 'skills', 'hapi-agent', 'SKILL.md')
        mkdirSync(dirname(claudeCopy), { recursive: true })
        writeFileSync(claudeCopy, canonicalContent(), 'utf-8')

        const report = runAgentSkillDeployment()
        expect(report.harnesses.claude?.status).toBe('current')
    })
})
