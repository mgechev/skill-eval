import { BaseAgent, CommandResult } from '../types';

export class GeminiAgent extends BaseAgent {
    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        console.log('GeminiAgent: Initiating Gemini CLI...');

        const escaped = instruction.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const command = `gemini -y "${escaped}"`;
        const result = await runCommand(command);

        if (result.exitCode !== 0) {
            console.error('GeminiAgent: Gemini CLI failed to execute correctly.');
        }

        return result.stdout + '\n' + result.stderr;
    }
}
