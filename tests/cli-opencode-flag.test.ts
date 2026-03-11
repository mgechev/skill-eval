/**
 * Unit tests for --agent=opencode CLI integration.
 * Verifies CLI source contains the necessary wiring without running the CLI.
 */
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

console.log('CLI --agent=opencode flag tests\n');

const cliSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli.ts'), 'utf-8');

// Test 1: Help text includes opencode
assert(cliSource.includes('--agent=gemini|claude|ollama|opencode'), 'Help text contains opencode as an agent option');

// Test 2: OpenCodeAgent import present
assert(cliSource.includes("import { OpenCodeAgent }"), 'OpenCodeAgent import is present in cli.ts');

// Test 3: Agent selection handles opencode case
assert(cliSource.includes("case 'opencode'"), 'Agent selection logic handles the opencode case');

// Test 4: OpenCodeAgent instantiation
assert(cliSource.includes('new OpenCodeAgent()'), 'OpenCodeAgent is instantiated in CLI');

// Test 5: Pre-eval setup checks for opencode
assert(cliSource.includes("agentType === 'opencode'"), 'Pre-eval setup checks for opencode agent type');

// Test 6: Smoke test for opencode
assert(cliSource.includes('OpenCode smoke test'), 'Smoke test message present for opencode agent');

// Test 7: Model unload for opencode
// Verify the opencode block includes model unloading by checking that
// model unload pattern appears after the opencode agent type check
const opencodeBlockStart = cliSource.indexOf("agentType === 'opencode'");
const opencodeBlockEnd = cliSource.indexOf("// Create agent based on type");
const opencodeBlock = cliSource.slice(opencodeBlockStart, opencodeBlockEnd);
assert(
    opencodeBlock.includes('keep_alive: 0') && opencodeBlock.includes('non-agent model'),
    'OpenCode pre-eval block includes model unloading logic'
);

// Summary
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
