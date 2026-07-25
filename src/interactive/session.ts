/**
 * Session executor - manages the execution flow of multi-turn interactive evaluation
 */
import { BaseAgent, CommandResult, ConversationMessage, TurnResult, LogEntry, AgentResult, SkillTriggerInfo } from '../types';
import { InteractiveConfig, ContextConfig } from '../core/config.types';
import { InputInjectorManager, TurnContext } from './injector';
import { parseOutputMarkers } from '../utils/markers';
import { withTimeout } from '../utils/timeout';
import { ClaudeStreamAgent } from '../agents/claude-stream';

type RunCommandFn = (cmd: string, env?: Record<string, string>) => Promise<CommandResult>;

const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
    max_history_turns: 10,
    include_system_prompt: false,
};

export interface SessionResult {
    turns: TurnResult[];
    conversation: ConversationMessage[];
    totalTurns: number;
    finalOutput: string;
}

export interface SessionOptions {
    instruction: string;
    workspace: string;
    timeoutPerTurn?: number;
    maxTurns: number;
}

export class InteractiveSession {
    private turnCount = 0;
    private conversation: ConversationMessage[] = [];
    private turns: TurnResult[] = [];
    private lastCommand: string = '';
    private commandCount = 0;
    private contextConfig: ContextConfig;
    private initialInstruction: string = '';
    private skillsTriggered: SkillTriggerInfo[] = [];
    private toolsUsed = new Set<string>();

