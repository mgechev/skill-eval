/**
 * Agent registry — maps agent names to their implementations.
 *
 * Supported agents:
 *   - gemini: Google Gemini CLI
 *   - claude: Anthropic Claude Code CLI
 *   - codex: OpenAI Codex CLI
 *   - acp: Agent Client Protocol compatible agents
 *   - opencode: OpenCode AI coding agent
 */
import { BaseAgent } from '../types';
import { GeminiAgent } from './gemini';
import { ClaudeAgent } from './claude';
import { ClaudeStreamAgent } from './claude-stream';
import { CodexAgent } from './codex';
import { AcpAgent, AcpAgentConfig } from './acp';
import { OpenCodeAgent, OpenCodeAgentConfig } from './opencode';

/** Configuration for agent creation */
export interface AgentConfig {
    /** ACP-specific configuration */
    acp?: AcpAgentConfig;
    /** OpenCode-specific configuration */
    opencode?: OpenCodeAgentConfig;
}

/** Registry of available agent implementations */
const AGENT_REGISTRY: Record<string, (config?: AgentConfig) => BaseAgent> = {
    gemini: () => new GeminiAgent(),
    claude: () => new ClaudeAgent(),
    'claude-stream': () => new ClaudeStreamAgent(),
    codex: () => new CodexAgent(),
    // ACP agent requires config, registered as placeholder
    acp: (config) => new AcpAgent(config?.acp || { command: 'gemini --acp' }),
    opencode: (config) => new OpenCodeAgent(config?.opencode || {}),
};

/** Get the list of supported agent names */
export function getAgentNames(): string[] {
    return Object.keys(AGENT_REGISTRY);
}

/** Create an agent instance by name. Throws if the name is unknown. */
export function createAgent(name: string, config?: AgentConfig): BaseAgent {
    const factory = AGENT_REGISTRY[name];
    if (!factory) {
        const available = getAgentNames().join(', ');
        throw new Error(`Unknown agent "${name}". Available agents: ${available}`);
    }
    return factory(config);
}
