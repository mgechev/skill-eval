import { BaseAgent, CommandResult, AgentResult, SkillTriggerInfo } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Parse --json JSONL output from Codex CLI to extract structured info.
 *
 * JSONL events of interest:
 *   - type=item.completed, item.type="command_execution" → tool/command usage
 *   - type=item.completed, item.type="agent_message"     → agent text output
 *   - type=turn.completed, usage                         → token counts
 */
function parseCodexJsonOutput(rawOutput: string): AgentResult {
    const lines = rawOutput.split('\n').filter(l => l.trim());
    const toolsUsed = new Set<string>();
    const skillsTriggered: SkillTriggerInfo[] = [];
    const seenSkills = new Set<string>();
    const messageParts: string[] = [];

    let inputTokens = 0;
    let outputTokens = 0;
    let numTurns = 0;

    for (const line of lines) {
        let event: any;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }

        if (event.type === 'item.completed' && event.item) {
            const item = event.item;

            // Agent text message
            if (item.type === 'agent_message' && item.text) {
                messageParts.push(item.text);
            }

            // Command execution → record as tool usage
            if (item.type === 'command_execution') {
                toolsUsed.add('command_execution');

                // Detect skill file reads from commands
                const cmd: string = item.command || '';
                const skillMatch = cmd.match(
                    /(?:\.claude\/skills|\.agents\/skills|\.codefuse\/fuse\/skills)\/([^/\s]+)/
                );
                if (skillMatch) {
                    const skillName = skillMatch[1];
                    if (!seenSkills.has(`cmd:${skillName}`)) {
                        seenSkills.add(`cmd:${skillName}`);
                        skillsTriggered.push({
                            name: skillName,
                            source: 'file_read',
                            timestamp: new Date().toISOString(),
                            details: `Command referenced skill: ${cmd}`,
                        });
                    }
                }
            }

            // Function call (if Codex supports tool_use style items in future)
            if (item.type === 'tool_use' || item.type === 'function_call') {
                const toolName = item.name || item.function?.name || 'unknown';
                toolsUsed.add(toolName);
            }
        }

        // Token usage from turn completion
        if (event.type === 'turn.completed' && event.usage) {
            numTurns++;
            inputTokens += event.usage.input_tokens || 0;
            outputTokens += event.usage.output_tokens || 0;
        }
    }

    const finalOutput = messageParts.join('\n');

    return {
        output: finalOutput,
        skills_triggered: skillsTriggered,
        tools_used: Array.from(toolsUsed),
        num_turns: numTurns || undefined,
    };
}

export class CodexAgent extends BaseAgent {
    /**
     * Read API keys from ~/.codex/auth.json
     * Returns environment variables to inject for codex CLI
     */
    private getCodexEnvVars(): Record<string, string> {
        const authPath = path.join(os.homedir(), '.codex', 'auth.json');
        const envVars: Record<string, string> = {};

        try {
            if (fs.existsSync(authPath)) {
                const authContent = fs.readFileSync(authPath, 'utf-8');
                const auth = JSON.parse(authContent);

                // Map auth.json keys to environment variables
                if (auth.OPENAI_API_KEY) {
                    envVars.OPENAI_API_KEY = auth.OPENAI_API_KEY;
                }
                if (auth.ZENMUX_API_KEY) {
                    envVars.ZENMUX_API_KEY = auth.ZENMUX_API_KEY;
                }
                // Also check for other common API key formats
                for (const [key, value] of Object.entries(auth)) {
                    if (key.endsWith('_API_KEY') && typeof value === 'string') {
                        envVars[key] = value;
                    }
                }
            }
        } catch (e) {
            // Ignore errors - auth.json may not exist or be malformed
        }

        return envVars;
    }

    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string, env?: Record<string, string>) => Promise<CommandResult>
    ): Promise<AgentResult> {
        // Write instruction to a temp file to avoid shell escaping issues with long prompts
        const b64 = Buffer.from(instruction).toString('base64');
        await runCommand(`echo '${b64}' | base64 -d > /tmp/.prompt.md`);

        // Get API keys from auth.json
        const envVars = this.getCodexEnvVars();

        // Use --json for structured JSONL output, --ephemeral to avoid writing session files
        // codex exec runs non-interactively; --full-auto enables sandboxed auto-execution
        // --skip-git-repo-check allows running in non-git temp directories
        const command = `cat /tmp/.prompt.md | codex exec --full-auto --skip-git-repo-check --json --ephemeral`;
        const result = await runCommand(command, Object.keys(envVars).length > 0 ? envVars : undefined);

        if (result.exitCode !== 0) {
            console.error('CodexAgent: Codex CLI failed to execute correctly.');
        }

        // Parse JSONL events to extract structured info
        const agentResult = parseCodexJsonOutput(result.stdout);
        agentResult.raw_output = result.stdout.length > 256 * 1024
            ? result.stdout.slice(0, 256 * 1024) + '\n... [truncated]'
            : result.stdout;

        // Fallback: if parsing didn't extract any output, use raw stdout+stderr
        if (!agentResult.output) {
            agentResult.output = result.stdout + '\n' + result.stderr;
        }

        return agentResult;
    }
}