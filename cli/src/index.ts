#!/usr/bin/env bun

// Side-effect: registers Claude + Codex fork providers into the
// fork-features registry. Must precede any RPC dispatch that may
// receive ForkSpawnSession. See fork-features/trunk-patches.md.
import '../../fork-features/session-fork/register'

import { runCli } from './commands/runCli'

void runCli()
