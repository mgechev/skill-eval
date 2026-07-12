import { GraderConfig, GraderResult, EnvironmentProvider } from '../types';
import * as fs from 'fs-extra';
import * as path from 'path';
import { resolveGeminiModel, resolveAnthropicModel, resolveOpenAIModel } from '../utils/models';

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
 * Runs a command and parses structured JSON from stdout.
 *
 * The grader script MUST output JSON to stdout:
 *   { "score": 0.0-1.0, "details": "...", "checks": [...] }
 *
 * - score: float between 0.0 and 1.0
 * - details: human-readable summary
 * - checks: optional array of { name, passed, message } for per-check breakdown
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

        // Parse JSON from stdout
        const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {
                grader_type: 'deterministic',
                score: 0,
                weight: config.weight,
                details: `Grader did not output JSON. stdout: ${result.stdout.trim() || '(empty)'} stderr: ${result.stderr.trim() || '(empty)'}`
            };
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]);
            const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));
            const details = parsed.details || `score=${score.toFixed(2)}`;
            const checks = parsed.checks || [];

            // Build rich details string with per-check breakdown
            const checkLines = checks.map((c: any) =>
                `  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.message || ''}`
            );
            const fullDetails = checkLines.length > 0
                ? `${details}\n${checkLines.join('\n')}`
                : details;

            return {
                grader_type: 'deterministic',
                score,
                weight: config.weight,
                details: fullDetails
            };
        } catch (e) {
            return {
                grader_type: 'deterministic',
                score: 0,
                weight: config.weight,
                details: `Failed to parse grader JSON: ${jsonMatch[0].substring(0, 200)}`
            };
        }
    }
}

