import { Ollama } from 'ollama';
import { BaseAgent, CommandResult } from '../../types';
import { OllamaAgentConfig, DEFAULT_OLLAMA_AGENT_CONFIG, PermissionConfig } from './types';
import { AGENT_TOOLS, createToolExecutor } from './tools';
import { SECURE_DENYLIST, AGENT_DEFAULT_DENYLIST, AGENT_DEFAULT_ALLOWLIST } from './permissions';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Load task-level agent permission overrides from task.toml [agent.permissions].
 */
function loadTaskPermissions(workspacePath: string): {
    taskDenylist: string[];
    taskAllowlist: string[];
} {
    try {
        const taskTomlPath = path.join(workspacePath, 'task.toml');
        const content = fs.readFileSync(taskTomlPath, 'utf-8');
        const toml = require('toml');
        const parsed = toml.parse(content);
        const perms = parsed?.agent?.permissions;

        return {
            taskDenylist: Array.isArray(perms?.denylist) ? perms.denylist : [],
            taskAllowlist: Array.isArray(perms?.allowlist) ? perms.allowlist : [],
        };
    } catch {
        return { taskDenylist: [], taskAllowlist: [] };
    }
}

const SYSTEM_PROMPT =
    'You are an AI agent that completes coding tasks. You have access to tools for ' +
    'reading files, writing files, listing directories, and running bash commands. ' +
    'Use these tools to complete the task. When you are done, respond with a summary of what you did.';

/**
 * OllamaToolAgent -- an agent that uses the Ollama chat API with structured tool calling.
 *
 * The agent loop sends messages to an Ollama model, executes any tool calls the model
 * requests, and iterates until the model responds without tool calls or the maximum
 * iteration count is reached.
 */
export class OllamaToolAgent extends BaseAgent {
    private config: OllamaAgentConfig;
    private client: Ollama;

    constructor(config?: Partial<OllamaAgentConfig>) {
        super();
        this.config = { ...DEFAULT_OLLAMA_AGENT_CONFIG, ...config };
        this.client = new Ollama({ host: this.config.host });
    }

    async run(
        instruction: string,
        workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        // Build permission config
        const taskPerms = loadTaskPermissions(workspacePath);
        const permissionConfig: PermissionConfig = {
            secureDenylist: SECURE_DENYLIST,
            agentDenylist: AGENT_DEFAULT_DENYLIST,
            agentAllowlist: AGENT_DEFAULT_ALLOWLIST,
            taskDenylist: taskPerms.taskDenylist,
            taskAllowlist: taskPerms.taskAllowlist,
        };

        // Create tool executor
        const executeTool = createToolExecutor(workspacePath, runCommand, permissionConfig);

        // Initialize messages
        const messages: Array<{ role: string; content: string; tool_calls?: any[] }> = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: instruction },
        ];

        let finalContent = '[Agent reached max iterations without completing]';

        try {
            for (let i = 0; i < this.config.maxIterations; i++) {
                const response = await this.client.chat({
                    model: this.config.model,
                    messages: messages as any,
                    tools: AGENT_TOOLS,
                    stream: false,
                    think: false,
                });

                const toolCalls = response.message.tool_calls;

                if (!toolCalls || toolCalls.length === 0) {
                    finalContent = response.message.content || finalContent;
                    break;
                }

                // Push assistant message with tool calls
                messages.push({
                    role: 'assistant',
                    content: response.message.content || '',
                    tool_calls: toolCalls,
                });

                // Execute each tool call and push results
                for (const toolCall of toolCalls) {
                    const name = toolCall.function.name;
                    const args = toolCall.function.arguments as Record<string, unknown>;
                    const result = await executeTool(name, args);

                    messages.push({
                        role: 'tool',
                        content: result,
                    });
                }
            }
        } finally {
            // Always unload the model after run completes (keep_alive: 0)
            try {
                await this.client.chat({
                    model: this.config.model,
                    messages: [],
                    keep_alive: 0,
                });
            } catch {
                // Ignore unload errors -- model may already be unloaded
            }
        }

        return finalContent;
    }
}
