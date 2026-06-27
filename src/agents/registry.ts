/**
 * Agent registry — maps agent names to their implementations.
 *
 * Supported agents:
 *   - gemini: Google Gemini CLI
 *   - claude: Anthropic Claude Code CLI
 *   - codex: OpenAI Codex CLI
 *   - acp: Agent Client Protocol compatible agents
 *   - opencode: OpenCode AI coding agent
 *   - command: arbitrary user-provided command (bring your own agent)
 */
import { BaseAgent } from '../types';
import { GeminiAgent } from './gemini';
import { ClaudeAgent } from './claude';
import { CodexAgent } from './codex';
import { AcpAgent, AcpAgentConfig } from './acp';
import { OpenCodeAgent, OpenCodeAgentConfig } from './opencode';
import { CommandAgent, CommandAgentConfig } from './command';

/** Configuration for agent creation */
export interface AgentConfig {
    /** ACP-specific configuration */
    acp?: AcpAgentConfig;
    /** OpenCode-specific configuration */
    opencode?: OpenCodeAgentConfig;
    /** Command agent configuration */
    command?: CommandAgentConfig;
}

/** Registry of available agent implementations */
const AGENT_REGISTRY: Record<string, (config?: AgentConfig) => BaseAgent> = {
    gemini: () => new GeminiAgent(),
    claude: () => new ClaudeAgent(),
    codex: () => new CodexAgent(),
    // ACP agent requires config, registered as placeholder
    acp: (config) => new AcpAgent(config?.acp || { command: 'gemini --acp' }),
    opencode: (config) => new OpenCodeAgent(config?.opencode || {}),
    // Command agent requires a command, validated in the CommandAgent constructor
    command: (config) => new CommandAgent(config?.command as CommandAgentConfig),
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
