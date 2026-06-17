import { ChildProcess, spawn } from 'child_process';
import * as readline from 'readline';
import { BaseAgent, CommandResult, AgentResult, SkillTriggerInfo } from '../types';

const SKILL_PATH_REGEX = /(?:\.claude\/skills|\.agents\/skills|\.codefuse\/fuse\/skills)\/([^/]+)/;

interface StreamEvent {
    type: string;
    [key: string]: any;
}

export class ClaudeStreamAgent extends BaseAgent {
    protected binary = 'claude';

    protected buildArgs(): string[] {
        return [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--dangerously-skip-permissions',
            '--verbose',
        ];
    }

    private process: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private lineBuffer: string[] = [];
    private lineResolve: ((line: string) => void) | null = null;
    private lineReject: ((err: Error) => void) | null = null;
    private closed = false;

    private _partialSkills: SkillTriggerInfo[] = [];
    private _partialTools = new Set<string>();
    private _partialSeenSkills = new Set<string>();
    private _partialOutput = '';
    private _partialNumTurns?: number;
    private _partialDurationApiMs?: number;
    private _partialCostUsd?: number;

    start(workspacePath: string): void {
        this.closed = false;
        this.lineBuffer = [];
        this.lineResolve = null;
        this.lineReject = null;

        this.process = spawn(this.binary, this.buildArgs(), {
            cwd: workspacePath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        this.rl = readline.createInterface({ input: this.process.stdout! });

        this.rl.on('line', (line: string) => {
            if (this.lineResolve) {
                const resolve = this.lineResolve;
                this.lineResolve = null;
                this.lineReject = null;
                resolve(line);
            } else {
                this.lineBuffer.push(line);
            }
        });

        this.process.on('exit', () => {
            this.closed = true;
        });
    }

    private nextLine(): Promise<string> {
        if (this.lineBuffer.length > 0) {
            return Promise.resolve(this.lineBuffer.shift()!);
        }
        if (this.closed) {
            return Promise.reject(new Error('Claude process exited unexpectedly'));
        }
        return new Promise<string>((resolve, reject) => {
            this.lineResolve = resolve;
            this.lineReject = reject;
        });
    }

    async sendMessage(message: string): Promise<AgentResult> {
        if (!this.process || this.closed) {
            throw new Error('Claude stream process is not running');
        }

        this._partialSkills = [];
        this._partialTools = new Set();
        this._partialSeenSkills = new Set();
        this._partialOutput = '';
        this._partialNumTurns = undefined;
        this._partialDurationApiMs = undefined;
        this._partialCostUsd = undefined;

        const userMsg = {
            type: 'user',
            message: { role: 'user', content: message },
            parent_tool_use_id: null,
        };
        this.process.stdin!.write(JSON.stringify(userMsg) + '\n');

        try {
            while (true) {
                const line = await this.nextLine();
                let event: StreamEvent;
                try {
                    event = JSON.parse(line);
                } catch {
                    continue;
                }

                if (event.type === 'assistant' && event.message?.content) {
                    for (const block of event.message.content) {
                        if (block.type !== 'tool_use') continue;
                        const toolName = block.name;
                        this._partialTools.add(toolName);

                        if (toolName === 'Skill' && block.input?.name) {
                            const key = `tool:${block.input.name}`;
                            if (!this._partialSeenSkills.has(key)) {
                                this._partialSeenSkills.add(key);
                                this._partialSkills.push({
                                    name: block.input.name,
                                    source: 'tool_use',
                                    timestamp: new Date().toISOString(),
                                    details: `Skill tool invoked with name="${block.input.name}"`,
                                });
                            }
                        }

                        if (toolName === 'Read' && block.input?.file_path) {
                            const m = block.input.file_path.match(SKILL_PATH_REGEX);
                            if (m && !this._partialSeenSkills.has(`read:${m[1]}`)) {
                                this._partialSeenSkills.add(`read:${m[1]}`);
                                this._partialSkills.push({
                                    name: m[1],
                                    source: 'file_read',
                                    timestamp: new Date().toISOString(),
                                    details: `Read file: ${block.input.file_path}`,
                                });
                            }
                        }

                        if (toolName === 'SlashCommand' && block.input?.command) {
                            const sm = block.input.command.match(/^\/?([a-zA-Z0-9_-]+)/);
                            if (sm && !this._partialSeenSkills.has(`slash:${sm[1]}`)) {
                                this._partialSeenSkills.add(`slash:${sm[1]}`);
                                this._partialSkills.push({
                                    name: sm[1],
                                    source: 'tool_use',
                                    timestamp: new Date().toISOString(),
                                    details: `SlashCommand: ${block.input.command}`,
                                });
                            }
                        }
                    }
                }

                if (event.type === 'result') {
                    this._partialOutput = event.result || '';
                    this._partialNumTurns = event.num_turns;
                    this._partialDurationApiMs = event.duration_api_ms;
                    this._partialCostUsd = event.total_cost_usd;
                    break;
                }
            }
        } catch (err: any) {
            if (err.message === 'Agent process closed' ||
                err.message === 'Claude process exited unexpectedly') {
                return this.getPartialResult();
            }
            throw err;
        }

        return this.getPartialResult();
    }

    getPartialResult(): AgentResult {
        return {
            output: this._partialOutput || '',
            skills_triggered: [...this._partialSkills],
            tools_used: Array.from(this._partialTools),
            num_turns: this._partialNumTurns,
            duration_api_ms: this._partialDurationApiMs,
            cost_usd: this._partialCostUsd,
        };
    }

    close(): void {
        if (this.process && !this.closed) {
            this.process.kill('SIGTERM');
            this.closed = true;
        }
        if (this.lineReject) {
            const reject = this.lineReject;
            this.lineResolve = null;
            this.lineReject = null;
            reject(new Error('Agent process closed'));
        }
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        this.process = null;
    }

    isRunning(): boolean {
        return !!this.process && !this.closed;
    }

    async run(
        instruction: string,
        workspacePath: string,
        _runCommand: (cmd: string, env?: Record<string, string>) => Promise<CommandResult>
    ): Promise<AgentResult> {
        this.start(workspacePath);
        try {
            return await this.sendMessage(instruction);
        } finally {
            this.close();
        }
    }
}
