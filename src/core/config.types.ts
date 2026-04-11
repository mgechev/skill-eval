import { ExpectedTool } from '../types';

/**
 * eval.yaml configuration types.
 *
 * These types define the schema for the eval.yaml file that developers
 * create to define evaluation tasks for their skills.
 */

/** Workspace file mapping: copy a local file into the container */
export interface WorkspaceMapping {
    src?: string;       // relative to eval.yaml
    content?: string;   // inline content
    dest: string;       // path in container (relative = in /workspace, absolute = absolute)
    chmod?: string;     // e.g. "+x"
}

/** Grader definition */
export interface EvalGraderConfig {
    type: 'deterministic' | 'llm_rubric' | 'tool_usage';
    setup?: string;     // commands to install grader dependencies (runs during image build)
    run?: string;       // inline script or file path (deterministic)
    rubric?: string;    // inline rubric or file path (llm_rubric)
    model?: string;     // LLM model override (e.g. 'gemini-2.0-flash', 'claude-sonnet-4-20250514')
    weight: number;
    expectedTools?: ExpectedTool[]; // for tool_usage: list of expected tool calls
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
    mounts?: string[];
}

export interface TrialConfig {
    setup?: string;
    cleanup?: string;
    env?: Record<string, string>;
}

/** Single eval task */
export interface EvalTaskConfig {
    name: string;
    instruction: string;    // inline text or path to .md file
    workspace?: WorkspaceMapping[];
    graders: EvalGraderConfig[];
    solution?: string;      // path to reference solution script
    trialConfig?: TrialConfig;
    env?: Record<string, string>;

    // Per-task overrides
    agent?: string;
    provider?: string;
    trials?: number;
    timeout?: number;
    grader_model?: string;
    docker?: DockerConfig;
    environment?: Partial<EnvironmentConfig>;
    agentWorkingDir?: string;
}

/** Top-level defaults */
export interface EvalDefaults {
    agent: string;      // 'gemini' | 'claude' | 'codex'
    provider: string;   // 'docker' | 'local'
    trials: number;
    timeout: number;
    threshold: number;  // for --ci mode
    grader_model?: string;  // default LLM grader model
    docker: DockerConfig;
    environment: EnvironmentConfig;
    env?: Record<string, string>;
    trialConfig?: TrialConfig;
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
    trialConfig?: TrialConfig;
    agent: string;
    provider: string;
    trials: number;
    timeout: number;
    grader_model?: string;  // inherited default model for LLM graders
    docker: DockerConfig;
    environment: EnvironmentConfig;
    env?: Record<string, string>;
    agentWorkingDir?: string;
}

export interface ResolvedGrader {
    type: 'deterministic' | 'llm_rubric' | 'tool_usage';
    setup?: string;     // resolved setup commands
    run?: string;       // resolved content for deterministic
    rubric?: string;    // resolved content for llm_rubric
    model?: string;     // LLM model override
    weight: number;
    expectedTools?: ExpectedTool[]; // for tool_usage: list of expected tool calls
}
