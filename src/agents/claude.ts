import { BaseAgent, CommandResult } from '../types';

export interface ClaudeAgentConfig {
    /** Model alias or full id, passed straight to `claude --model`. */
    model?: string;
}

export class ClaudeAgent extends BaseAgent {
    private config: ClaudeAgentConfig;

    constructor(config: ClaudeAgentConfig = {}) {
        super();
        this.config = config;
    }

    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        // Write instruction to a temp file to avoid shell escaping issues with long prompts
        const b64 = Buffer.from(instruction).toString('base64');
        await runCommand(`echo '${b64}' | base64 -d > /tmp/.prompt.md`);

        // Without --model, Claude Code answers with whatever the account default
        // is — which is invisible in the results and can change under you.
        const model = this.config.model ? ` --model ${shellQuote(this.config.model)}` : '';
        const command = `claude -p --dangerously-skip-permissions${model} "$(cat /tmp/.prompt.md)"`;
        const result = await runCommand(command);

        if (result.exitCode !== 0) {
            console.error('ClaudeAgent: Claude failed to execute correctly.');
        }

        return result.stdout + '\n' + result.stderr;
    }
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
