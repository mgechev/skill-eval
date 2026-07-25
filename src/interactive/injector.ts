/**
 * Input injector manager - manages input injection logic for multi-turn interactions
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import {
    InteractiveConfig,
    InputInjector as InputInjectorConfig,
    InteractionTrigger,
} from '../core/config.types';

/** Turn context for trigger condition evaluation */
export interface TurnContext {
    turnId: number;
    lastOutput: string;
    lastCommand?: string;
    needsInput: boolean;
    inputType?: string;
}

/** Session context with full conversation history */
export interface SessionContext {
    turns: TurnContext[];
    conversation: Array<{ role: string; content: string }>;
}

export class InputInjectorManager {
    constructor(
        private config: InteractiveConfig,
        private baseDir: string
    ) {}

    /**
     * Check if input should be injected
     * @returns Injector config if injection is needed, null otherwise
     */
    shouldInject(context: TurnContext): InputInjectorConfig | null {
        if (!this.config.injections?.length) {
            return null;
        }

        for (const injection of this.config.injections) {
            const trigger = injection.trigger;

            if (this.matchTrigger(trigger, context)) {
                return injection.injector;
            }
        }

        return null;
    }

    private matchTrigger(trigger: InteractionTrigger, context: TurnContext): boolean {
        switch (trigger.type) {
            case 'on_turn':
                return trigger.turns?.includes(context.turnId) ?? false;

            case 'on_output_contains':
                if (!trigger.pattern) return false;
                return context.lastOutput.includes(trigger.pattern);

            case 'on_command':
                if (!trigger.command_pattern || !context.lastCommand) return false;
                return context.lastCommand.includes(trigger.command_pattern);

            case 'on_needs_input':
                if (!context.needsInput) return false;
                if (trigger.input_type && trigger.input_type !== context.inputType) {
                    return false;
                }
                return true;

            default:
                return false;
        }
    }

    async getInjectContent(injector: InputInjectorConfig, turnId: number): Promise<string> {
        switch (injector.type) {
            case 'static':
                return injector.content || '';

            case 'file':
                if (!injector.file) return '';
                const filePath = injector.file
                    .replace(/{turn}/g, String(turnId))
                    .replace(/{TURN}/g, String(turnId));
                const fullPath = path.resolve(this.baseDir, filePath);
                try {
                    if (await fs.pathExists(fullPath)) {
                        return (await fs.readFile(fullPath, 'utf-8')).trim();
                    }
                } catch (err) {
                    console.warn(`Failed to read injection file: ${fullPath}`, err);
                }
                return '';

            case 'dynamic':
                if (!injector.script) return '';
                console.warn('Dynamic injector not yet implemented');
                return '';

            default:
                return '';
        }
    }

    /**
     * @deprecated Use matchAllOutputPatterns instead
     */
    matchOutputPattern(output: string): string | null {
        const allMatches = this.matchAllOutputPatterns(output);
        return allMatches.length > 0 ? allMatches[0].response : null;
    }

    matchAllOutputPatterns(output: string): Array<{ pattern: string; response: string; type?: string }> {
        const patterns = this.config.input_requests?.patterns || [];
        const matches: Array<{ pattern: string; response: string; type?: string }> = [];

        for (const p of patterns) {
            try {
                const regex = new RegExp(p.pattern, 'i');
                if (regex.test(output)) {
                    matches.push({
                        pattern: p.pattern,
                        response: p.response,
                        type: p.type,
                    });
                }
            } catch {
                if (output.includes(p.pattern)) {
                    matches.push({
                        pattern: p.pattern,
                        response: p.response,
                        type: p.type,
                    });
                }
            }
        }

        return matches;
    }

    getAutoResponse(inputType: string): string | null {
        const patterns = this.config.input_requests?.patterns || [];

        for (const p of patterns) {
            try {
                const regex = new RegExp(p.pattern, 'i');
                if (regex.test(inputType) || inputType.toLowerCase() === p.type.toLowerCase()) {
                    return p.response;
                }
            } catch {
                if (inputType.toLowerCase() === p.type.toLowerCase()) {
                    return p.response;
                }
            }
        }

        return null;
    }

    checkStopConditions(context: TurnContext): { shouldStop: boolean; reason?: string } {
        const conditions = this.config.stop_conditions || [];

        for (const condition of conditions) {
            switch (condition.type) {
                case 'output_matches':
                    if (condition.pattern && context.lastOutput.includes(condition.pattern)) {
                        return { shouldStop: true, reason: `Output matches: ${condition.pattern}` };
                    }
                    break;

                case 'command_executed':
                    if (condition.command && context.lastCommand?.includes(condition.command)) {
                        return { shouldStop: true, reason: `Command executed: ${condition.command}` };
                    }
                    break;

                case 'turns_reached':
                    if (condition.turns && context.turnId >= condition.turns) {
                        return { shouldStop: true, reason: `Max turns reached: ${condition.turns}` };
                    }
                    break;
            }
        }

        return { shouldStop: false };
    }

    getMaxTurns(): number {
        return this.config.max_turns || 10;
    }

    getTimeoutPerTurn(): number | undefined {
        return this.config.timeout_per_turn;
    }

    isEnabled(): boolean {
        return this.config.enabled;
    }
}
