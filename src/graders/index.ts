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
 * Requires GEMINI_API_KEY or ANTHROPIC_API_KEY in the environment.
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

        // Build a transcript summary for the LLM
        const transcript = sessionLog
            .filter(e => e.type === 'command' || e.type === 'agent_result')
            .map(e => {
                if (e.type === 'command') return `$ ${e.command}\n${e.stdout || ''}${e.stderr || ''}`;
                return `Agent output: ${e.output || ''}`;
            })
            .join('\n\n');

        const prompt = `You are an evaluation judge. Score the following agent transcript on a scale from 0.0 to 1.0 based on the rubric below.

## Rubric
${rubric}

## Agent Transcript
${transcript}

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;

        // Try Gemini API first, fall back to Anthropic
        const apiKey = env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const anthropicKey = env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

        if (apiKey) {
            return this.callGemini(prompt, apiKey, config);
        } else if (anthropicKey) {
            return this.callAnthropic(prompt, anthropicKey, config);
        }

        return {
            grader_type: 'llm_rubric',
            score: 0,
            weight: config.weight,
            details: 'No API key available for LLM grading (set GEMINI_API_KEY or ANTHROPIC_API_KEY)'
        };
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
