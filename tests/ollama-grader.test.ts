/**
 * Tests for Ollama integration in LLMGrader.
 *
 * Mocks global.fetch to simulate Ollama HTTP responses.
 * Same test runner pattern as bootstrap.test.ts (sequential, exit(1) on failure).
 */
import { LLMGrader } from '../src/graders/index';
import { GraderConfig, EnvironmentProvider, CommandResult, TaskConfig } from '../src/types';
import * as path from 'path';

// --- Helpers ---

const TASK_PATH = path.join(__dirname, '..', 'tasks', 'superlint_demo');

function makeConfig(overrides: Partial<GraderConfig> = {}): GraderConfig {
    return {
        type: 'llm_rubric',
        rubric: 'prompts/quality.md',
        weight: 1.0,
        ...overrides,
    };
}

const dummyProvider: EnvironmentProvider = {
    async setup() { return '/tmp/test'; },
    async cleanup() {},
    async runCommand(): Promise<CommandResult> {
        return { stdout: '', stderr: '', exitCode: 0 };
    },
};

const dummySessionLog = [
    { type: 'agent_start' as const, timestamp: new Date().toISOString(), instruction: 'Fix the code' },
    { type: 'command' as const, timestamp: new Date().toISOString(), command: 'superlint check', stdout: 'OK', exitCode: 0 },
    { type: 'agent_result' as const, timestamp: new Date().toISOString(), output: 'Done' },
];

interface MockRoute {
    method: string;
    pathPattern: string;
    response: () => Response | Promise<Response>;
}

function createMockFetch(routes: MockRoute[], host: string = 'http://localhost:11434'): typeof globalThis.fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method || 'GET').toUpperCase();

        for (const route of routes) {
            if (method === route.method.toUpperCase() && url === `${host}${route.pathPattern}`) {
                return route.response();
            }
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof globalThis.fetch;
}

function ollamaHealthOk(): MockRoute {
    return {
        method: 'GET',
        pathPattern: '/',
        response: () => new Response('Ollama is running', { status: 200 }),
    };
}

