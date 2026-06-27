import { BaseAgent, CommandResult } from '../types';

export interface CommandAgentConfig {
    /** The command to run (e.g. "node mycli.js"). The prompt is piped to its stdin. */
    command: string;
    /** Optional environment variables for the command process. */
    env?: Record<string, string>;
}

/**
 * Generic agent that runs an arbitrary command, letting users bring their own
 * CLI (a custom script, a deepagents loop, an SDK orchestrator) without forking
 * the package or implementing an ACP server.
 *
 * The task instruction is piped to the command's stdin. Grading scores ground
 * truth (deterministic graders / live workspace state), not stdout, so any
 * command slots in cleanly. Returns combined stdout + stderr, like opencode.
 */
export class CommandAgent extends BaseAgent {
    private config: CommandAgentConfig;

    constructor(config: CommandAgentConfig) {
        super();
        if (!config || !config.command || !config.command.trim()) {
            throw new Error(
                'Command agent requires a command. Specify via --command or command in eval.yaml'
            );
        }
        this.config = config;
    }

    async run(
        instruction: string,
        workspacePath: string,
        runCommand: (cmd: string, env?: Record<string, string>) => Promise<CommandResult>
    ): Promise<string> {
        // Write the instruction to a file via base64 to avoid shell escaping
        // issues with long or special-character prompts, then pipe it to stdin.
        const b64 = Buffer.from(instruction).toString('base64');
        await runCommand(`echo '${b64}' | base64 -d > /tmp/.prompt.md`);

        const cwd = workspacePath.replace(/'/g, "'\\''");
        const fullCommand = `cd '${cwd}' && cat /tmp/.prompt.md | ${this.config.command}`;

        const env = this.config.env && Object.keys(this.config.env).length > 0
            ? this.config.env
            : undefined;
        const result = await runCommand(fullCommand, env);

        if (result.exitCode !== 0) {
            console.error('CommandAgent: command exited with a non-zero status.');
        }

        return result.stdout + '\n' + result.stderr;
    }
}
