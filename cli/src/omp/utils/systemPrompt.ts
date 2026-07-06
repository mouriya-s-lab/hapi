/**
 * Oh My Pi (omp) plan-mode system prompt.
 *
 * Mirrors the OpenCode plan-mode instruction. omp does not currently inject a
 * title instruction, so only the plan-mode constant lives here.
 */

import { trimIdent } from '@/utils/trimIdent';

/**
 * Instruction prepended to omp prompts while HAPI plan mode is active.
 */
export const PLAN_MODE_INSTRUCTION = trimIdent(`
    You are in plan mode. Do not execute tools or make changes. Analyze the request, ask clarifying questions if needed, and respond with a concise implementation plan only.
`);