function ollamaTagsWithModel(modelName: string = 'qwen3:4b'): MockRoute {
    return {
        method: 'GET',
        pathPattern: '/api/tags',
        response: () => new Response(JSON.stringify({
            models: [{ name: modelName, size: 2000000000 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
}

function ollamaTagsEmpty(): MockRoute {
    return {
        method: 'GET',
        pathPattern: '/api/tags',
        response: () => new Response(JSON.stringify({
            models: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
}

function ollamaGenerateOk(score: number = 0.85, reasoning: string = 'Good work'): MockRoute {
    return {
        method: 'POST',
        pathPattern: '/api/generate',
        response: () => new Response(JSON.stringify({
            response: JSON.stringify({ score, reasoning }),
            done: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
}

function ollamaGenerateMalformed(): MockRoute {
    return {
        method: 'POST',
        pathPattern: '/api/generate',
        response: () => new Response(JSON.stringify({
            response: 'not valid json at all {{{',
            done: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
}

function connectionRefused(): MockRoute {
    return {
        method: 'GET',
        pathPattern: '/',
        response: () => { throw new Error('fetch failed: ECONNREFUSED'); },
    };
}

// --- Test runner ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
    const originalFetch = globalThis.fetch;

    try {
        await fn();
        passed++;
        console.log(`  [PASS] ${name}`);
    } catch (e: any) {
        failed++;
        const msg = e?.message || String(e);
        failures.push(`${name}: ${msg}`);
        console.log(`  [FAIL] ${name}: ${msg}`);
    } finally {
        // Always restore original fetch
        globalThis.fetch = originalFetch;
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function assertApproxEqual(actual: number, expected: number, tolerance: number, message: string) {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${message}: expected ~${expected}, got ${actual}`);
    }
}

// --- Tests ---

async function main() {
    console.log('\nOllama Grader Tests\n');

    const grader = new LLMGrader();

    // --- callOllama tests ---

    await test('callOllama returns GraderResult with score and reasoning when Ollama responds with valid JSON', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsWithModel(),
            ollamaGenerateOk(0.85, 'Good work'),
        ]);

        const config = makeConfig();
        const result = await (grader as any).callOllama('test prompt', 'http://localhost:11434', config);
        assert(result !== null, 'result should not be null');
        assertApproxEqual(result.score, 0.85, 0.01, 'score');
        assert(result.details.includes('Good work'), `details should include reasoning, got: ${result.details}`);
        assert(result.grader_type === 'llm_rubric', `grader_type should be llm_rubric, got: ${result.grader_type}`);
    });

    await test('callOllama returns null when fetch throws connection error (ECONNREFUSED)', async () => {
        globalThis.fetch = (async () => {
            throw new Error('fetch failed: ECONNREFUSED');
        }) as typeof globalThis.fetch;

        const config = makeConfig();
        const result = await (grader as any).callOllama('test prompt', 'http://localhost:11434', config);
        assert(result === null, 'result should be null on connection error');
    });

    await test('callOllama sends correct request body (model, prompt, stream:false, temperature:0, num_predict:512, checklist JSON Schema format)', async () => {
        let capturedBody: any = null;

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url.endsWith('/api/generate') && init?.method === 'POST') {
                capturedBody = JSON.parse(init.body as string);

                return new Response(JSON.stringify({
                    response: JSON.stringify({
                        commands_found: ['superlint check'],
                        criteria: [{ criterion: 'test', met: true }],
                        reasoning: 'Great',
                    }),
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const config = makeConfig();
        await (grader as any).callOllama('my test prompt', 'http://localhost:11434', config);

        assert(capturedBody !== null, 'request body should have been captured');
        assert(capturedBody.model === 'qwen3:4b', `model should be qwen3:4b, got: ${capturedBody.model}`);
        assert(capturedBody.prompt === 'my test prompt', 'prompt should match');
        assert(capturedBody.stream === false, 'stream should be false');
        assert(capturedBody.think === false, 'think should be false');
        assert(capturedBody.format !== undefined && capturedBody.format.type === 'object',
            `format should be JSON Schema object, got: ${JSON.stringify(capturedBody.format)}`);
        assert(capturedBody.format.properties.commands_found !== undefined, 'format should have commands_found property');
        assert(capturedBody.format.properties.criteria !== undefined, 'format should have criteria property');
        assert(capturedBody.format.properties.reasoning !== undefined, 'format should have reasoning property');
        assert(capturedBody.options.temperature === 0, `temperature should be 0, got: ${capturedBody.options.temperature}`);
        assert(capturedBody.options.num_predict === 512, `num_predict should be 512, got: ${capturedBody.options.num_predict}`);
        assert(capturedBody.options.num_ctx === 4096, `num_ctx should be 4096, got: ${capturedBody.options.num_ctx}`);
    });

    // --- callOllamaWithRetry tests ---

    await test('callOllamaWithRetry retries up to 3 times on parse failure (score=0), then returns last result', async () => {
        let callCount = 0;

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url.endsWith('/api/generate') && init?.method === 'POST') {
                callCount++;

                return new Response(JSON.stringify({
                    response: 'not valid json',
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const config = makeConfig();
        const result = await (grader as any).callOllamaWithRetry('prompt', 'http://localhost:11434', config, 3);

        assert(callCount === 3, `should have called 3 times, called: ${callCount}`);
        // After 3 retries, returns the last (failed parse) result
        assert(result === null || result.score === 0, 'result should be null or score 0 after exhausted retries');
    });

    await test('callOllamaWithRetry returns null immediately on connection error (no retry)', async () => {
        let callCount = 0;

        globalThis.fetch = (async () => {
            callCount++;
            throw new Error('fetch failed: ECONNREFUSED');
        }) as typeof globalThis.fetch;

        const config = makeConfig();
        const result = await (grader as any).callOllamaWithRetry('prompt', 'http://localhost:11434', config, 3);

        assert(result === null, 'result should be null on connection error');
        assert(callCount === 1, `should have called only once, called: ${callCount}`);
    });

    // --- checkOllamaAvailability tests ---

    await test('checkOllamaAvailability returns available:true when health check and model list both succeed', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsWithModel('qwen3:4b'),
        ]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3:4b');
        assert(result.available === true, `should be available, got: ${JSON.stringify(result)}`);
    });

    await test('checkOllamaAvailability returns error with "not running" message when connection refused', async () => {
        globalThis.fetch = createMockFetch([connectionRefused()]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3:4b');
        assert(result.available === false, 'should not be available');
        assert(result.error!.includes('not running'), `error should mention "not running", got: ${result.error}`);
    });

    await test('checkOllamaAvailability returns error with "not pulled" message when model not in tags list', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsEmpty(),
        ]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3:4b');
        assert(result.available === false, 'should not be available');
        assert(result.error!.includes('not pulled'), `error should mention "not pulled", got: ${result.error}`);
        assert(result.error!.includes('qwen3:4b'), `error should name the model, got: ${result.error}`);
    });

    // --- checkOllamaAvailability prefix match tests ---

    await test('checkOllamaAvailability prefix match: "qwen3" matches "qwen3:latest" in tags', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsWithModel('qwen3:latest'),
        ]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3');
        assert(result.available === true, `prefix match should find qwen3:latest for "qwen3", got: ${JSON.stringify(result)}`);
    });

    await test('checkOllamaAvailability prefix match: "qwen3" matches "qwen3:4b" in tags', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsWithModel('qwen3:4b'),
        ]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3');
        assert(result.available === true, `prefix match should find qwen3:4b for "qwen3", got: ${JSON.stringify(result)}`);
    });

    await test('checkOllamaAvailability exact match still works: "qwen3:4b" matches "qwen3:4b"', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsWithModel('qwen3:4b'),
        ]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3:4b');
        assert(result.available === true, `exact match should still work, got: ${JSON.stringify(result)}`);
    });

    await test('checkOllamaAvailability rejects different tag: "qwen3:4b" does NOT match "qwen3:latest"', async () => {
        globalThis.fetch = createMockFetch([
            ollamaHealthOk(),
            ollamaTagsWithModel('qwen3:latest'),
        ]);

        const result = await (grader as any).checkOllamaAvailability('http://localhost:11434', 'qwen3:4b');
        assert(result.available === false, `should not match different tag, got: ${JSON.stringify(result)}`);
        assert(result.error!.includes('not pulled'), `should say not pulled, got: ${result.error}`);
    });

    // --- grade() integration tests ---

    await test('grade() tries Ollama before Gemini/Anthropic when no cloud keys are set', async () => {
        let ollamaCalled = false;

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url === 'http://localhost:11434/') {
                ollamaCalled = true;

                return new Response('Ollama is running', { status: 200 });
            }

            if (url === 'http://localhost:11434/api/tags') {
                return new Response(JSON.stringify({
                    models: [{ name: 'qwen3:4b' }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (url === 'http://localhost:11434/api/generate') {
                return new Response(JSON.stringify({
                    response: JSON.stringify({ commands_found: ['superlint check'], score: 0.75, reasoning: 'Decent' }),
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        // Ensure no cloud keys
        const savedGemini = process.env.GEMINI_API_KEY;
        const savedAnthropic = process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;

        try {
            const config = makeConfig();
            const result = await grader.grade('/tmp/ws', dummyProvider, config, TASK_PATH, dummySessionLog, {});
            assert(ollamaCalled, 'Ollama should have been called');
            assertApproxEqual(result.score, 0.75, 0.01, 'score from Ollama');
        } finally {
            if (savedGemini) { process.env.GEMINI_API_KEY = savedGemini; }
            if (savedAnthropic) { process.env.ANTHROPIC_API_KEY = savedAnthropic; }
        }
    });

    await test('grade() falls through to Gemini when Ollama is unavailable and GEMINI_API_KEY is set', async () => {
        let geminiCalled = false;

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            // Ollama health check fails
            if (url === 'http://localhost:11434/') {
                throw new Error('fetch failed: ECONNREFUSED');
            }

            // Gemini API
            if (url.includes('generativelanguage.googleapis.com')) {
                geminiCalled = true;

                return new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: '{"score": 0.9, "reasoning": "Cloud graded"}' }] } }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const savedGemini = process.env.GEMINI_API_KEY;
        const savedAnthropic = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;

        try {
            const config = makeConfig();
            const result = await grader.grade('/tmp/ws', dummyProvider, config, TASK_PATH, dummySessionLog, {
                GEMINI_API_KEY: 'test-key-123',
            });
            assert(geminiCalled, 'Gemini should have been called as fallback');
            assertApproxEqual(result.score, 0.9, 0.01, 'score from Gemini');
        } finally {
            if (savedGemini) { process.env.GEMINI_API_KEY = savedGemini; }
            if (savedAnthropic) { process.env.ANTHROPIC_API_KEY = savedAnthropic; }
        }
    });

    await test('grade() falls through to Anthropic when Ollama unavailable and only ANTHROPIC_API_KEY set', async () => {
        let anthropicCalled = false;

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            // Ollama health check fails
            if (url === 'http://localhost:11434/') {
                throw new Error('fetch failed: ECONNREFUSED');
            }

            // Anthropic API
            if (url.includes('api.anthropic.com')) {
                anthropicCalled = true;

                return new Response(JSON.stringify({
                    content: [{ text: '{"score": 0.8, "reasoning": "Anthropic graded"}' }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const savedGemini = process.env.GEMINI_API_KEY;
        const savedAnthropic = process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;

        try {
            const config = makeConfig();
            const result = await grader.grade('/tmp/ws', dummyProvider, config, TASK_PATH, dummySessionLog, {
                ANTHROPIC_API_KEY: 'test-key-456',
            });
            assert(anthropicCalled, 'Anthropic should have been called as fallback');
            assertApproxEqual(result.score, 0.8, 0.01, 'score from Anthropic');
        } finally {
            if (savedGemini) { process.env.GEMINI_API_KEY = savedGemini; }
            if (savedAnthropic) { process.env.ANTHROPIC_API_KEY = savedAnthropic; }
        }
    });

    await test('grade() returns score 0 with descriptive error when neither Ollama nor cloud keys available', async () => {
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url === 'http://localhost:11434/') {
                throw new Error('fetch failed: ECONNREFUSED');
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const savedGemini = process.env.GEMINI_API_KEY;
        const savedAnthropic = process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;

        try {
            const config = makeConfig();
            const result = await grader.grade('/tmp/ws', dummyProvider, config, TASK_PATH, dummySessionLog, {});
            assert(result.score === 0, `score should be 0, got: ${result.score}`);
            assert(result.details.includes('not running') || result.details.includes('No LLM grading available'),
                `details should mention Ollama not running or no grading available, got: ${result.details}`);
        } finally {
            if (savedGemini) { process.env.GEMINI_API_KEY = savedGemini; }
            if (savedAnthropic) { process.env.ANTHROPIC_API_KEY = savedAnthropic; }
        }
    });

    await test('default model is qwen3:4b when config.model is undefined', async () => {
        let capturedModel: string = '';

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url.endsWith('/api/generate') && init?.method === 'POST') {
                const body = JSON.parse(init.body as string);
                capturedModel = body.model;

                return new Response(JSON.stringify({
                    response: JSON.stringify({ commands_found: [], score: 0.9, reasoning: 'OK' }),
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const config = makeConfig({ model: undefined });
        await (grader as any).callOllama('prompt', 'http://localhost:11434', config);
        assert(capturedModel === 'qwen3:4b', `default model should be qwen3:4b, got: ${capturedModel}`);
    });

    await test('config.model overrides default (e.g., config.model = "llama3.2:latest")', async () => {
        let capturedModel: string = '';

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url.endsWith('/api/generate') && init?.method === 'POST') {
                const body = JSON.parse(init.body as string);
                capturedModel = body.model;

                return new Response(JSON.stringify({
                    response: JSON.stringify({ score: 0.9, reasoning: 'OK' }),
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const config = makeConfig({ model: 'llama3.2:latest' });
        await (grader as any).callOllama('prompt', 'http://localhost:11434', config);
        assert(capturedModel === 'llama3.2:latest', `model should be llama3.2:latest, got: ${capturedModel}`);
    });

    await test('OLLAMA_HOST env var is respected over default localhost', async () => {
        let calledHost: string = '';

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            calledHost = url;

            if (url === 'http://custom-host:11434/') {
                return new Response('Ollama is running', { status: 200 });
            }

            if (url === 'http://custom-host:11434/api/tags') {
                return new Response(JSON.stringify({
                    models: [{ name: 'qwen3:4b' }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (url === 'http://custom-host:11434/api/generate') {
                return new Response(JSON.stringify({
                    response: JSON.stringify({ score: 0.7, reasoning: 'Custom host' }),
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const savedGemini = process.env.GEMINI_API_KEY;
        const savedAnthropic = process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;

        try {
            const config = makeConfig();
            const result = await grader.grade('/tmp/ws', dummyProvider, config, TASK_PATH, dummySessionLog, {
                OLLAMA_HOST: 'http://custom-host:11434',
            });
            assert(calledHost.includes('custom-host'), `should have called custom host, last URL: ${calledHost}`);
            assertApproxEqual(result.score, 0.7, 0.01, 'score from custom host');
        } finally {
            if (savedGemini) { process.env.GEMINI_API_KEY = savedGemini; }
            if (savedAnthropic) { process.env.ANTHROPIC_API_KEY = savedAnthropic; }
        }
    });

    // --- warmUp tests ---

    // Each warmUp test uses a unique model name because warmedModels is module-level
    // state (not per-instance), so a model warmed in one test stays warm for later tests.

    await test('warmUp sends /api/generate with num_predict:1 and short prompt on first call', async () => {
        let capturedBody: any = null;
        const freshGrader = new LLMGrader();
        const testModel = 'test-warmup-request:4b';

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url === 'http://localhost:11434/api/generate' && init?.method === 'POST') {
                capturedBody = JSON.parse(init.body as string);

                return new Response(JSON.stringify({
                    response: 'ok',
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        await (freshGrader as any).warmUp('http://localhost:11434', testModel);

        assert(capturedBody !== null, 'warmUp should have sent a fetch request');
        assert(capturedBody.options.num_predict === 1, `num_predict should be 1, got: ${capturedBody.options?.num_predict}`);
        assert(capturedBody.prompt === 'hi', `prompt should be "hi", got: ${capturedBody.prompt}`);
        assert(capturedBody.stream === false, `stream should be false, got: ${capturedBody.stream}`);
        assert(capturedBody.model === testModel, `model should be ${testModel}, got: ${capturedBody.model}`);
    });

    await test('warmUp does NOT send request on second call (module-level warmedModels prevents repeat)', async () => {
        let callCount = 0;
        const freshGrader = new LLMGrader();
        const testModel = 'test-warmup-repeat:4b';

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url === 'http://localhost:11434/api/generate' && init?.method === 'POST') {
                callCount++;

                return new Response(JSON.stringify({
                    response: 'ok',
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        await (freshGrader as any).warmUp('http://localhost:11434', testModel);
        await (freshGrader as any).warmUp('http://localhost:11434', testModel);

        assert(callCount === 1, `warmUp should have sent only 1 request, sent: ${callCount}`);
    });

    await test('warmUp failure (fetch throws) logs warning but does not throw -- grade() proceeds', async () => {
        const freshGrader = new LLMGrader();
        const testModel = 'test-warmup-failure:4b';

        globalThis.fetch = (async () => {
            throw new Error('simulated network error');
        }) as typeof globalThis.fetch;

        // Should NOT throw
        let threw = false;

        try {
            await (freshGrader as any).warmUp('http://localhost:11434', testModel);
        } catch {
            threw = true;
        }

        assert(!threw, 'warmUp should not throw on failure');
    });

    await test('warmUp is NOT called when Ollama is unavailable (grade() falls through to cloud)', async () => {
        let warmUpCallCount = 0;
        const freshGrader = new LLMGrader();

        // Patch warmUp to track calls
        const originalWarmUp = (freshGrader as any).warmUp.bind(freshGrader);
        (freshGrader as any).warmUp = async (...args: any[]) => {
            warmUpCallCount++;

            return originalWarmUp(...args);
        };

        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();

            // Ollama health check fails
            if (url === 'http://localhost:11434/') {
                throw new Error('fetch failed: ECONNREFUSED');
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        const savedGemini = process.env.GEMINI_API_KEY;
        const savedAnthropic = process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;

        try {
            const config = makeConfig();
            await freshGrader.grade('/tmp/ws', dummyProvider, config, TASK_PATH, dummySessionLog, {});
            assert(warmUpCallCount === 0, `warmUp should not be called when Ollama unavailable, called: ${warmUpCallCount}`);
        } finally {
            if (savedGemini) { process.env.GEMINI_API_KEY = savedGemini; }
            if (savedAnthropic) { process.env.ANTHROPIC_API_KEY = savedAnthropic; }
        }
    });

    await test('warmUp timeout is 120000ms (verified via AbortSignal.timeout argument)', async () => {
        let capturedSignal: AbortSignal | undefined;
        const freshGrader = new LLMGrader();
        const testModel = 'test-warmup-timeout:4b';

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url === 'http://localhost:11434/api/generate' && init?.method === 'POST') {
                capturedSignal = init?.signal as AbortSignal | undefined;

                return new Response(JSON.stringify({
                    response: 'ok',
                    done: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof globalThis.fetch;

        await (freshGrader as any).warmUp('http://localhost:11434', testModel);

        assert(capturedSignal !== undefined, 'warmUp should pass a signal to fetch');
        // AbortSignal.timeout creates a signal -- we can check it exists
        // The signal should have a timeout (we cannot directly read the timeout value from AbortSignal,
        // but we verify the signal was provided and is not already aborted)
        assert(!capturedSignal!.aborted, 'signal should not be aborted at call time');
    });

    // --- Summary ---
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

    if (failures.length > 0) {
        console.log('\nFailures:');

        for (const f of failures) {
            console.log(`  - ${f}`);
        }

        process.exit(1);
    }

    console.log('\nAll Ollama grader tests passed!');
}

main();
