import type { Tool, Message, ChatResponse } from 'ollama';

export type { Tool, Message, ChatResponse };

/**
 * Function that executes a tool call and returns the result as a string.
 */
export type ToolExecutor = (
    name: string,
    args: Record<string, unknown>
) => Promise<string>;

/**
 * Three-tier permission configuration for bash command filtering.
 *
 * Tier 1: secureDenylist -- hardcoded, immutable patterns that can never be overridden.
 * Tier 2: agentDenylist/agentAllowlist -- sensible defaults for the agent.
 * Tier 3: taskDenylist/taskAllowlist -- per-task overrides from task.toml.
 */
export interface PermissionConfig {
    secureDenylist: string[];
    agentDenylist: string[];
    agentAllowlist: string[];
    taskDenylist: string[];
    taskAllowlist: string[];
}

/**
 * Configuration for the OllamaToolAgent.
 */
export interface OllamaAgentConfig {
    /** Ollama model name (default: 'qwen3-agent') */
    model: string;
    /** Ollama API host URL (default: 'http://localhost:11434') */
    host: string;
    /** Maximum tool-calling loop iterations (default: 30) */
    maxIterations: number;
    /** Maximum characters in tool output before truncation (default: 8000) */
    maxToolOutputChars: number;
}

/**
 * Default configuration values for OllamaToolAgent.
 */
export const DEFAULT_OLLAMA_AGENT_CONFIG: OllamaAgentConfig = {
    model: 'qwen3-agent',
    host: 'http://localhost:11434',
    maxIterations: 30,
    maxToolOutputChars: 8000,
};
