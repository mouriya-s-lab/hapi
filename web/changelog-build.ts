import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fieldSeparator = '\x1f'
const recordSeparator = '\x1e'

export interface BuildChangelogEntry {
    hash: string
    date: string
    subject: string
}

export function readHeadCommit(cwd: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
    }).trim()
}

export function readChangelogEntries(cwd: string): BuildChangelogEntry[] {
    const raw = execFileSync(
        'git',
        ['log', `--pretty=format:%H%x1f%ad%x1f%s%x1e`, '--date=format:%Y-%m-%d'],
        { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
    )

    return raw
        .split(recordSeparator)
        .map((record) => record.trim())
        .filter((record) => record.length > 0)
        .map((record) => {
            const [hash, date, subject] = record.split(fieldSeparator)
            if (!hash || !date || !subject) {
                throw new Error('git log produced an invalid changelog record')
            }
            return { hash, date, subject }
        })
}

export function writeChangelog(cwd: string, version: string, outDir: string): void {
    const payload = {
        version,
        commit: readHeadCommit(cwd),
        builtAt: new Date().toISOString(),
        entries: readChangelogEntries(cwd),
    }

    mkdirSync(outDir, { recursive: true })
    writeFileSync(resolve(outDir, 'changelog.json'), JSON.stringify(payload))
}
