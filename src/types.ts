export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface TaskMetadata {
    author_name: string;
    author_email: string;
    difficulty: string;
    category: string;
    tags: string[];
}

export interface TaskConfig {
    version: string;
    metadata: TaskMetadata;
    verifier: { timeout_sec: number };
    agent: { timeout_sec: number };
    environment: {
        build_timeout_sec: number;
        cpus: number;
        memory_mb: number;
        storage_mb: number;
    };
}

export interface LogEntry {
    type: 'agent_start' | 'command' | 'agent_result' | 'verifier' | 'reward';
    timestamp: string;
    instruction?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    output?: string;
    value?: number;
}

export interface TrialResult {
    trial_id: number;
    reward: number;
    session_log: LogEntry[];
}

export interface EvalReport {
    task: string;
    pass_rate: number;
    trials: TrialResult[];
    skills_used: string[];
}

export abstract class BaseAgent {
    abstract run(
        instruction: string,
        workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string>;
}

export interface EnvironmentProvider {
    setup(taskPath: string, skillsPaths: string[], taskConfig: TaskConfig, env?: Record<string, string>): Promise<string>;
    cleanup(workspacePath: string): Promise<void>;
    runCommand(workspacePath: string, command: string, env?: Record<string, string>): Promise<CommandResult>;
}
