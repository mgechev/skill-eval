import { GraderConfig, GraderResult, CommandResult, EnvironmentProvider } from '../types';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface Grader {
    grade(
        workspace: string,
        provider: EnvironmentProvider,
        config: GraderConfig,
        taskPath: string,
        sessionLog: any[],
        env?: Record<string, string>
    ): Promise<GraderResult>;
}

/**
 * Runs a shell command and scores based on exit code.
 * Supports partial credit: the command can write a float (0.0–1.0) to
 * logs/verifier/reward.txt, or the grader defaults to binary 0/1 based on exit code.
 */
export class DeterministicGrader implements Grader {
    async grade(
        workspace: string,
        provider: EnvironmentProvider,
        config: GraderConfig,
        _taskPath: string,
        _sessionLog: any[],
        env?: Record<string, string>
    ): Promise<GraderResult> {
        const command = config.command || 'bash tests/test.sh';
        const result = await provider.runCommand(workspace, command, env);

        // Check for a reward file with a float score
        const rewardCheck = await provider.runCommand(workspace, 'cat logs/verifier/reward.txt', env);
        let score = result.exitCode === 0 ? 1.0 : 0.0;

        if (rewardCheck.exitCode === 0) {
            const parsed = parseFloat(rewardCheck.stdout.trim());
            if (!isNaN(parsed)) {
                score = Math.max(0, Math.min(1, parsed));  // clamp to 0–1
            }
        }

        return {
            grader_type: 'deterministic',
            score,
            weight: config.weight,
            details: result.stdout.trim() || result.stderr.trim() || (score > 0 ? 'Passed' : 'Failed')
        };
    }
}

/**
 * Uses an LLM to evaluate the agent's session transcript against a rubric.
 * Tries Ollama first (local, no API key), then falls back to Gemini/Anthropic cloud providers.
 */
export class LLMGrader implements Grader {
    async grade(
        _workspace: string,
        _provider: EnvironmentProvider,
        config: GraderConfig,
        taskPath: string,
        sessionLog: any[],
        env?: Record<string, string>
    ): Promise<GraderResult> {
        const rubricPath = path.join(taskPath, config.rubric || 'prompts/quality.md');
        if (!await fs.pathExists(rubricPath)) {
            return {
                grader_type: 'llm_rubric',
                score: 0,
                weight: config.weight,
                details: `Rubric file not found: ${rubricPath}`
            };
        }

        const rubric = await fs.readFile(rubricPath, 'utf-8');

        // Build a comprehensive transcript for the LLM
        const sections: string[] = [];

        // Include the original instruction
        const instructionEntry = sessionLog.find(e => e.type === 'agent_start');
        if (instructionEntry?.instruction) {
            sections.push(`## Task Instruction\n${instructionEntry.instruction}`);
        }

        // Include all commands and their output
        const commandEntries = sessionLog.filter(e => e.type === 'command');
        if (commandEntries.length > 0) {
            const cmds = commandEntries.map(e =>
                `$ ${e.command}\n${e.stdout || ''}${e.stderr ? '\nSTDERR: ' + e.stderr : ''}\n[exit code: ${e.exitCode ?? 'unknown'}]`
            ).join('\n\n');
            sections.push(`## Commands Executed\n${cmds}`);
        }

        // Include agent output
        const agentEntry = sessionLog.find(e => e.type === 'agent_result');
        if (agentEntry?.output) {
            sections.push(`## Agent Output\n${agentEntry.output}`);
        }

        // Include results from any prior graders (e.g., deterministic tests)
        const priorGraders = sessionLog
            .filter(e => e.type === 'grader' && e.grader_result)
            .map(e => e.grader_result!);
        if (priorGraders.length > 0) {
            const results = priorGraders.map(g =>
                `- ${g.grader_type}: score=${g.score.toFixed(2)} — ${g.details}`
            ).join('\n');
            sections.push(`## Prior Grader Results (automated tests)\n${results}`);
        }

        const transcript = sections.join('\n\n');

        const prompt = `You are an evaluation judge. Score the following agent session on a scale from 0.0 to 1.0 based on the rubric below.

IMPORTANT CONTEXT: The agent runs inside a CLI wrapper (e.g., Gemini CLI). The agent's tool calls (file edits, shell commands) appear as text in the "Agent Output" section. This is a real execution trace, not hallucination — the "Commands Executed" section shows the CLI invocation and its captured output. The "Prior Grader Results" section shows objective automated test results that verify the actual filesystem state after the agent ran.

## Rubric
${rubric}

## Session Transcript
${transcript}

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

        // Provider fallback chain: Ollama (local) -> Gemini (cloud) -> Anthropic (cloud)
        const ollamaHost = env?.OLLAMA_HOST || process.env.OLLAMA_HOST || 'http://localhost:11434';
        const model = config.model || 'qwen3:4b';
        const apiKey = env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const anthropicKey = env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

        // 1. Try Ollama first (no API key needed)
        const ollamaStatus = await this.checkOllamaAvailability(ollamaHost, model);

        if (ollamaStatus.available) {
            const ollamaResult = await this.callOllamaWithRetry(prompt, ollamaHost, config);

            if (ollamaResult) {
                return ollamaResult;
            }

            // Unexpected: availability passed but call failed -- fall through to cloud
        }

        if (!ollamaStatus.available) {
            if (!apiKey && !anthropicKey) {
                // Fail fast: no Ollama and no cloud keys
                return {
                    grader_type: 'llm_rubric',
                    score: 0,
                    weight: config.weight,
                    details: `Ollama is ${ollamaStatus.error}. No LLM grading available (Ollama not running, no GEMINI_API_KEY or ANTHROPIC_API_KEY set)`
                };
            }

            // Graceful degradation: warn and fall through to cloud
            console.warn(`[LLMGrader] Ollama unavailable (${ollamaStatus.error}), falling back to cloud provider`);
        }

        // 2. Try Gemini
        if (apiKey) {
            return this.callGemini(prompt, apiKey, config);
        }

        // 3. Try Anthropic
        if (anthropicKey) {
            return this.callAnthropic(prompt, anthropicKey, config);
        }

        return {
            grader_type: 'llm_rubric',
            score: 0,
            weight: config.weight,
            details: 'No LLM grading available (Ollama not running, no GEMINI_API_KEY or ANTHROPIC_API_KEY set)'
        };
    }

    private async checkOllamaAvailability(ollamaHost: string, model: string): Promise<{ available: boolean; error?: string }> {
        // Health check with 5s timeout
        try {
            const healthResponse = await fetch(`${ollamaHost}/`, {
                signal: AbortSignal.timeout(5000),
            });

            if (!healthResponse.ok) {
                return { available: false, error: `Ollama health check failed (HTTP ${healthResponse.status})` };
            }
        } catch {
            return { available: false, error: `Ollama is not running at ${ollamaHost}. Start it with: ollama serve` };
        }

        // Model availability check
        try {
            const tagsResponse = await fetch(`${ollamaHost}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            const tagsData = await tagsResponse.json() as any;
            const models: any[] = tagsData?.models || [];

            const modelFound = models.some((m: any) => {
                const name: string = m.name || '';

                // Exact match or prefix match (e.g., "qwen3:4b" matches "qwen3:4b", "qwen3" matches "qwen3:latest")
                return name === model || name.split(':')[0] === model.split(':')[0] && name === model;
            });

            if (!modelFound) {
                return { available: false, error: `Ollama is running but model "${model}" is not pulled. Run: ollama pull ${model}` };
            }
        } catch {
            return { available: false, error: `Ollama is not running at ${ollamaHost}. Start it with: ollama serve` };
        }