    constructor(
        private agent: BaseAgent,
        private injectorManager: InputInjectorManager,
        private config: InteractiveConfig,
        private workspace: string,
        private runCommand: RunCommandFn,
        private logEntry: (entry: LogEntry) => void
    ) {
        this.contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config.context };
    }

    private buildPromptWithHistory(currentInput: string): string {
        const parts: string[] = [];

        if (this.contextConfig.include_system_prompt && this.contextConfig.system_prompt) {
            parts.push(`[System]\n${this.contextConfig.system_prompt}`);
            parts.push('');
        }

        const maxHistoryTurns = this.contextConfig.max_history_turns || 10;

        if (this.turnCount === 1 && this.initialInstruction) {
            parts.push(`[Initial Task]\n${this.initialInstruction}`);
            parts.push('');
        }

        const historyMessages = this.conversation.slice(0, -1).slice(-(maxHistoryTurns * 2));

        if (historyMessages.length > 0) {
            parts.push('[Conversation History]');
            for (const msg of historyMessages) {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                parts.push(`${role}: ${msg.content}`);
            }
            parts.push('');
        }

        if (this.turnCount === 1) {
            parts.push('[Your Response]');
        } else {
            parts.push(`[Current Input]\n${currentInput}`);
        }

        return parts.join('\n');
    }

    async run(initialInstruction: string): Promise<SessionResult> {
        this.initialInstruction = initialInstruction;
        let currentInput = initialInstruction;

        while (this.turnCount < this.injectorManager.getMaxTurns()) {
            this.turnCount++;

            this.logEntry({
                type: 'turn_start',
                timestamp: new Date().toISOString(),
                turn_id: this.turnCount,
                instruction: currentInput,
            });

            const turnResult = await this.runTurn(currentInput);
            this.turns.push(turnResult);

            if (turnResult.status === 'timeout' || turnResult.status === 'error') {
                this.logEntry({
                    type: 'turn_end',
                    timestamp: new Date().toISOString(),
                    turn_id: this.turnCount,
                    duration_ms: turnResult.duration_ms,
                    output: turnResult.output,
                });
                break;
            }

            this.logEntry({
                type: 'turn_end',
                timestamp: new Date().toISOString(),
                turn_id: this.turnCount,
                duration_ms: turnResult.duration_ms,
                output: turnResult.output,
            });

            const stopCheck = this.injectorManager.checkStopConditions({
                turnId: this.turnCount,
                lastOutput: turnResult.output,
                lastCommand: this.lastCommand,
                needsInput: turnResult.status === 'needs_input',
                inputType: turnResult.needs_input_type,
            });

            if (stopCheck.shouldStop) {
                break;
            }

            const nextInput = await this.getNextInput(turnResult);
            if (!nextInput) {
                break;
            }

            this.logEntry({
                type: 'input_injected',
                timestamp: new Date().toISOString(),
                turn_id: this.turnCount,
                input_type: 'injected',
                input_content: nextInput,
            });

            currentInput = nextInput;
        }

        const lastTurn = this.turns[this.turns.length - 1];

        return {
            turns: this.turns,
            conversation: this.conversation,
            totalTurns: this.turnCount,
            finalOutput: lastTurn?.output || '',
        };
    }

    private async runTurn(input: string): Promise<TurnResult> {
        const startTime = Date.now();
        const startCommandCount = this.commandCount;

        this.conversation.push({
            role: 'user',
            content: input,
            timestamp: new Date().toISOString(),
        });

        const loggedRunCommand = async (cmd: string, env?: Record<string, string>): Promise<CommandResult> => {
            this.lastCommand = cmd;
            this.commandCount++;

            const cmdStartTime = Date.now();
            const result = await this.runCommand(cmd, env);
            const cmdDuration = Date.now() - cmdStartTime;

            this.logEntry({
                type: 'command',
                timestamp: new Date().toISOString(),
                duration_ms: cmdDuration,
                command: cmd,
                cwd: this.workspace,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
            });

            return result;
        };

        const timeoutPerTurnSec = this.injectorManager.getTimeoutPerTurn() || 300;
        const turnTimeoutMs = timeoutPerTurnSec * 1000;

        let output: string;
        try {
            let agentRaw: string | AgentResult;

            if (this.agent instanceof ClaudeStreamAgent) {
                agentRaw = await withTimeout(
                    this.agent.sendMessage(input),
                    turnTimeoutMs,
                    `Turn ${this.turnCount} (limit: ${timeoutPerTurnSec}s)`
                );
            } else {
                const promptWithHistory = this.buildPromptWithHistory(input);
                agentRaw = await withTimeout(
                    this.agent.run(promptWithHistory, this.workspace, loggedRunCommand),
                    turnTimeoutMs,
                    `Turn ${this.turnCount} (limit: ${timeoutPerTurnSec}s)`
                );
            }

            if (typeof agentRaw === 'string') {
                output = agentRaw;
            } else {
                output = agentRaw.output;
                for (const skill of agentRaw.skills_triggered) {
                    const key = `${skill.source}:${skill.name}`;
                    if (!this.skillsTriggered.some(s => `${s.source}:${s.name}` === key)) {
                        this.skillsTriggered.push(skill);
                    }
                }
                for (const tool of agentRaw.tools_used) {
                    this.toolsUsed.add(tool);
                }
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            const errorMsg = error.message || String(error);
            const isTimeout = errorMsg.includes('timed out');

            let partialOutput = errorMsg;
            let partialSkills: SkillTriggerInfo[] | undefined;
            let partialTools: string[] | undefined;

            if (this.agent instanceof ClaudeStreamAgent) {
                const partial = this.agent.getPartialResult();
                partialOutput = partial.output || errorMsg;
                partialSkills = partial.skills_triggered;
                partialTools = partial.tools_used;

                for (const skill of partial.skills_triggered) {
                    const key = `${skill.source}:${skill.name}`;
                    if (!this.skillsTriggered.some(s => `${s.source}:${s.name}` === key)) {
                        this.skillsTriggered.push(skill);
                    }
                }
                for (const tool of partial.tools_used) {
                    this.toolsUsed.add(tool);
                }

                if (isTimeout) {
                    this.agent.close();
                }
            }

            this.conversation.push({
                role: 'assistant',
                content: partialOutput,
                timestamp: new Date().toISOString(),
            });

            return {
                turn_id: this.turnCount,
                input,
                output: partialOutput,
                status: isTimeout ? 'timeout' : 'error',
                commands_executed: this.commandCount - startCommandCount,
                duration_ms: duration,
                skills_triggered: partialSkills,
                tools_used: partialTools,
            };
        }

        const duration = Date.now() - startTime;

        this.conversation.push({
            role: 'assistant',
            content: output,
            timestamp: new Date().toISOString(),
        });

        const markers = parseOutputMarkers(output);

        return {
            turn_id: this.turnCount,
            input,
            output,
            status: markers.needsInput ? 'needs_input' : 'completed',
            needs_input_type: markers.inputType,
            needs_input_hint: markers.inputHint,
            commands_executed: this.commandCount - startCommandCount,
            duration_ms: duration,
        };
    }

    private async getNextInput(turnResult: TurnResult): Promise<string | null> {
        const injector = this.injectorManager.shouldInject({
            turnId: this.turnCount,
            lastOutput: turnResult.output,
            lastCommand: this.lastCommand,
            needsInput: turnResult.status === 'needs_input',
            inputType: turnResult.needs_input_type,
        });

        if (injector) {
            return await this.injectorManager.getInjectContent(injector, this.turnCount);
        }

        const allMatches = this.injectorManager.matchAllOutputPatterns(turnResult.output);
        if (allMatches.length > 0) {
            return allMatches.map(m => m.response).join('\n');
        }

        if (turnResult.status === 'needs_input' && turnResult.needs_input_type) {
            const autoResponse = this.injectorManager.getAutoResponse(turnResult.needs_input_type);
            if (autoResponse) {
                return autoResponse;
            }
        }

        return null;
    }

    getCurrentTurn(): number {
        return this.turnCount;
    }

    getConversation(): ConversationMessage[] {
        return [...this.conversation];
    }

    getTurns(): TurnResult[] {
        return [...this.turns];
    }

    getSkillsTriggered(): SkillTriggerInfo[] {
        return [...this.skillsTriggered];
    }

    getToolsUsed(): string[] {
        return Array.from(this.toolsUsed);
    }
}
