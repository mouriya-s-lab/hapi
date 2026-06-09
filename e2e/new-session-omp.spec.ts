import { expect, test, type Page } from '@playwright/test'

type NewSessionOmpFixtureState = {
    modelProbeCalls: Array<{ machineId: string; cwd: string; agent: 'opencode' | 'omp' }>
    spawnCalls: Array<{ machineId: string; directory: string; agent?: string; model?: string }>
}

function readFixtureState(page: Page): Promise<NewSessionOmpFixtureState> {
    return page.evaluate(() => (
        (window as unknown as { __newSessionOmpFixture: NewSessionOmpFixtureState }).__newSessionOmpFixture
    ))
}

async function gotoFixture(page: Page): Promise<void> {
    await page.goto('/e2e-fixtures/new-session-omp-fixture.html')
    await expect(page.getByTestId('new-session-omp-host')).toBeVisible()
}

test.describe('new session — OMP model selection', () => {
    test('discovers OMP ACP models and passes the selected model when creating', async ({ page }) => {
        await gotoFixture(page)

        await expect(page.getByTestId('opencode-model-list')).toBeVisible()
        await expect(page.getByRole('button', { name: /MLX\/Qwen 3\.6 32B Q8/ })).toBeVisible()

        const modelProbeCalls = (await readFixtureState(page)).modelProbeCalls
        expect(modelProbeCalls).toContainEqual({
            machineId: 'machine-omp',
            cwd: '/tmp/hapi-omp-project',
            agent: 'omp'
        })

        await page.getByRole('button', { name: 'Create' }).click()

        await expect.poll(async () => (
            (await readFixtureState(page)).spawnCalls
        )).toContainEqual({
            machineId: 'machine-omp',
            directory: '/tmp/hapi-omp-project',
            agent: 'omp',
            model: 'mlx/qwen3:32b'
        })
    })
})
