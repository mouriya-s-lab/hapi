import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerBashHandlers } from './handlers/bash'
import { registerCodexModelHandlers } from './handlers/codexModels'
import { registerImportableSessionHandlers } from './handlers/importableSessions'
import { registerCursorModelHandlers } from './handlers/cursorModels'
import { registerOpencodeModelHandlers } from './handlers/opencodeModels'
import { registerDirectoryHandlers } from './handlers/directories'
import { registerDifftasticHandlers } from './handlers/difftastic'
import { registerFileHandlers } from './handlers/files'
import { registerGitHandlers } from './handlers/git'
import { registerRipgrepHandlers } from './handlers/ripgrep'
import { registerSlashCommandHandlers } from './handlers/slashCommands'
import { registerSkillsHandlers } from './handlers/skills'
import { registerUploadHandlers } from './handlers/uploads'

export function registerCommonHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string, allowsImportCwd?: (cwd: string) => Promise<boolean>): void {
    registerBashHandlers(rpcHandlerManager, workingDirectory)
    registerCodexModelHandlers(rpcHandlerManager)
    registerImportableSessionHandlers(rpcHandlerManager, allowsImportCwd)
    registerCursorModelHandlers(rpcHandlerManager)
    registerOpencodeModelHandlers(rpcHandlerManager)
    registerFileHandlers(rpcHandlerManager, workingDirectory)
    registerDirectoryHandlers(rpcHandlerManager, workingDirectory)
    registerRipgrepHandlers(rpcHandlerManager, workingDirectory)
    registerDifftasticHandlers(rpcHandlerManager, workingDirectory)
    registerSlashCommandHandlers(rpcHandlerManager, workingDirectory)
    registerSkillsHandlers(rpcHandlerManager, workingDirectory)
    registerGitHandlers(rpcHandlerManager, workingDirectory)
    registerUploadHandlers(rpcHandlerManager)
}