/**
 * Uses an LLM to evaluate the agent's session transcript against a rubric.
 *
 * Supported providers (selected via `config.provider`, defaults to "gemini"):
 *   - gemini      → Google Gemini (GEMINI_API_KEY)
 *   - anthropic   → Anthropic Claude or compatible (ANTHROPIC_API_KEY; optional ANTHROPIC_BASE_URL)
 *   - openai      → OpenAI or compatible (OPENAI_API_KEY; optional OPENAI_BASE_URL for Ollama, vLLM, etc.)
 *
 * Each provider method resolves its own API key, makes the HTTP call, and
 * handles errors — returning a zero-score GraderResult on any failure.
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

        const providerName = config.provider || 'gemini';
        let model = config.model;
        if (!model) {
            try {
                if (providerName === 'gemini') {
                    model = await resolveGeminiModel(env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY, env, 'grader');
                } else if (providerName === 'anthropic') {
                    model = await resolveAnthropicModel(env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY, env, 'grader');
                } else if (providerName === 'openai') {
                    model = await resolveOpenAIModel(env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY, env, 'grader');
                } else {
                    throw new Error(`Unknown grader provider: "${providerName}". Supported: gemini, anthropic, openai`);
                }
            } catch (err: any) {
                return {
                    grader_type: 'llm_rubric',
                    score: 0,
                    weight: config.weight,
                    details: err.message || String(err),
                };
            }
        }

        switch (providerName) {
            case "gemini":
                return this.callGemini(prompt, model, config, env);
            case "anthropic":
                return this.callAnthropic(prompt, model, config, env);
            case "openai":
                return this.callOpenAI(prompt, model, config, env);
            default:
                return {
                    grader_type: 'llm_rubric',
                    score: 0,
                    weight: config.weight,
                    details: `Unknown grader provider: "${providerName}". Supported: gemini, anthropic, openai`,
                };
        }
    }

    private async callGemini(prompt: string, model: string, config: GraderConfig, env?: Record<string, string>): Promise<GraderResult> {
        const apiKey = env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return {
                grader_type: 'llm_rubric',
                score: 0,
                weight: config.weight,
                details: 'Missing GEMINI_API_KEY. Set the GEMINI_API_KEY environment variable to use the "gemini" grader provider.'
            };
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0 }
                })
            });

            const data = await response.json() as any;
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return this.parseResponse(text, config);
        } catch (e) {
            return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `Gemini API error: ${e}` };
        }
    }

    private async callAnthropic(prompt: string, model: string, config: GraderConfig, env?: Record<string, string>): Promise<GraderResult> {
        const apiKey = env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return {
                grader_type: 'llm_rubric',
                score: 0,
                weight: config.weight,
                details: 'Missing ANTHROPIC_API_KEY. Set the ANTHROPIC_API_KEY environment variable to use the "anthropic" grader provider.'
            };
        }
        const baseUrl = (env?.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
        const url = `${baseUrl}/messages`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 4096,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            const data = await response.json() as any;
            // Adaptive thinking is on by default on current Claude models, so the first
            // content block may be a thinking block — select the text block explicitly.
            const text = data?.content?.find((b: any) => b.type === 'text')?.text || '';
            return this.parseResponse(text, config);
        } catch (e) {
            return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `Anthropic API error: ${e}` };
        }
    }

    private async callOpenAI(prompt: string, model: string, config: GraderConfig, env?: Record<string, string>): Promise<GraderResult> {
        const apiKey = env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return {
                grader_type: 'llm_rubric',
                score: 0,
                weight: config.weight,
                details: 'Missing OPENAI_API_KEY. Set the OPENAI_API_KEY environment variable to use the "openai" grader provider.'
            };
        }
        const baseUrl = (env?.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const url = `${baseUrl}/chat/completions`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    temperature: 0,
                    max_tokens: 4096,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });

            const data = await response.json() as any;
            const msg = data?.choices?.[0]?.message;
            const text = msg?.content || msg?.reasoning_content || '';
            const result = this.parseResponse(text, config);
            if (result.score === 0 && result.details.startsWith('Failed to parse')) {
                result.details = `Failed to parse LLM response: ${JSON.stringify(data).substring(0, 500)}`;
            }
            return result;
        } catch (e) {
            return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `OpenAI API error: ${e}` };
        }
    }

    private parseResponse(text: string, config: GraderConfig): GraderResult {
        // Strip markdown code fences if present
        let cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();

        // Try to extract and parse JSON
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));
                return {
                    grader_type: 'llm_rubric',
                    score,
                    weight: config.weight,
                    details: parsed.reasoning || 'No reasoning provided'
                };
            } catch (e) {
                // JSON parse failed, likely truncated or malformed - try to extract score anyway
                const scoreMatch = jsonMatch[0].match(/"score"\s*:\s*([\d.]+)/);
                if (scoreMatch) {
                    const score = Math.max(0, Math.min(1, parseFloat(scoreMatch[1]) || 0));
                    // Try to extract partial reasoning if available
                    const reasoningMatch = jsonMatch[0].match(/"reasoning"\s*:\s*"([^"]*)/);
                    const reasoning = reasoningMatch
                        ? reasoningMatch[1] + '... (response truncated)'
                        : 'Score extracted from incomplete LLM response';
                    return {
                        grader_type: 'llm_rubric',
                        score,
                        weight: config.weight,
                        details: reasoning
                    };
                }
            }
        }

        // No JSON found at all - try to extract score from plain text
        const scoreMatch = text.match(/"score"\s*:\s*([\d.]+)|score[:\s]+(\d+\.?\d*)/i);
        if (scoreMatch) {
            const score = Math.max(0, Math.min(1, parseFloat(scoreMatch[1] || scoreMatch[2]) || 0));
            return {
                grader_type: 'llm_rubric',
                score,
                weight: config.weight,
                details: 'Score extracted from malformed LLM response'
            };
        }

        return { grader_type: 'llm_rubric', score: 0, weight: config.weight, details: `Failed to parse LLM response: ${text.substring(0, 200)}` };
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
