import { Ollama } from 'ollama';
import type { Tool } from 'ollama';

/**
 * A minimal tool definition used for smoke testing -- only list_directory.
 */
const SMOKE_TEST_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'list_directory',
        description: 'List files and directories at the given path.',
        parameters: {
            type: 'object',
            required: ['path'],
            properties: {
                path: { type: 'string', description: 'Directory path' },
            },
        },
    },
};

/**
 * Smoke test that verifies a model produces structured tool_calls (not text-emitted JSON).
 *
 * Sends a single message asking the model to list files, providing only the list_directory tool.
 * If the model returns structured tool_calls, the test passes. If it emits tool-like JSON as
 * text content instead, the test fails with a diagnostic message.
 *
 * @param host - Ollama API host URL
 * @param model - Model name to test
 * @returns Result with passed flag and optional error message
 */
export async function smokeTestToolCalling(
    host: string,
    model: string
): Promise<{ passed: boolean; error?: string }> {
    try {
        const client = new Ollama({ host });

        const response = await client.chat({
            model,
            messages: [
                { role: 'user', content: 'List the files in the current directory.' },
            ],
            tools: [SMOKE_TEST_TOOL],
            stream: false,
            think: false,
            options: { num_ctx: 4096, num_predict: 256 },
        });

        const toolCalls = response.message.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
            const hasListDir = toolCalls.some(tc => tc.function.name === 'list_directory');

            if (hasListDir) {
                return { passed: true };
            }

            return {
                passed: false,
                error: `Model produced tool calls but none were list_directory. Got: ${toolCalls.map(tc => tc.function.name).join(', ')}`,
            };
        }

        // No structured tool calls -- check if model emitted tool-like JSON as text
        const content = response.message.content || '';

        if (content.includes('"name"') && content.includes('list_directory')) {
            return {
                passed: false,
                error: 'Model emits tool calls as text instead of structured tool_calls. Check Modelfile or model compatibility.',
            };
        }

        return {
            passed: false,
            error: 'No tool calls in response. Model may not support tool calling or the Modelfile may need adjustment.',
        };
    } catch (err: any) {
        const message = err?.message || String(err);

        if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
            return {
                passed: false,
                error: `Cannot connect to Ollama at ${host}. Is Ollama running? (${message})`,
            };
        }

        return {
            passed: false,
            error: `Smoke test error: ${message}`,
        };
    }
}
