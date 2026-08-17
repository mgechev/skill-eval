import { BaseAgent, CommandResult } from '../types';
import { shellQuote } from '../utils/shell';

export interface GeminiAgentConfig {
    /** Model name, passed straight to `gemini --model`. */
    model?: string;
}

export class GeminiAgent extends BaseAgent {
    private config: GeminiAgentConfig;

    constructor(config: GeminiAgentConfig = {}) {
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

        const model = this.config.model ? ` --model ${shellQuote(this.config.model)}` : '';
        const command = `gemini -y --sandbox=none${model} -p "$(cat /tmp/.prompt.md)"`;
        const result = await runCommand(command);

        if (result.exitCode !== 0) {
            console.error('GeminiAgent: Gemini CLI failed to execute correctly.');
        }

        return result.stdout + '\n' + result.stderr;
    }
}
