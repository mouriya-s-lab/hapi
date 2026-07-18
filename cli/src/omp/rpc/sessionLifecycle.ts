import type { OmpNativeSession } from '@hapi/protocol/types';
export { parseOmpSessionMutation } from '@hapi/protocol/ompSessionMutation';
import type { OmpRpcClient } from './OmpRpcClient';
import type {
    OmpCommandByType,
    OmpResponseData,
    OmpSessionState
} from './types';

export type OmpSessionMutationType =
    | 'new_session'
    | 'switch_session'
    | 'branch'
    | 'handoff'
    | 'set_session_name';

export type OmpSessionMutationCommand = {
    [Command in OmpSessionMutationType]: OmpCommandByType<Command>
}[OmpSessionMutationType];

export type OmpSessionMutationOutcome =
    | {
        status: 'unchanged';
        response: OmpResponseData<OmpSessionMutationType>;
    }
    | {
        status: 'applied';
        response: OmpResponseData<OmpSessionMutationType>;
        state: OmpSessionState;
        snapshot: OmpNativeSession;
    };

type OmpSessionRpc = Pick<OmpRpcClient, 'request'>;

export function nativeSessionSnapshotFromState(state: OmpSessionState): OmpNativeSession {
    const file = state.sessionFile?.trim();
    if (!file) {
        throw new Error(`OMP session ${state.sessionId} did not expose a persisted session file`);
    }
    const name = state.sessionName?.trim();
    return {
        id: state.sessionId,
        file,
        ...(name ? { name } : {})
    };
}

export async function reconcileOmpSessionState(
    client: OmpSessionRpc,
    applySnapshot: (snapshot: OmpNativeSession) => void
): Promise<{ state: OmpSessionState; snapshot: OmpNativeSession }> {
    const state = await client.request({ type: 'get_state' });
    const snapshot = nativeSessionSnapshotFromState(state);
    applySnapshot(snapshot);
    return { state, snapshot };
}

export async function runOmpSessionMutation(
    client: OmpSessionRpc,
    command: OmpSessionMutationCommand,
    applySnapshot: (snapshot: OmpNativeSession) => void
): Promise<OmpSessionMutationOutcome> {
    let response: OmpResponseData<OmpSessionMutationType>;
    let changed: boolean;
    switch (command.type) {
        case 'new_session':
        case 'switch_session':
        case 'branch':
            response = await client.request(command);
            changed = !response.cancelled;
            break;
        case 'handoff':
            response = await client.request(command);
            changed = response !== null;
            break;
        case 'set_session_name':
            response = await client.request(command);
            changed = true;
            break;
    }
    if (!changed) {
        return { status: 'unchanged', response };
    }
    const { state, snapshot } = await reconcileOmpSessionState(client, applySnapshot);
    return { status: 'applied', response, state, snapshot };
}

export class OmpSessionStateReconciler {
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly client: OmpSessionRpc,
        private readonly applySnapshot: (snapshot: OmpNativeSession) => void
    ) {}

    reconcile(): Promise<{ state: OmpSessionState; snapshot: OmpNativeSession }> {
        const task = this.tail.then(() => reconcileOmpSessionState(this.client, this.applySnapshot));
        this.tail = task.then(() => undefined, () => undefined);
        return task;
    }

    async drain(): Promise<void> {
        await this.tail;
    }
}