        return { available: true };
    }

    private async callOllama(prompt: string, ollamaHost: string, config: GraderConfig): Promise<GraderResult | null> {
        const model = config.model || 'qwen3:4b';

        try {
            const response = await fetch(`${ollamaHost}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt,
                    stream: false,
                    format: {
                        type: 'object',
                        properties: {
                            score: { type: 'number' },
                            reasoning: { type: 'string' },
                        },
                        required: ['score', 'reasoning'],
                    },
                    options: {
                        temperature: 0,
                        num_predict: 512,
                    },
                }),
                signal: AbortSignal.timeout(300000), // 5 min timeout for generation
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json() as any;
            const text = data?.response || '';

            return this.parseResponse(text, config);
        } catch {
            return null;
        }
    }

    private async callOllamaWithRetry(prompt: string, ollamaHost: string, config: GraderConfig, maxRetries: number = 3): Promise<GraderResult | null> {
        let lastResult: GraderResult | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const result = await this.callOllama(prompt, ollamaHost, config);

            // Connection error: return null immediately, no retry
            if (result === null) {
                return null;
            }

            lastResult = result;

            // Successful parse (score > 0): return immediately
            if (result.score > 0) {
                return result;
            }

            // Parse failure (score=0 with "Failed to parse"): retry unless last attempt
            if (result.details.startsWith('Failed to parse') && attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                continue;
            }

            // Last attempt or score=0 with valid parse: return as-is
            if (attempt === maxRetries) {
                return null;
            }
        }

        return lastResult;
    }

    private async callGemini(prompt: string, apiKey: string, config: GraderConfig): Promise<GraderResult> {
        const model = config.model || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, maxOutputTokens: 256 }
                })
            });

            const data = await response.json() as any;
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return this.parseResponse(text, config);
        } catch (e) {
            return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `Gemini API error: ${e}` };
        }
    }

    private async callAnthropic(prompt: string, apiKey: string, config: GraderConfig): Promise<GraderResult> {
        const model = config.model || 'claude-sonnet-4-20250514';
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 256,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            const data = await response.json() as any;
            const text = data?.content?.[0]?.text || '';
            return this.parseResponse(text, config);
        } catch (e) {
            return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `Anthropic API error: ${e}` };
        }
    }

    private parseResponse(text: string, config: GraderConfig): GraderResult {
        try {
            // Extract JSON from response (may have markdown wrapping)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));
                return {
                    grader_type: 'llm_rubric',
                    score,
                    weight: config.weight,
                    details: parsed.reasoning || 'No reasoning provided'
                };
            }
        } catch (e) {
            // Fall through
        }
        return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `Failed to parse LLM response: ${text}` };
    }
}

/** Resolve a grader implementation by type */
export function getGrader(type: string): Grader {
    switch (type) {
        case 'deterministic': return new DeterministicGrader();
        case 'llm_rubric': return new LLMGrader();
        default: throw new Error(`Unknown grader type: ${type}`);
    }
}
