import { BaseAgent, CommandResult } from '../types';

export class GeminiAgent extends BaseAgent {
    async run(
        instruction: string,
        _workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>,
        options?: { agentWorkingDir?: string }
    ): Promise<string> {
        // Write instruction to a temp file to avoid shell escaping issues with long prompts
        const b64 = Buffer.from(instruction).toString('base64');
        await runCommand(`echo '${b64}' | base64 -d > /tmp/.prompt.md`);

        const command = `gemini -y --sandbox=none --output-format stream-json -p "$(cat /tmp/.prompt.md)"`;
        const fullCommand = options?.agentWorkingDir ? `cd ${options.agentWorkingDir} && ${command}` : command;
        const result = await runCommand(fullCommand);

        const lines = result.stdout.split('\n');
        const toolCalls: string[] = [];
        let finalResponse = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const event = JSON.parse(trimmed);
                if (event.type === 'tool_use') {
                    toolCalls.push(trimmed);
                } else if (event.type === 'message') {
                    finalResponse += event.content || event.text || '';
                } else if (event.type === 'result') {
                    finalResponse = event.response || finalResponse;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        // Write tool calls to file
        if (toolCalls.length > 0) {
            const toolCallsContent = toolCalls.join('\n');
            const b64Tools = Buffer.from(toolCallsContent).toString('base64');
            await runCommand(`echo '${b64Tools}' | base64 -d > .tool_calls.log`);
        }

        if (result.exitCode !== 0) {
            console.error('GeminiAgent: Gemini CLI failed to execute correctly.');
        }

        return finalResponse || (result.stdout + (result.stderr ? '\n' + result.stderr : ''));
    }
}
