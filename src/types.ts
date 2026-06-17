export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface GraderConfig {
    type: 'deterministic' | 'llm_rubric';
    command?: string;                             // for deterministic: shell command to execute (e.g. 'bash tests/test.sh')
    rubric?: string;                              // for llm_rubric: file path to rubric (e.g. 'prompts/quality.md')
    model?: string;                               // for llm_rubric: LLM model override
    provider?: 'gemini' | 'anthropic' | 'openai'; // for llm_rubric: which LLM API to call (default: 'gemini')
    weight: number;
}

export interface GraderResult {
    grader_type: string;
    score: number;      // 0.0 – 1.0
    weight: number;
    details: string;
}

export interface LogEntry {
    type: 'agent_start' | 'command' | 'agent_result' | 'grader' | 'reward' | 'turn_start' | 'turn_end' | 'input_injected' | 'error';
    timestamp: string;
    instruction?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    output?: string;
    value?: number;
    grader_result?: GraderResult;
    duration_ms?: number;
    turn_id?: number;
    input_type?: string;
    input_content?: string;
    cwd?: string;
    error_type?: string;
    error_message?: string;
    task_path?: string;
    workspace_path?: string;
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
    // Skill trigger tracking
    skills_triggered?: SkillTriggerInfo[];  // List of triggered skills
    tools_used?: string[];                  // List of tools used
    // Multi-turn interactive session data
    turns?: TurnResult[];
    conversation?: ConversationMessage[];
}

/** Skill trigger information during agent execution */
export interface SkillTriggerInfo {
    name: string;               // Skill name
    source: 'tool_use' | 'file_read' | 'init_list';  // Detection source
    timestamp?: string;         // Trigger timestamp
    details?: string;           // Additional details (e.g., file path read)
}

/** Structured agent execution result */
export interface AgentResult {
    output: string;                         // Final text output from agent
    raw_output?: string;                    // Raw CLI output
    skills_triggered: SkillTriggerInfo[];   // List of triggered skills
    tools_used: string[];                   // List of tools used (e.g., Read, Bash, Edit)
    num_turns?: number;                     // Number of API interaction turns
    duration_api_ms?: number;               // API duration in milliseconds
    cost_usd?: number;                      // Cost in USD
}

/** Conversation message for multi-turn sessions */
export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

/** Single turn execution result */
export interface TurnResult {
    turn_id: number;
    input: string;
    output: string;
    status: 'completed' | 'needs_input' | 'timeout' | 'error';
    needs_input_type?: string;
    needs_input_hint?: string;
    commands_executed: number;
    duration_ms: number;
    skills_triggered?: SkillTriggerInfo[];
    tools_used?: string[];
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
        runCommand: (cmd: string, env?: Record<string, string>) => Promise<CommandResult>
    ): Promise<string | AgentResult>;
}

/** Options passed to environment providers for setup */
export interface EnvironmentSetupOpts {
    timeoutSec: number;
    environment: {
        cpus: number;
        memory_mb: number;
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
