import { BaseAgent } from './core';

export class GeminiAgent extends BaseAgent {
  /**
   * Runs Gemini CLI inside the environment.
   */
  async run(
    instruction: string,
    workspacePath: string,
    runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  ): Promise<string> {
    console.log('GeminiAgent: Initiating Gemini CLI...');

    // gemini-cli "instruction"
    // We assume GEMINI_API_KEY is injected via env
    const command = `gemini-cli "${instruction.replace(/"/g, '\\"')}"`;

    const result = await runCommand(command);

    if (result.exitCode !== 0) {
      console.error('GeminiAgent: Gemini CLI failed to execute correctly.');
    }

    return result.stdout + '\n' + result.stderr;
  }
}
