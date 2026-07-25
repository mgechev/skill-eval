/**
 * eval.yaml configuration types.
 *
 * These types define the schema for the eval.yaml file that developers
 * create to define evaluation tasks for their skills.
 */

/** Workspace file mapping: copy a local file into the container */
export interface WorkspaceMapping {
    src: string;        // relative to eval.yaml
    dest: string;       // path in container (relative = in /workspace, absolute = absolute)
    chmod?: string;     // e.g. "+x"
}

/** Grader definition */
export interface EvalGraderConfig {
    type: 'deterministic' | 'llm_rubric';
    setup?: string;                               // commands to install grader dependencies (runs during image build)
    run?: string;                                 // inline script or file path (deterministic)
    rubric?: string;                              // inline rubric or file path (llm_rubric)
    model?: string;                               // model override, e.g. 'claude-sonnet-5' or 'gemini-3-flash-preview'
    provider?: 'gemini' | 'anthropic' | 'openai'; // which LLM API to call (default: 'gemini')
    weight: number;
}

/** Docker configuration */
export interface DockerConfig {
    base: string;       // base Docker image
    setup?: string;     // extra RUN commands for Dockerfile
}

/** Environment resource limits */
export interface EnvironmentConfig {
    cpus: number;
    memory_mb: number;
}

/** ACP (Agent Client Protocol) configuration */
export interface AcpConfig {
    /** Command to start the ACP agent (e.g., "gemini --acp") */
    command: string;
    /** Optional environment variables for the ACP process */
    env?: Record<string, string>;
}

/** Single eval task */
export interface EvalTaskConfig {
    name: string;
    instruction: string;    // inline text or path to .md file
    workspace?: WorkspaceMapping[];
    graders: EvalGraderConfig[];
    solution?: string;      // path to reference solution script

    // Per-task overrides
    agent?: string;
    command?: string;   // command to run when agent is 'command'
    provider?: string;
    trials?: number;
    timeout?: number;
    grader_model?: string;
    grader_provider?: 'gemini' | 'anthropic' | 'openai';
    docker?: DockerConfig;
    environment?: Partial<EnvironmentConfig>;
    interactive?: InteractiveConfig;
}

/** Top-level defaults */
export interface EvalDefaults {
    agent: string;      // 'gemini' | 'claude' | 'codex' | 'acp' | 'opencode' | 'command'
    command?: string;   // command to run when agent is 'command' (e.g. "node mycli.js")
    provider: string;   // 'docker' | 'local'
    trials: number;
    timeout: number;
    threshold: number;  // for --ci mode
    grader_model?: string;      // default LLM grader model
    grader_provider?: 'gemini' | 'anthropic' | 'openai';  // default LLM grader provider
    acp?: AcpConfig;    // ACP agent configuration
    docker: DockerConfig;
    environment: EnvironmentConfig;
}

/** Top-level eval.yaml */
export interface EvalConfig {
    version: string;
    skill?: string;         // optional path to SKILL.md (defaults to auto-detection)
    defaults: EvalDefaults;
    tasks: EvalTaskConfig[];
}

/** Resolved task — all defaults applied, file references resolved to content */
export interface ResolvedTask {
    name: string;
    instruction: string;    // actual content (not file path)
    workspace: WorkspaceMapping[];
    graders: ResolvedGrader[];
    solution?: string;      // resolved file path
    agent: string;
    command?: string;       // command to run when agent is 'command'
    provider: string;
    trials: number;
    timeout: number;
    grader_model?: string;                                      // inherited default model for LLM graders
    grader_provider?: 'gemini' | 'anthropic' | 'openai';        // inherited default provider for LLM graders
    acp?: AcpConfig;        // ACP agent configuration
    docker: DockerConfig;
    environment: EnvironmentConfig;
    interactive?: InteractiveConfig;
}

export interface ResolvedGrader {
    type: 'deterministic' | 'llm_rubric';
    setup?: string;                               // resolved setup commands
    run?: string;                                 // resolved content for deterministic
    rubric?: string;                              // resolved content for llm_rubric
    model?: string;                               // resolved model override
    provider?: 'gemini' | 'anthropic' | 'openai'; // which LLM API to call (default: 'gemini')
    weight: number;
}

// ==================== Interactive (multi-turn) config ====================

/** Interaction trigger */
export interface InteractionTrigger {
    type: 'on_turn' | 'on_output_contains' | 'on_needs_input' | 'on_command';
    turns?: number[];                 // on_turn: trigger on these turns [1, 3, 5]
    pattern?: string;                 // on_output_contains: match pattern
    command_pattern?: string;         // on_command: command match pattern
    input_type?: string;              // on_needs_input: input request type
}

/** Input injector */
export interface InputInjector {
    type: 'static' | 'file' | 'dynamic';
    content?: string;                 // static: inline content
    file?: string;                    // file: file path (supports {turn} placeholder)
    script?: string;                  // dynamic: script for generating content
}

/** Input request auto-response config */
export interface InputRequestPattern {
    pattern: string;                  // marker pattern in output (regex)
    type: string;                     // request type
    response: string;                 // auto-response content
}

/** Context passing config */
export interface ContextConfig {
    max_history_turns?: number;       // max history turns to avoid token overflow (default: 10)
    include_system_prompt?: boolean;  // whether to include system prompt (default: false)
    system_prompt?: string;           // custom system prompt
}

/** Interactive evaluation config */
export interface InteractiveConfig {
    enabled: boolean;                 // enable multi-turn mode
    max_turns: number;                // max turns (default: 10)
    timeout_per_turn?: number;        // per-turn timeout (seconds)

    // Context passing config
    context?: ContextConfig;

    // Auto-responses when agent requests input
    input_requests?: {
        patterns: InputRequestPattern[];
    };

    // Predetermined injections
    injections?: Array<{
        trigger: InteractionTrigger;
        injector: InputInjector;
    }>;

    // Stop conditions
    stop_conditions?: Array<{
        type: 'output_matches' | 'command_executed' | 'turns_reached';
        pattern?: string;
        command?: string;
        turns?: number;
    }>;
}
