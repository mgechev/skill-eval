export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface ExpectedTool {
    name: string;
    args?: Record<string, any>;
}

export interface GraderConfig {
    type: 'deterministic' | 'llm_rubric' | 'tool_usage';
    command?: string;         // for deterministic: shell command to execute (e.g. 'bash tests/test.sh')
    rubric?: string;          // for llm_rubric: file path to rubric (e.g. 'prompts/quality.md')
    model?: string;           // for llm_rubric: LLM model override
    expectedTools?: ExpectedTool[];  // for tool_usage: list of expected tool calls
    weight: number;
}

export interface GraderResult {
    grader_type: string;
    score: number;      // 0.0 – 1.0
    weight: number;
    details: string;
}

export interface LogEntry {
    type: 'agent_start' | 'command' | 'agent_result' | 'grader' | 'reward' | 'trial_setup' | 'trial_cleanup';
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
    status?: 'completed' | 'cancelled' | 'failed';
}

export interface EvalReport {
    task: string;
    timestamp: string;
    status: 'completed' | 'partial';
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
        runCommand: (cmd: string) => Promise<CommandResult>,
        options?: { agentWorkingDir?: string }
    ): Promise<string>;
}

/** Options passed to environment providers for setup */
export interface EnvironmentSetupOpts {
    timeoutSec: number;
    trialSetup?: string;
    environment: {
        cpus: number;
        memory_mb: number;
        mounts?: string[];
    };
}

export interface EnvironmentProvider {
    /** One-time setup: build image, inject skills. Returns reusable handle. */
    prepare?(taskPath: string, skillsPaths: string[], opts: EnvironmentSetupOpts, env?: Record<string, string>): Promise<string>;
    /** Per-trial setup: create isolated workspace. */
    setup(taskPath: string, skillsPaths: string[], opts: EnvironmentSetupOpts, env?: Record<string, string>): Promise<string>;
    /** Per-trial cleanup. */
    cleanup(workspacePath: string): Promise<void>;
    /** One-time teardown. */
    teardown?(): Promise<void>;
    runCommand(workspacePath: string, command: string, env?: Record<string, string>): Promise<CommandResult>;
    diagnose?(workspacePath: string): Promise<string>;
}
