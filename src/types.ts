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

export interface GraderConfig {
    type: 'deterministic' | 'llm_rubric';
    command?: string;         // for deterministic
    rubric?: string;          // for llm_rubric — path relative to task dir
    model?: string;           // for llm_rubric
    weight: number;
}

export interface TaskConfig {
    version: string;
    metadata: TaskMetadata;
    graders: GraderConfig[];
    agent: { timeout_sec: number };
    environment: {
        build_timeout_sec: number;
        cpus: number;
        memory_mb: number;
        storage_mb: number;
    };
}

export interface GraderResult {
    grader_type: string;
    score: number;      // 0.0 – 1.0
    weight: number;
    details: string;
}

export interface LogEntry {
    type: 'agent_start' | 'command' | 'agent_result' | 'grader' | 'reward';
    timestamp: string;
    instruction?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    output?: string;
    value?: number;
    grader_result?: GraderResult;
}

export interface TrialResult {
    trial_id: number;
    reward: number;           // 0.0 – 1.0 weighted score
    grader_results: GraderResult[];
    duration_ms: number;
    n_commands: number;
    input_tokens: number;     // estimated from instruction length
    output_tokens: number;    // estimated from agent output
    session_log: LogEntry[];
}

export interface EvalReport {
    task: string;
    pass_rate: number;
    pass_at_k: number;        // probability of ≥1 success in k trials
    pass_pow_k: number;       // probability of all k trials succeeding
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
