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
    setup?: string;     // commands to install grader dependencies (runs during image build)
    run?: string;       // inline script or file path (deterministic)
    rubric?: string;    // inline rubric or file path (llm_rubric)
    weight: number;
}

/** Docker configuration */
export interface DockerConfig {
    base: string;       // base Docker image
    setup?: string;     // extra RUN commands for Dockerfile
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
    provider?: string;
    trials?: number;
    timeout?: number;
    docker?: DockerConfig;
}

/** Top-level defaults */
export interface EvalDefaults {
    agent: string;      // 'gemini' | 'claude'
    provider: string;   // 'docker' | 'local'
    trials: number;
    timeout: number;
    threshold: number;  // for --ci mode
    docker: DockerConfig;
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
    provider: string;
    trials: number;
    timeout: number;
    docker: DockerConfig;
}

export interface ResolvedGrader {
    type: 'deterministic' | 'llm_rubric';
    setup?: string;     // resolved setup commands
    run?: string;       // resolved content for deterministic
    rubric?: string;    // resolved content for llm_rubric
    weight: number;
}
