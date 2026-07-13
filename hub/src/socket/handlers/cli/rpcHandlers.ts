import { z } from 'zod'
import type { RpcRegistry } from '../../rpcRegistry'
import type { CliSocketWithData } from '../../socketTypes'

type RpcResourceType = 'session' | 'machine'

const rpcRegisterSchema = z.object({
    method: z.string().min(1)
})

const rpcUnregisterSchema = z.object({
    method: z.string().min(1)
})

export function registerRpcHandlers(socket: CliSocketWithData, rpcRegistry: RpcRegistry, canRegister: (resourceId: string, resourceType: RpcResourceType) => boolean): void {
    socket.on('rpc-register', (data: unknown) => {
        const parsed = rpcRegisterSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const resourceId = parsed.data.method.split(':', 1)[0]
        const resourceType = socket.data.clientType === 'machine-scoped' ? 'machine' : 'session'
        if (resourceId && canRegister(resourceId, resourceType)) {
            rpcRegistry.register(socket, parsed.data.method, () => canRegister(resourceId, resourceType))
        }
    })

    socket.on('rpc-unregister', (data: unknown) => {
        const parsed = rpcUnregisterSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        rpcRegistry.unregister(socket, parsed.data.method)
    })
}
