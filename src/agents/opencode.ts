import { BaseAgent, CommandResult } from '../types';

export interface OpenCodeAgentConfig {
    agent?: string;
    model?: string;
}

export class OpenCodeAgent extends BaseAgent {
    private config: OpenCodeAgentConfig;

    constructor(config: OpenCodeAgentConfig = {}) {
        super();
        this.config = config;
    }

    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        const fullCommand = `cd '${_workspacePath.replace(/'/g, "'\\''")}' && echo '${instruction.replace(/'/g, "'\\''")}' | opencode run ${this.config.model ? `--model ${this.config.model}` : ''}`;

        const result = await runCommand(fullCommand);
        return result.stdout + '\n' + result.stderr;
    }
}
