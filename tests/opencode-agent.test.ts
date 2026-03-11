/**
 * Unit tests for OpenCodeAgent -- no running Ollama server or opencode binary required.
 */
import { OpenCodeAgent } from '../src/agents/opencode';
import { BaseAgent } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  [PASS] ${message}`);
        passed++;
    } else {
        console.error(`  [FAIL] ${message}`);
        failed++;
    }
}

console.log('OpenCodeAgent unit tests\n');

// Test 1: Constructability
const agent = new OpenCodeAgent();
assert(agent !== null && agent !== undefined, '1. OpenCodeAgent is constructable');

// Test 2: Extends BaseAgent
assert(agent instanceof BaseAgent, '2. OpenCodeAgent extends BaseAgent');

// Test 3: Has run method
assert(typeof agent.run === 'function', '3. OpenCodeAgent has run method');

// Test 4: Config file exists
const configPath = path.join(__dirname, '..', 'src', 'agents', 'opencode', 'opencode.skill-eval-agent.json');
assert(fs.existsSync(configPath), '4. Config file exists at expected path');

// Test 5: Config is valid JSON
let config: any;

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert(true, '5. Config is valid JSON');
} catch {
    assert(false, '5. Config is valid JSON');
    config = null;
}

// Test 6: Config has Ollama provider with /v1 baseURL
assert(
    config?.provider?.ollama?.options?.baseURL?.includes('/v1'),
    '6. Config has Ollama provider with /v1 baseURL'
);

// Test 7: Config has correct model (opencode variant without custom system prompt)
assert(
    config?.model === 'ollama/qwen3.5-4b-opencode-agent',
    '7. Config has correct model (ollama/qwen3.5-4b-opencode-agent)'
);

// Test 8: Config permissions all explicit (no "ask" defaults)
const permissions = config?.permission;
const permissionKeys = permissions ? Object.keys(permissions) : [];
const allExplicit = permissionKeys.length > 0 && permissionKeys.every(
    (key: string) => permissions[key] === 'allow' || permissions[key] === 'deny'
);
assert(allExplicit, '8. Config permissions all explicit (allow or deny, no ask)');

// Test 9: Config has tools: true for the model
assert(
    config?.provider?.ollama?.models?.['qwen3.5-4b-opencode-agent']?.tools === true,
    '9. Config has tools: true for the model'
);

// Source code analysis tests
const sourcePath = path.join(__dirname, '..', 'src', 'agents', 'opencode', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf-8');

// Test 10: Source contains config injection pattern
assert(
    source.includes('opencode.skill-eval-agent.json') && source.includes('base64'),
    '10. Source has config injection (references config file and base64 encoding)'
);

// Test 11: Source contains timeout wrapper
assert(
    source.includes('timeout'),
    '11. Source has timeout wrapper (bash timeout command usage)'
);

// Test 12: Source contains model unload pattern
assert(
    source.includes('keep_alive'),
    '12. Source has model unload pattern (keep_alive: 0)'
);

// Test 13: Source contains diagnostic logging
assert(
    source.includes('[OpenCodeAgent]'),
    '13. Source has diagnostic logging ([OpenCodeAgent] prefix)'
);

// Summary
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
