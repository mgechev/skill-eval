import { BaseAgent, CommandResult } from '../types';

export class ClaudeAgent extends BaseAgent {
    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        console.log('ClaudeAgent: Initiating Claude Code...');

        const escaped = instruction.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const claudeCommand = `claude "${escaped}" --yes --no-auto-update`;
        const result = await runCommand(claudeCommand);

        if (result.exitCode !== 0) {
            console.error('ClaudeAgent: Claude failed to execute correctly.');
        }

        return result.stdout + '\n' + result.stderr;
    }
}
