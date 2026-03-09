/**
 * Benchmark script for evaluating grader model candidates via direct Ollama /api/generate calls.
 *
 * This is a standalone script -- it does NOT import from src/graders/index.ts.
 * It calls Ollama directly to measure raw model performance without retry/fallback logic.
 *
 * Usage:
 *   npx ts-node tests/benchmark-grader.ts --profile default [--models phi3.5:3.8b,qwen2.5:3b] [--runs 3] [--output path.json] [--host http://localhost:11434]
 *   npx ts-node tests/benchmark-grader.ts --help
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogEntry {
    type: 'agent_start' | 'command' | 'agent_result' | 'grader' | 'reward';
    timestamp: string;
    instruction?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    output?: string;
    value?: number;
    grader_result?: {
        grader_type: string;
        score: number;
        weight: number;
        details: string;
    };
}

interface OllamaGenerateResponse {
    model: string;
    response: string;
    done: boolean;
    total_duration: number;
    load_duration: number;
    prompt_eval_count: number;
    prompt_eval_duration: number;
    eval_count: number;
    eval_duration: number;
}

interface BenchmarkResult {
    model: string;
    profile: string;
    fixture: string;
    run: number;
    wall_time_ms: number;
    eval_count: number;
    eval_duration_ns: number;
    prompt_eval_count: number;
    prompt_eval_duration_ns: number;
    total_duration_ns: number;
    load_duration_ns: number;
    tokens_per_second: number;
    json_valid: boolean;
    score: number;
    reasoning: string;
    schema_mode: 'json_schema' | 'no_schema';
}

interface ModelInfo {
    family: string;
    parameterSize: string;
    quantization: string;
}

interface CliArgs {
    models: string[];
    profile: string;
    output: string;
    runs: number;
    host: string;
    help: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODELS = [
    'phi3.5:3.8b-mini-instruct-q4_K_M',
    'phi3.5:3.8b-mini-instruct-q5_K_M',
    'phi3.5:3.8b',
    'qwen2.5:3b',
    'llama3.2:3b',
    'gemma3:4b',
    'gemma3:4b-it-qat',
    'qwen2.5:7b',
];

const GRADING_JSON_SCHEMA = {
    type: 'object',
    properties: {
        score: { type: 'number', minimum: 0.0, maximum: 1.0 },
        reasoning: { type: 'string' },
    },
    required: ['score', 'reasoning'],
};

const GENERATE_TIMEOUT_MS = 120_000;

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures', 'benchmark');
const RUBRIC_PATH = path.resolve(__dirname, '..', 'tasks', 'superlint_demo', 'prompts', 'quality.md');

// ---------------------------------------------------------------------------
// CLI Parsing
// ---------------------------------------------------------------------------

function printHelp(): void {
    console.log(`
Benchmark Grader Models via Ollama /api/generate

Usage:
  npx ts-node tests/benchmark-grader.ts --profile <name> [options]

Required:
  --profile <name>    Tuning profile name (e.g., "default", "optimized-env", "optimized-all")

Options:
  --models <list>     Comma-separated model tags (default: all 8 candidates)
  --runs <n>          Number of runs per model per fixture (default: 3)
  --output <path>     Path for JSON results file (default: benchmark-results/<profile>.json)
  --host <url>        Ollama host URL (default: http://localhost:11434)
  --help              Show this help message

Examples:
  npx ts-node tests/benchmark-grader.ts --profile default
  npx ts-node tests/benchmark-grader.ts --profile optimized-all --models phi3.5:3.8b,qwen2.5:3b --runs 5
`.trim());
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        models: [...DEFAULT_MODELS],
        profile: '',
        output: '',
        runs: 3,
        host: 'http://localhost:11434',
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--help':
            case '-h':
                args.help = true;
                break;
            case '--models':
                args.models = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
                break;
            case '--profile':
                args.profile = argv[++i] || '';
                break;
            case '--output':
                args.output = argv[++i] || '';
                break;
            case '--runs':
                args.runs = parseInt(argv[++i] || '3', 10);
                break;
            case '--host':
                args.host = argv[++i] || 'http://localhost:11434';
                break;
        }
    }

    if (!args.output && args.profile) {
        args.output = path.resolve('benchmark-results', `${args.profile}.json`);
    }

    return args;
}

// ---------------------------------------------------------------------------
// Prompt Construction (mirrors LLMGrader.grade() prompt format)
// ---------------------------------------------------------------------------

function buildGradingPrompt(rubric: string, sessionLog: LogEntry[]): string {
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

    // Include results from any prior graders
    const priorGraders = sessionLog
        .filter(e => e.type === 'grader' && e.grader_result)
        .map(e => e.grader_result!);

    if (priorGraders.length > 0) {
        const results = priorGraders.map(g =>
            `- ${g.grader_type}: score=${g.score.toFixed(2)} -- ${g.details}`
        ).join('\n');
        sections.push(`## Prior Grader Results (automated tests)\n${results}`);
    }

    const transcript = sections.join('\n\n');

    return `You are an evaluation judge. Score the following agent session on a scale from 0.0 to 1.0 based on the rubric below.

IMPORTANT CONTEXT: The agent runs inside a CLI wrapper (e.g., Gemini CLI). The agent's tool calls (file edits, shell commands) appear as text in the "Agent Output" section. This is a real execution trace, not hallucination -- the "Commands Executed" section shows the CLI invocation and its captured output. The "Prior Grader Results" section shows objective automated test results that verify the actual filesystem state after the agent ran.

## Rubric
${rubric}

## Session Transcript
${transcript}

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`;
}

// ---------------------------------------------------------------------------
// Ollama API Helpers
// ---------------------------------------------------------------------------

async function ollamaPost(host: string, endpoint: string, body: object, timeoutMs?: number): Promise<any> {
    const url = `${host}${endpoint}`;
    const options: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };

    if (timeoutMs) {
        options.signal = AbortSignal.timeout(timeoutMs);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return response.json();
}

async function checkModelExists(host: string, model: string): Promise<boolean> {
    try {
        await ollamaPost(host, '/api/show', { name: model }, 10_000);
        return true;
    } catch {
        return false;
    }
}

async function pullModel(host: string, model: string): Promise<void> {
    console.log(`[INFO] Pulling model ${model}...`);

    try {
        await ollamaPost(host, '/api/pull', { name: model, stream: false }, 600_000);
        console.log(`[OK] Pulled ${model}`);
    } catch (err: any) {
        console.error(`[ERROR] Failed to pull ${model}: ${err?.message || err}`);
        throw err;
    }
}

async function getModelInfo(host: string, model: string): Promise<ModelInfo> {
    try {
        const data = await ollamaPost(host, '/api/show', { name: model }, 10_000);

        return {
            family: data?.details?.family || 'unknown',
            parameterSize: data?.details?.parameter_size || 'unknown',
            quantization: data?.details?.quantization_level || 'unknown',
        };
    } catch {
        return { family: 'unknown', parameterSize: 'unknown', quantization: 'unknown' };
    }
}

async function warmUpModel(host: string, model: string): Promise<void> {
    console.log(`[INFO] Warming up ${model}...`);

    try {
        await ollamaPost(host, '/api/generate', {
            model,
            prompt: 'Hello',
            stream: false,
            options: { temperature: 0, num_predict: 1, num_gpu: 0 },
        }, GENERATE_TIMEOUT_MS);
        console.log(`[OK] ${model} loaded into memory`);
    } catch (err: any) {
        console.warn(`[WARN] Warm-up failed for ${model}: ${err?.message || err}`);
    }
}

// ---------------------------------------------------------------------------
// Benchmark Core
// ---------------------------------------------------------------------------

function buildGenerateOptions(profile: string): Record<string, number> {
    const opts: Record<string, number> = {
        temperature: 0,
        num_predict: 512,
        num_ctx: 8192,
        num_gpu: 0,
    };

    if (profile === 'optimized-all') {
        const cpuCount = os.cpus().length;
        // Local Snapdragon X Elite has 12 cores; CI has 4
        opts.num_thread = cpuCount >= 8 ? 12 : cpuCount;
        opts.num_batch = 128;
    }

    return opts;
}

async function benchmarkSingleRun(
    host: string,
    model: string,
    profile: string,
    prompt: string,
    fixtureName: string,
    runNumber: number,
): Promise<BenchmarkResult> {
    const options = buildGenerateOptions(profile);

    // Try with JSON Schema first
    let schemaMode: 'json_schema' | 'no_schema' = 'json_schema';
    let data: OllamaGenerateResponse;
    let wallTimeMs: number;

    try {
        const start = Date.now();
        data = await ollamaPost(host, '/api/generate', {
            model,
            prompt,
            stream: false,
            format: GRADING_JSON_SCHEMA,
            options,
        }, GENERATE_TIMEOUT_MS) as OllamaGenerateResponse;
        wallTimeMs = Date.now() - start;
    } catch (err: any) {
        // JSON Schema mode failed, retry without schema
        console.warn(`[WARN] JSON Schema mode failed for ${model} (${fixtureName} run ${runNumber}): ${err?.message || err}`);
        console.log(`[INFO] Retrying ${model} without JSON Schema...`);
        schemaMode = 'no_schema';

        const start = Date.now();
        data = await ollamaPost(host, '/api/generate', {
            model,
            prompt,
            stream: false,
            options,
        }, GENERATE_TIMEOUT_MS) as OllamaGenerateResponse;
        wallTimeMs = Date.now() - start;
    }

    // Parse response
    const responseText = data.response || '';
    let jsonValid = false;
    let score = -1;
    let reasoning = '';

    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const parsedScore = parseFloat(parsed.score);

            if (!isNaN(parsedScore) && parsedScore >= 0.0 && parsedScore <= 1.0 && typeof parsed.reasoning === 'string') {
                jsonValid = true;
                score = parsedScore;
                reasoning = parsed.reasoning;
            }
        }
    } catch {
        // JSON parse failed
    }

    const evalDuration = data.eval_duration || 0;
    const evalCount = data.eval_count || 0;
    const tokensPerSecond = evalDuration > 0 ? evalCount / (evalDuration / 1e9) : 0;

    return {
        model,
        profile,
        fixture: fixtureName,
        run: runNumber,
        wall_time_ms: wallTimeMs,
        eval_count: evalCount,
        eval_duration_ns: evalDuration,
        prompt_eval_count: data.prompt_eval_count || 0,
        prompt_eval_duration_ns: data.prompt_eval_duration || 0,
        total_duration_ns: data.total_duration || 0,
        load_duration_ns: data.load_duration || 0,
        tokens_per_second: Math.round(tokensPerSecond * 100) / 100,
        json_valid: jsonValid,
        score,
        reasoning: reasoning.substring(0, 100),
        schema_mode: schemaMode,
    };
}

// ---------------------------------------------------------------------------
// Results Reporting
// ---------------------------------------------------------------------------

function median(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return sorted[mid];
}

interface SummaryRow {
    model: string;
    quant: string;
    fixture: string;
    medianWallMs: number;
    medianTokS: number;
    jsonOkRate: string;
    medianScore: number;
    schemaMode: string;
}

function buildSummaryRows(results: BenchmarkResult[], modelInfoMap: Map<string, ModelInfo>): SummaryRow[] {
    // Group by model + fixture
    const groups = new Map<string, BenchmarkResult[]>();

    for (const r of results) {
        const key = `${r.model}|${r.fixture}`;
        const arr = groups.get(key) || [];
        arr.push(r);
        groups.set(key, arr);
    }

    const rows: SummaryRow[] = [];

    for (const [key, group] of groups.entries()) {
        const [model, fixture] = key.split('|');
        const info = modelInfoMap.get(model) || { family: 'unknown', parameterSize: 'unknown', quantization: 'unknown' };

        const wallTimes = group.map(r => r.wall_time_ms);
        const tokS = group.map(r => r.tokens_per_second);
        const scores = group.map(r => r.score);
        const jsonOk = group.filter(r => r.json_valid).length;
        const schemaModes = [...new Set(group.map(r => r.schema_mode))];

        rows.push({
            model,
            quant: info.quantization,
            fixture,
            medianWallMs: Math.round(median(wallTimes)),
            medianTokS: Math.round(median(tokS) * 100) / 100,
            jsonOkRate: `${jsonOk}/${group.length}`,
            medianScore: Math.round(median(scores) * 1000) / 1000,
            schemaMode: schemaModes.join(','),
        });
    }

    return rows;
}

function printResultsTable(rows: SummaryRow[]): void {
    console.log('');
    console.log('='.repeat(130));
    console.log('BENCHMARK RESULTS');
    console.log('='.repeat(130));

    // Header
    const header = [
        'Model'.padEnd(38),
        'Quant'.padEnd(10),
        'Fixture'.padEnd(10),
        'Med Wall(ms)'.padEnd(14),
        'Med tok/s'.padEnd(12),
        'JSON OK'.padEnd(10),
        'Med Score'.padEnd(12),
        'Schema Mode'.padEnd(14),
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(130));

    for (const row of rows) {
        const line = [
            row.model.padEnd(38),
            row.quant.padEnd(10),
            row.fixture.padEnd(10),
            String(row.medianWallMs).padEnd(14),
            String(row.medianTokS).padEnd(12),
            row.jsonOkRate.padEnd(10),
            String(row.medianScore).padEnd(12),
            row.schemaMode.padEnd(14),
        ].join(' | ');
        console.log(line);
    }

    console.log('='.repeat(130));
}

interface ModelPassFail {
    model: string;
    passed: boolean;
    reasons: string[];
}

function evaluatePassFail(results: BenchmarkResult[]): ModelPassFail[] {
    // Group by model
    const modelGroups = new Map<string, BenchmarkResult[]>();

    for (const r of results) {
        const arr = modelGroups.get(r.model) || [];
        arr.push(r);
        modelGroups.set(r.model, arr);
    }

    const evaluations: ModelPassFail[] = [];

    for (const [model, group] of modelGroups.entries()) {
        const reasons: string[] = [];

        // Criterion 1: 100% JSON parse success
        const jsonFailures = group.filter(r => !r.json_valid);

        if (jsonFailures.length > 0) {
            reasons.push(`JSON parse failed for ${jsonFailures.length}/${group.length} runs`);
        }

        // Criterion 2: wall time <= 60s for all runs
        const slowRuns = group.filter(r => r.wall_time_ms > 60_000);

        if (slowRuns.length > 0) {
            reasons.push(`${slowRuns.length} runs exceeded 60s wall time`);
        }

        // Criterion 3: score > 0.0 for positive fixture
        const positiveRuns = group.filter(r => r.fixture === 'positive');
        const zeroScorePositive = positiveRuns.filter(r => r.score <= 0.0);

        if (zeroScorePositive.length > 0) {
            reasons.push(`${zeroScorePositive.length} positive fixture runs scored <= 0.0`);
        }

        evaluations.push({
            model,
            passed: reasons.length === 0,
            reasons,
        });
    }

    return evaluations;
}

function printPassFail(evaluations: ModelPassFail[]): void {
    console.log('');
    console.log('MODEL PASS/FAIL SUMMARY');
    console.log('-'.repeat(80));

    for (const ev of evaluations) {
        const status = ev.passed ? 'PASS' : 'FAIL';
        console.log(`  ${status}  ${ev.model}`);

        if (!ev.passed) {
            for (const reason of ev.reasons) {
                console.log(`        - ${reason}`);
            }
        }
    }

    console.log('-'.repeat(80));

    const passCount = evaluations.filter(e => e.passed).length;
    console.log(`${passCount}/${evaluations.length} models passed all criteria`);
    console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    if (!args.profile) {
        console.error('[ERROR] --profile is required. Use --help for usage.');
        process.exit(1);
    }

    console.log(`[INFO] Benchmark configuration:`);
    console.log(`[INFO]   Profile: ${args.profile}`);
    console.log(`[INFO]   Models: ${args.models.join(', ')}`);
    console.log(`[INFO]   Runs per model per fixture: ${args.runs}`);
    console.log(`[INFO]   Host: ${args.host}`);
    console.log(`[INFO]   Output: ${args.output}`);
    console.log(`[INFO]   CPU cores: ${os.cpus().length}`);
    console.log('');

    // Step 1: Load fixtures
    console.log('[INFO] Loading fixtures...');
    const fixtureFiles: { name: string; data: LogEntry[] }[] = [
        { name: 'positive', data: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'session-positive.json'), 'utf-8')) },
        { name: 'empty', data: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'session-empty.json'), 'utf-8')) },
        { name: 'wrong', data: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'session-wrong.json'), 'utf-8')) },
    ];
    console.log(`[OK] Loaded ${fixtureFiles.length} fixtures`);

    // Step 2: Load rubric
    console.log('[INFO] Loading rubric...');
    const rubric = fs.readFileSync(RUBRIC_PATH, 'utf-8');
    console.log('[OK] Rubric loaded');

    // Step 3: Build prompts for each fixture
    const fixturePrompts = fixtureFiles.map(f => ({
        name: f.name,
        prompt: buildGradingPrompt(rubric, f.data),
    }));

    // Step 4: Pull models (skip if already present)
    console.log('');
    console.log('[INFO] Checking and pulling models...');

    for (const model of args.models) {
        const exists = await checkModelExists(args.host, model);

        if (exists) {
            console.log(`[OK] ${model} already available`);
        } else {
            await pullModel(args.host, model);
        }
    }

    // Step 5: Benchmark each model
    const allResults: BenchmarkResult[] = [];
    const modelInfoMap = new Map<string, ModelInfo>();

    console.log('');
    console.log('[INFO] Starting benchmarks...');
    console.log('');

    for (const model of args.models) {
        console.log(`${'='.repeat(80)}`);
        console.log(`[INFO] Benchmarking: ${model}`);

        // Warm-up
        await warmUpModel(args.host, model);

        // Get model info
        const info = await getModelInfo(args.host, model);
        modelInfoMap.set(model, info);
        console.log(`[INFO]   Family: ${info.family}, Params: ${info.parameterSize}, Quant: ${info.quantization}`);

        // Benchmark each fixture
        for (const fp of fixturePrompts) {
            console.log(`[INFO]   Fixture: ${fp.name}`);

            for (let run = 1; run <= args.runs; run++) {
                try {
                    const result = await benchmarkSingleRun(
                        args.host, model, args.profile, fp.prompt, fp.name, run,
                    );
                    allResults.push(result);
                    console.log(
                        `[INFO]     Run ${run}: ${result.wall_time_ms}ms, ` +
                        `${result.tokens_per_second} tok/s, ` +
                        `JSON=${result.json_valid}, ` +
                        `score=${result.score}, ` +
                        `mode=${result.schema_mode}`
                    );
                } catch (err: any) {
                    console.error(`[ERROR]     Run ${run} failed: ${err?.message || err}`);
                }
            }
        }

        console.log('');
    }

    // Step 6: Print results table
    const summaryRows = buildSummaryRows(allResults, modelInfoMap);
    printResultsTable(summaryRows);

    // Step 7: Print pass/fail
    const evaluations = evaluatePassFail(allResults);
    printPassFail(evaluations);

    // Step 8: Write JSON output
    const outputDir = path.dirname(args.output);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputData = {
        profile: args.profile,
        timestamp: new Date().toISOString(),
        cpu_count: os.cpus().length,
        cpu_model: os.cpus()[0]?.model || 'unknown',
        platform: os.platform(),
        arch: os.arch(),
        models: args.models,
        runs_per_fixture: args.runs,
        results: allResults,
        summary: summaryRows,
        evaluations,
    };

    fs.writeFileSync(args.output, JSON.stringify(outputData, null, 2));
    console.log(`[OK] Results written to ${args.output}`);

    // Step 9: Exit code
    const anyPassed = evaluations.some(e => e.passed);

    if (anyPassed) {
        console.log('[OK] At least one model passed all criteria');
        process.exit(0);
    } else {
        console.error('[ERROR] No models passed all criteria');
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`[ERROR] Benchmark failed: ${err?.message || err}`);
    process.exit(1);
});
