import { z } from 'zod'

/**
 * Fork feature (issues #261/#271): per-harness deployment state of the
 * canonical `hapi-agent` skill, reported by the runner in machine metadata.
 *
 * The runner deploys a single managed artifact to the shared user-level
 * skills root (`$HOME/.agents/skills/hapi-agent/SKILL.md`) and then probes
 * each creatable harness through its own discovery chain. Statuses:
 *
 * - `deployed`: managed artifact created for the first time
 * - `current`:  managed artifact already matches the canonical content
 * - `updated`:  managed artifact atomically replaced with newer canonical content
 * - `conflict`: an unmanaged same-name skill blocks this harness; nothing overwritten
 * - `failed`:   deployment or probe errored for this harness
 */
export const AGENT_SKILL_DEPLOY_STATUSES = ['deployed', 'current', 'updated', 'conflict', 'failed'] as const

export const AgentSkillDeployStatusSchema = z.enum(AGENT_SKILL_DEPLOY_STATUSES)

export type AgentSkillDeployStatus = z.infer<typeof AgentSkillDeployStatusSchema>

export const AgentSkillHarnessResultSchema = z.object({
    status: AgentSkillDeployStatusSchema,
    /** SHA-256 (hex) of the skill file this harness actually discovers, when one exists. */
    discoveredHash: z.string().optional(),
    /** Non-sensitive error/conflict description for `conflict`/`failed`. */
    error: z.string().optional()
})

export type AgentSkillHarnessResult = z.infer<typeof AgentSkillHarnessResultSchema>

export const MachineAgentSkillsSchema = z.object({
    /** SHA-256 (hex) of the canonical skill content embedded in this CLI build. */
    canonicalHash: z.string(),
    /** CLI version that produced this deployment report. */
    cliVersion: z.string(),
    /** Epoch millis of the last deploy+probe run. */
    checkedAt: z.number(),
    /** Keyed by creatable agent flavor. */
    harnesses: z.record(z.string(), AgentSkillHarnessResultSchema)
})

export type MachineAgentSkills = z.infer<typeof MachineAgentSkillsSchema>
