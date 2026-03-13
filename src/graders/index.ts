import { GraderConfig, GraderResult, EnvironmentProvider } from '../types';
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
    private warnedAboutConfig = false;
    private warmedUp = false;
    // Set by grade() before any provider call, consumed by parseResponse.
    // Maps criterion text → rubric section header (lowercased).
    private criteriaSections: Map<string, string> = new Map();

    private warnOllamaConfig(): void {
        if (this.warnedAboutConfig) {
            return;
        }

        this.warnedAboutConfig = true;

        // Only warn in CI -- optimized env vars improved benchmarks on 4-vCPU CI
        // runners (12s -> 6.3s) but had no effect on local 12-core Snapdragon X Elite.
        if (!process.env.CI) {
            return;
        }

        const warnings: string[] = [];

        if (!process.env.OLLAMA_FLASH_ATTENTION) {
            warnings.push('OLLAMA_FLASH_ATTENTION not set -- flash attention disabled');
        }

        if (!process.env.OLLAMA_KV_CACHE_TYPE) {
            warnings.push('OLLAMA_KV_CACHE_TYPE not set -- using FP16 KV cache (higher RAM usage)');
        }

        if (warnings.length > 0) {
            console.warn(`[LLMGrader] Suboptimal Ollama configuration detected (set env vars before starting "ollama serve"):`);

            for (const w of warnings) {
                console.warn(`  - ${w}`);
            }
        }
    }

    private async warmUp(ollamaHost: string, model: string): Promise<void> {
        if (this.warmedUp) {
            return;
        }

        this.warmedUp = true;
        const numCtx = 2048;
        const start = Date.now();
        console.log(`[LLMGrader] Warming up ${model}...`);

        try {
            await fetch(`${ollamaHost}/api/generate`, {
                method: 'POST',
                body: JSON.stringify({
                    model,
                    prompt: 'hi',
                    stream: false,
                    options: { num_predict: 1, num_ctx: numCtx },
                }),
                signal: AbortSignal.timeout(120_000),
            });
            const elapsed = Date.now() - start;
            console.log(`[LLMGrader] Model warm (${elapsed}ms)`);
        } catch (err: any) {
            const elapsed = Date.now() - start;
            console.warn(`[LLMGrader] Warmup failed after ${elapsed}ms: ${err?.message || err}`);
        }
    }

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

        // Extract criteria from rubric, tracking which section header each belongs to.
        // Section headers (e.g., "## Workflow Compliance (0-0.4)") drive dimension-aware
        // scoring in parseResponse — this is how we classify criteria generically without
        // keyword-matching on criterion text.
        const criteriaLines: string[] = [];
        const criteriaSections: Map<string, string> = new Map();
        let currentSection = '';

        for (const rawLine of rubric.split('\n')) {
            const line = rawLine.trim();
            const sectionMatch = line.match(/^#{1,3}\s+(.+)/);

            if (sectionMatch) {
                currentSection = sectionMatch[1].toLowerCase();
            } else if (line.startsWith('- ')) {
                const criterion = line.replace(/^- /, '');
                criteriaLines.push(criterion);
                criteriaSections.set(criterion, currentSection);
            }
        }

        this.criteriaSections = criteriaSections;

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

        const numberedCriteria = criteriaLines
            .map((c, i) => `${i + 1}. ${c}`)
            .join('\n');

        const prompt = `You are an evaluation judge. Evaluate the agent session below.

STEP 1 — EXTRACT EVIDENCE: List every shell command the agent actually ran (from "Commands Executed" section). Only include commands that appear verbatim. If none, return an empty array.

STEP 2 — CHECK EACH CRITERION: For each numbered criterion below, answer true ONLY if the commands_found evidence directly supports it. Answer false otherwise.

## Criteria to evaluate (answer ALL ${criteriaLines.length}):
${numberedCriteria}

## Session Transcript
${transcript}

Respond with ONLY a JSON object: {"commands_found": ["cmd1", ...], "criteria": [{"criterion": "<exact criterion text>", "met": true/false}, ...], "reasoning": "<brief explanation>"}`;

        // Provider fallback chain: Ollama (local) -> Gemini (cloud) -> Anthropic (cloud)
        const ollamaHost = env?.OLLAMA_HOST || process.env.OLLAMA_HOST || 'http://localhost:11434';
        const model = config.model || 'qwen3:4b';
        const apiKey = env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const anthropicKey = env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

        // 1. Try Ollama first (no API key needed)
        const ollamaStatus = await this.checkOllamaAvailability(ollamaHost, model);

        if (ollamaStatus.available) {
            await this.warmUp(ollamaHost, model);
            this.warnOllamaConfig();
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
                    details: `No LLM grading available (${ollamaStatus.error}, no GEMINI_API_KEY or ANTHROPIC_API_KEY set)`
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

        const reason = ollamaStatus.available
            ? 'Ollama generation failed'
            : (ollamaStatus.error || 'Ollama not available');

        return {
            grader_type: 'llm_rubric',
            score: 0,
            weight: config.weight,
            details: `No LLM grading available (${reason}, no GEMINI_API_KEY or ANTHROPIC_API_KEY set)`
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

                // Exact match, or prefix match when user omits tag (e.g., "qwen3" matches "qwen3:latest")
                return name === model || (name.split(':')[0] === model.split(':')[0] && !model.includes(':'));
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
        // qwen3:4b provides evidence-grounded checklist scoring (Phase 5.1 gap closure).
        // qwen2.5:3b had good binary discrimination but hallucinated partial scores.
        // num_ctx 4096 gives headroom for longer transcripts + evidence extraction.
        // 300s timeout accommodates qwen3:4b on CPU (~5-10 tok/s with 4096 context).
        const OLLAMA_NUM_CTX = 4096;
        const OLLAMA_NUM_PREDICT = 512;
        const OLLAMA_TIMEOUT_MS = 300_000;

        const model = config.model || 'qwen3:4b';

        try {
            const response = await fetch(`${ollamaHost}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt,
                    stream: false,
                    think: false,
                    format: {
                        type: 'object',
                        properties: {
                            commands_found: {
                                type: 'array',
                                items: { type: 'string' },
                            },
                            criteria: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        criterion: { type: 'string' },
                                        met: { type: 'boolean' },
                                    },
                                    required: ['criterion', 'met'],
                                },
                            },
                            reasoning: { type: 'string' },
                        },
                        required: ['commands_found', 'criteria', 'reasoning'],
                    },
                    options: {
                        temperature: 0,
                        num_predict: OLLAMA_NUM_PREDICT,
                        num_ctx: OLLAMA_NUM_CTX,
                    },
                }),
                signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
            });

            if (!response.ok) {
                console.warn(`[LLMGrader] Ollama returned HTTP ${response.status}`);
                return null;
            }

            const data = await response.json() as any;
            // qwen3 models may put structured output in thinking field instead of response
            const text = data?.response || data?.thinking || '';

            return this.parseResponse(text, config);
        } catch (err: any) {
            console.warn(`[LLMGrader] Ollama call failed: ${err?.message || err}`);
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

            // Valid parse (including score=0): return immediately
            if (!result.details.startsWith('Failed to parse')) {
                return result;
            }

            // Parse failure: retry with backoff unless last attempt
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                continue;
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

                // Checklist scoring with dimension-aware weighting.
                // Based on CheckEval (EMNLP 2025, arxiv:2403.18771) and RocketEval
                // (ICLR 2025, arxiv:2503.05142) findings that binary checklist
                // decomposition dramatically improves small-model judge reliability
                // over holistic scoring.
                if (Array.isArray(parsed.criteria) && parsed.criteria.length > 0) {
                    // Classify criteria by rubric section header (set by grade()).
                    // Falls back to keyword matching when section info is unavailable
                    // (e.g., cloud providers calling parseResponse without grade()).
                    const sectionOf = (criterion: string): string => {
                        // Exact match first
                        const exact = this.criteriaSections.get(criterion);

                        if (exact) {
                            return exact;
                        }

                        // Fuzzy match: LLM may paraphrase or truncate criterion text.
                        // Find the rubric criterion whose first 40 chars best overlap.
                        const needle = criterion.toLowerCase().substring(0, 40);

                        for (const [rubricCriterion, section] of this.criteriaSections) {
                            if (rubricCriterion.toLowerCase().substring(0, 40) === needle) {
                                return section;
                            }
                        }

                        return '';
                    };

                    const isWorkflow = (criterion: string) => {
                        const section = sectionOf(criterion);

                        if (section) {
                            return /workflow|compliance|procedure|protocol|pipeline|process.*step|step.*process/i.test(section);
                        }

                        return /workflow|compliance|mandatory|procedure|protocol|pipeline/i.test(criterion);
                    };

                    const isEfficiency = (criterion: string) => {
                        const section = sectionOf(criterion);

                        if (section) {
                            return /efficien|overhead|resource.*usage/i.test(section);
                        }

                        return /efficien|redundan|trial.and.error|reasonable.*command|unnecessary|extraneous|superfluous|wasteful|excess/i.test(criterion);
                    };

                    // Technique A (prerequisite gating): If < 50% of workflow criteria are met,
                    // efficiency criteria are vacuously true — override to false.
                    // Ref: Autorubric (NAACL 2025, arxiv:2603.00077) CANNOT_ASSESS strategy
                    // with SKIP mode, simplified here to a binary gate.
                    const workflowCriteria = parsed.criteria.filter((c: any) => isWorkflow(c.criterion));
                    const workflowMet = workflowCriteria.filter((c: any) => c.met).length;
                    const workflowScore = workflowCriteria.length > 0 ? workflowMet / workflowCriteria.length : 0;

                    if (workflowScore < 0.5) {
                        for (const c of parsed.criteria) {
                            if (isEfficiency(c.criterion) && c.met) {
                                c.met = false;
                            }
                        }
                    }

                    // Technique E (intra-section entailment): If a "summary" criterion
                    // (mentions N-step workflow/process/procedure) is marked true but a
                    // sibling criterion in the SAME rubric section is false, the summary
                    // is logically inconsistent — override to false.
                    // Ref: DeepEval DAG metric (conditional scoring via decision trees);
                    // Autorubric (arxiv:2603.00077) CANNOT_ASSESS for dependent criteria;
                    // Logical consistency survey (arxiv:2410.02205) transitivity dimension.
                    const summaryPattern = /\b\d+-step\b|workflow|process|procedure|pipeline|protocol|sequence|lifecycle/i;

                    for (const c of parsed.criteria) {
                        if (!c.met || !summaryPattern.test(c.criterion)) {
                            continue;
                        }

                        const section = sectionOf(c.criterion);

                        if (!section) {
                            continue;
                        }

                        const siblingFailed = parsed.criteria.some(
                            (s: any) => s !== c
                                && sectionOf(s.criterion) === section
                                && !s.met
                        );

                        if (siblingFailed) {
                            c.met = false;
                        }
                    }

                    // Technique C (weighted scoring): Workflow criteria count 2x,
                    // reflecting rubric dimension weights (Workflow 0-0.4 vs others 0-0.3).
                    // Ref: RocketEval (ICLR 2025, arxiv:2503.05142) confidence-weighted
                    // normalized scoring — adapted from continuous logprob weights to
                    // discrete dimension weights since Ollama structured output doesn't
                    // expose token logprobs.
                    let weightedMet = 0;
                    let weightedTotal = 0;

                    for (const c of parsed.criteria) {
                        const w = isWorkflow(c.criterion) ? 2.0 : 1.0;
                        weightedTotal += w;

                        if (c.met) {
                            weightedMet += w;
                        }
                    }

                    let score = Math.max(0, Math.min(1, weightedTotal > 0 ? weightedMet / weightedTotal : 0));

                    // Technique D (score cap): If the primary workflow criterion is false,
                    // cap score at 0.4 to prevent partial attempts from exceeding midpoint.
                    // Ref: RocketEval (ICLR 2025, arxiv:2503.05142) gate-criterion concept
                    // — their trained predictor learns gate weights; we use a hard cap since
                    // we lack annotated training data for learned reweighting.
                    const workflowSynonyms = /workflow|process|procedure|protocol|pipeline/i;
                    const workflowFollowed = parsed.criteria.find(
                        (c: any) => /mandatory|follow|required|prescribed|correct|proper/i.test(c.criterion)
                            && workflowSynonyms.test(c.criterion)
                    );

                    if (workflowFollowed && !workflowFollowed.met) {
                        score = Math.min(score, 0.4);
                    }

                    const checklist = parsed.criteria
                        .map((c: any) => `${c.met ? '[OK]' : '[  ]'} ${c.criterion}`)
                        .join('; ');

                    return {
                        grader_type: 'llm_rubric',
                        score: Math.round(score * 1000) / 1000,
                        weight: config.weight,
                        details: `${parsed.reasoning || 'No reasoning'} | Checklist: ${checklist}`
                    };
                }

                // Legacy format: direct score field
                if (parsed.score !== undefined) {
                    const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));

                    return {
                        grader_type: 'llm_rubric',
                        score,
                        weight: config.weight,
                        details: parsed.reasoning || 'No reasoning provided'
                    };
                }
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
