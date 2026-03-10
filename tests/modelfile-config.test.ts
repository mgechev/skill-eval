import * as fs from 'fs';
import * as path from 'path';

function main() {
    console.log('Running Modelfile config tests...');
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, message: string): void {
        if (condition) {
            console.log(`  [OK] ${message}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${message}`);
            failed++;
        }
    }

    // Read Modelfile content
    const modelfilePath = path.join(__dirname, '..', 'modelfiles', 'qwen3-agent.Modelfile');
    const content = fs.readFileSync(modelfilePath, 'utf-8');

    // Modelfile content assertions
    assert(content.includes('FROM qwen3:8b'), 'Modelfile contains FROM qwen3:8b');
    assert(content.includes('num_ctx 16384'), 'Modelfile contains num_ctx 16384 (OLCFG-01)');
    assert(content.includes('num_predict 4096'), 'Modelfile contains num_predict 4096 (OLCFG-02)');
    assert(content.includes('temperature 0'), 'Modelfile contains temperature 0 (deterministic)');

    // Types module compile check -- import and verify exports are defined
    const types = require('../src/agents/ollama/types');

    assert(
        typeof types.DEFAULT_OLLAMA_AGENT_CONFIG === 'object',
        'types.ts exports DEFAULT_OLLAMA_AGENT_CONFIG object'
    );
    assert(
        types.DEFAULT_OLLAMA_AGENT_CONFIG.model === 'qwen3-agent',
        'OllamaAgentConfig default model is qwen3-agent'
    );
    assert(
        types.DEFAULT_OLLAMA_AGENT_CONFIG.host === 'http://localhost:11434',
        'OllamaAgentConfig default host is http://localhost:11434'
    );
    assert(
        types.DEFAULT_OLLAMA_AGENT_CONFIG.maxIterations === 30,
        'OllamaAgentConfig default maxIterations is 30'
    );
    assert(
        types.DEFAULT_OLLAMA_AGENT_CONFIG.maxToolOutputChars === 8000,
        'OllamaAgentConfig default maxToolOutputChars is 8000'
    );

    // Summary
    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    }

    console.log('[SUCCESS] All Modelfile config tests passed.');
}

main();
