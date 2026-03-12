import { Ollama } from 'ollama';
import { BaseAgent, CommandResult } from '../../types';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Model name used by opencode. Uses qwen3:1.7b because:
 * - 2x faster than qwen3:4b (50 vs 22 tok/s at 8 threads)
 * - Half the memory (1.7 GB vs 3.2 GB loaded)
 * - Better /no_think compliance (375 vs 918 tokens for same workflow)
 * - Fits under 2.6 GiB memory pressure threshold
 * - Qwen 3.5 has broken tool calling on Ollama (issues #14493, #14745)
 * - Only Qwen3 family produces structured tool calls on Ollama
 * NO custom system prompt -- opencode provides its own via the OpenAI-compatible API.
 */
const OPENCODE_MODEL = 'qwen3-1.7b-opencode-agent';

/**
 * OpenCodeAgent -- wraps the `opencode run` CLI with config injection,
 * git init for project detection, and Ollama model unload.
 *
 * Follows the established CLI agent pattern (GeminiAgent/ClaudeAgent) with
 * three additions:
 * 1. Config injection: copies opencode.json into workspace CWD before launch
 * 2. Git init: opencode uses git root detection for project config lookup
 * 3. Model unload: calls keep_alive: 0 in finally block after run completes
 *
 * Uses qwen3.5:4b because Qwen 2.5 (both 3B and 7B) failed to handle
 * opencode's 10+ tool definitions via the OpenAI-compatible API. Qwen 3.5
 * has significantly better tool-calling training data. NO custom system
 * prompt -- opencode provides its own.
 *
 * Timeout protection is provided by the evalRunner's withTimeout wrapper.
 * The bash `timeout` command was removed because it causes SIGSEGV when
 * wrapping the opencode x64 binary under ARM64 QEMU emulation on Windows.
 */
export class OpenCodeAgent extends BaseAgent {
    private ollamaClient: Ollama;

    constructor() {
        super();
        this.ollamaClient = new Ollama({ host: 'http://localhost:11434' });
    }

    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        // 1. Inject opencode.json config into workspace
        //    Detect Docker context and adjust baseURL for host.docker.internal
        const configJson = JSON.parse(fs.readFileSync(
            path.join(__dirname, 'opencode.skill-eval-agent.json'),
            'utf-8'
        ));

        const hostnameResult = await runCommand('cat /proc/1/cgroup 2>/dev/null | head -1');
        let inDocker = hostnameResult.stdout.includes('docker')
            || hostnameResult.stdout.includes('kubepods');

        if (!inDocker) {
            // Also check for /workspace path pattern typical of Docker containers
            const pwdResult = await runCommand('pwd');
            const cwd = pwdResult.stdout.trim();

            if (cwd.startsWith('/workspace') && process.platform !== 'linux') {
                inDocker = true;
                console.log('[OpenCodeAgent] Docker context detected (workspace path) -- using host.docker.internal');
            }
        } else {
            console.log('[OpenCodeAgent] Docker context detected (cgroup) -- using host.docker.internal');
        }

        if (inDocker) {
            configJson.provider.ollama.options.baseURL = 'http://host.docker.internal:11434/v1';

            // Install opencode inside the container if not already present
            const whichResult = await runCommand('which opencode 2>/dev/null');

            if (whichResult.exitCode !== 0) {
                console.log('[OpenCodeAgent] Installing opencode inside Docker container...');
                const installResult = await runCommand('npm install -g opencode-ai 2>&1');

                if (installResult.exitCode !== 0) {
                    console.error('[OpenCodeAgent] Failed to install opencode:', installResult.stdout);
                }
            }
        }

        const configStr = JSON.stringify(configJson, null, 2);
        const b64Config = Buffer.from(configStr).toString('base64');
        await runCommand(`echo '${b64Config}' | base64 -d > opencode.json`);

        // 2. Initialize git repo -- opencode uses git root for project config lookup
        await runCommand('git init -q 2>/dev/null || true');

        // 3. Log model for diagnostics
        console.log(`[OpenCodeAgent] Using model: ${OPENCODE_MODEL}`);

        // 4. Write instruction to temp file (established base64 pattern)
        //    Prefix with a directive to use bash tools — small models try to
        //    invoke opencode's "Skill" system instead of running bash commands.
        const prefixedInstruction = [
            'CRITICAL: Execute ALL commands below in order. After each command completes, immediately run the next one. Do NOT stop, summarize, or explain between commands.',
            'You have 4 tools: Bash, Read, Edit, Write. Use Bash for ALL shell commands.',
            'IMPORTANT: When calling bash, you MUST provide both "command" and "description" fields. Example: {"command": "ls -la", "description": "List files in workspace"}',
            'After the last command, respond with a one-line summary.',
            '/no_think\n',
            instruction,
        ].join('\n');
        const b64 = Buffer.from(prefixedInstruction).toString('base64');
        await runCommand(`echo '${b64}' | base64 -d > /tmp/.prompt.md`);

        try {
            // 5. Invoke opencode with retry logic for SIGSEGV (exit 139).
            //    The opencode x64 binary intermittently segfaults under ARM64
            //    QEMU emulation. Retrying usually succeeds. Stdin is redirected
            //    from a regular file to reduce (but not eliminate) crash frequency.
            //    The evalRunner's withTimeout provides the outer timeout protection.
            const maxRetries = 3;
            let lastResult: CommandResult | null = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const result = await runCommand(`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1 opencode run "$(cat /tmp/.prompt.md)" < /tmp/.prompt.md`);
                lastResult = result;

                if (result.exitCode === 139) {
                    console.warn(`[OpenCodeAgent] SIGSEGV on attempt ${attempt}/${maxRetries} (x64 emulation instability)`);

                    if (attempt < maxRetries) {
                        continue;
                    }
                }

                break;
            }

            const result = lastResult!;

            if (result.exitCode !== 0) {
                console.error('[OpenCodeAgent] opencode exited with code:', result.exitCode);
            }

            return result.stdout + '\n' + result.stderr;
        } finally {
            // 6. Unload model (safety net, same pattern as OllamaToolAgent)
            try {
                await this.ollamaClient.chat({
                    model: OPENCODE_MODEL,
                    messages: [],
                    keep_alive: 0,
                });
            } catch {
                // Ignore unload errors -- model may already be unloaded
            }
        }
    }
}
