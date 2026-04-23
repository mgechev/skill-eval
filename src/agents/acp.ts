/**
 * ACP (Agent Client Protocol) Agent Implementation
 *
 * This agent communicates with ACP-compatible agents (like Gemini CLI with --acp flag)
 * using JSON-RPC 2.0 over stdio. This allows using any ACP-compatible agent without
 * requiring direct API key configuration.
 *
 * @see https://agentclientprotocol.com/
 */
import { spawn, ChildProcess } from 'child_process';
import { BaseAgent, CommandResult } from '../types';
import * as acp from '@agentclientprotocol/sdk';

/**
 * Configuration for ACP agent
 */
export interface AcpAgentConfig {
    /** Command to start the ACP agent (e.g., "gemini --acp") */
    command: string;
    /** Optional environment variables */
    env?: Record<string, string>;
    /** Optional API key for authentication */
    apiKey?: string;
    /** Timeout in milliseconds for agent operations (default: 300000 = 5 min) */
    timeout?: number;
}

/**
 * ACP Agent implementation that communicates with ACP-compatible agents.
 *
 * The Agent Client Protocol (ACP) is a standardized protocol for communication
 * between code editors/clients and AI coding agents. It uses JSON-RPC 2.0
 * over stdio for transport.
 *
 * Example usage:
 * - Gemini CLI: `gemini --acp`
 * - Any ACP-compatible agent
 */
export class AcpAgent extends BaseAgent {
    private config: AcpAgentConfig;
    private process: ChildProcess | null = null;
    private connection: acp.ClientSideConnection | null = null;
    private sessionId: string | null = null;
    private sessionOutputs: string[] = [];

    constructor(config: AcpAgentConfig) {
        super();
        this.config = {
            timeout: 300000,
            ...config,
        };
    }

    /**
     * Run an instruction using the ACP agent.
     */
    async run(
        instruction: string,
        workspacePath: string,
        runCommand: (cmd: string) => Promise<CommandResult>
    ): Promise<string> {
        try {
            // Initialize connection if not already established
            if (!this.connection) {
                await this.initialize(workspacePath);
            }

            if (!this.sessionId) {
                throw new Error('No active session. Failed to create session.');
            }

            // Clear session outputs
            this.sessionOutputs = [];

            // Send the prompt - prompt is an array of ContentBlock
            const promptContent = [
                { type: 'text', text: instruction },
            ];

            const response = await this.withTimeout(
                this.connection!.prompt({
                    sessionId: this.sessionId,
                    prompt: promptContent as acp.ContentBlock[],
                }),
                this.config.timeout!,
                'Prompt execution'
            );

            // Format response
            const outputs = [...this.sessionOutputs];
            if (response.stopReason) {
                outputs.push(`\n[Agent finished: ${response.stopReason}]`);
            }

            return outputs.join('\n').trim() || 'Agent completed without output.';

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return `ACP Agent error: ${errorMsg}`;
        }
    }

    /**
     * Initialize the ACP connection and create a session.
     */
    private async initialize(cwd: string): Promise<void> {
        // Parse command into parts
        const parts = this.config.command.split(' ');
        const command = parts[0];
        const args = parts.slice(1);

        // Spawn the ACP agent process
        this.process = spawn(command, args, {
            cwd,
            env: { ...process.env, ...this.config.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!this.process.stdin || !this.process.stdout) {
            throw new Error('Failed to create stdio streams for ACP process');
        }

        // Create the ACP stream from stdio
        // Convert Node.js streams to Web streams
        const stdoutWeb = this.process.stdout as unknown as WritableStream;
        const stdinWeb = this.process.stdin as unknown as ReadableStream<Uint8Array>;
        const stream = acp.ndJsonStream(stdoutWeb, stdinWeb);

        // Create client handler
        const clientHandler = this.createClientHandler();

        // Create client-side connection
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.connection = new acp.ClientSideConnection(clientHandler as any, stream);

        // Initialize the connection
        const initResponse = await this.withTimeout(
            this.connection.initialize({
                protocolVersion: acp.PROTOCOL_VERSION,
                clientCapabilities: {
                    fs: {
                        readTextFile: true,
                        writeTextFile: true,
                    },
                },
            }),
            30000,
            'ACP initialization'
        );

        // Authenticate if we have an API key
        if (this.config.apiKey) {
            // Find the API key auth method
            const authMethods = initResponse.authMethods || [];
            const apiKeyMethod = authMethods.find(
                (m) => m.id === 'use_gemini' || m.id === 'api_key'
            );

            if (apiKeyMethod) {
                const authRequest = {
                    methodId: apiKeyMethod.id,
                    _meta: {
                        'api-key': this.config.apiKey,
                    },
                };

                await this.withTimeout(
                    this.connection!.authenticate(authRequest as acp.AuthenticateRequest),
                    60000,
                    'ACP authentication'
                );
            }
        }

        // Create a new session
        const sessionResponse = await this.withTimeout(
            this.connection.newSession({
                cwd,
                mcpServers: [],
            }),
            30000,
            'ACP session creation'
        );

        this.sessionId = sessionResponse.sessionId;
    }

    /**
     * Create the client handler for handling agent requests.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private createClientHandler(): any {
        const self = this;

        return {
            // Handle permission requests from agent (auto-approve for evaluation)
            async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
                // Auto-approve for evaluation context by selecting the first option
                const options = params.options || [];
                if (options.length > 0) {
                    // Select the first option (usually "allow_once" or similar)
                    const response = {
                        outcome: 'selected',
                        optionId: options[0].optionId,
                    };
                    return response as unknown as acp.RequestPermissionResponse;
                }
                // If no options, cancel
                return { outcome: 'cancelled' } as unknown as acp.RequestPermissionResponse;
            },

            // Handle session updates from agent
            async sessionUpdate(params: acp.SessionNotification): Promise<void> {
                // Collect text content from update
                self.handleSessionUpdate(params.update);
            },

            // File system operations (not supported in evaluation mode)
            async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
                throw new Error('File system access not supported in ACP evaluation mode');
            },

            async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
                throw new Error('File system access not supported in ACP evaluation mode');
            },
        };
    }

    /**
     * Handle session updates from the agent.
     */
    private handleSessionUpdate(update: acp.SessionUpdate): void {
        // Check for text content
        const updateRecord = update as Record<string, unknown>;
        if ('content' in updateRecord && updateRecord.content) {
            const content = updateRecord.content as Record<string, unknown>;
            if ('text' in content && content.text) {
                this.sessionOutputs.push(String(content.text));
            }
        }
        // Check for tool call info
        if ('name' in updateRecord && updateRecord.name) {
            const status = 'status' in updateRecord ? updateRecord.status : 'unknown';
            this.sessionOutputs.push(`[Tool: ${updateRecord.name} - ${status}]`);
        }
    }

    /**
     * Wrap a promise with a timeout.
     */
    private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);

            promise.then(
                (result) => {
                    clearTimeout(timer);
                    resolve(result);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(error);
                }
            );
        });
    }

    /**
     * Cleanup the ACP connection and process.
     */
    async cleanup(): Promise<void> {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.connection = null;
        this.sessionId = null;
    }
}