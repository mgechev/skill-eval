import { BaseAgent, CommandResult } from '../types';

export class ClaudeAgent extends BaseAgent {
    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        // Write instruction to a temp file to avoid shell escaping issues with long prompts
        const b64 = Buffer.from(instruction).toString('base64');
        await runCommand(`echo '${b64}' | base64 -d > /tmp/.prompt.md`);

        const command = `claude "$(cat /tmp/.prompt.md)" --yes --no-auto-update`;
        const result = await runCommand(command);

        if (result.exitCode !== 0) {
            console.error('ClaudeAgent: Claude failed to execute correctly.');
        }

        return result.stdout + '\n' + result.stderr;
    }
}
