import { BaseAgent } from './core';

export class ClaudeAgent extends BaseAgent {
  /**
   * Runs Claude Code inside the environment.
   * Note: In a real-world scenario, 'claude' would be pre-installed 
   * in the Docker image or accessible via a global path.
   */
  async run(
    instruction: string,
    workspacePath: string,
    runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  ): Promise<string> {
    console.log('ClaudeAgent: Initiating Claude Code...');

    // Command to run Claude Code headlessly with the instruction.
    // Adding --no-auto-update and --yes to ensure non-interactive, reproducible runs.
    const claudeCommand = `claude "${instruction.replace(/"/g, '\\"')}" --yes --no-auto-update`;

    const result = await runCommand(claudeCommand);

    if (result.exitCode !== 0) {
      console.error('ClaudeAgent: Claude failed to execute correctly.');
    }

    return result.stdout + '\n' + result.stderr;
  }
}
