/**
 * Tests for LocalProvider PATH augmentation.
 *
 * Verifies that runCommand prepends workspace bin/ to PATH
 * so task-provided CLI tools are discoverable by name.
 * Same test runner pattern as bootstrap.test.ts (sequential, exit(1) on failure).
 */
import { LocalProvider } from '../src/providers/local';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`FAIL: ${message}`);
    }
}

async function runTests() {
    const provider = new LocalProvider();
    let passed = 0;
    let failed = 0;

    // Test 1: workspace bin/ is on PATH
    try {
        // Create a minimal workspace with a unique directory name
        const workspaceId = `test-provider-${Date.now()}`;
        const workspace = path.join(os.tmpdir(), workspaceId);
        await fs.ensureDir(path.join(workspace, 'bin'));

        // Write a small script that echoes PATH
        const scriptPath = path.join(workspace, 'bin', 'echo-path');
        await fs.writeFile(scriptPath, '#!/bin/bash\necho "$PATH"', { mode: 0o755 });

        const result = await provider.runCommand(workspace, 'echo "$PATH"');
        const firstEntry = result.stdout.trim().split(':')[0];

        // On Windows with Git Bash, paths are MSYS-translated (e.g., /tmp/... instead of C:\Users\...\Temp\...)
        // so we verify the first PATH entry ends with /bin and contains the workspace ID
        assert(firstEntry.endsWith('/bin') || firstEntry.endsWith('\\bin'),
            `Expected first PATH entry to end with /bin, got ${firstEntry}`);
        assert(firstEntry.includes(workspaceId),
            `Expected first PATH entry to include workspace ID '${workspaceId}', got ${firstEntry}`);
        assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);

        await fs.remove(workspace);
        console.log('  PASS: workspace bin/ is first on PATH');
        passed++;
    } catch (e: any) {
        console.error(`  FAIL: workspace bin/ is first on PATH - ${e.message}`);
        failed++;
    }

    // Test 2: task-provided CLI is executable by name
    try {
        const workspace = path.join(os.tmpdir(), `test-provider-${Date.now()}`);
        await fs.ensureDir(path.join(workspace, 'bin'));

        // Write a mock CLI tool
        const toolPath = path.join(workspace, 'bin', 'mytool');
        await fs.writeFile(toolPath, '#!/bin/bash\necho "mytool-output"', { mode: 0o755 });

        const result = await provider.runCommand(workspace, 'mytool');
        assert(result.stdout.trim() === 'mytool-output', `Expected 'mytool-output', got '${result.stdout.trim()}'`);
        assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);

        await fs.remove(workspace);
        console.log('  PASS: task-provided CLI is executable by name');
        passed++;
    } catch (e: any) {
        console.error(`  FAIL: task-provided CLI is executable by name - ${e.message}`);
        failed++;
    }

    // Test 3: custom env vars are preserved
    try {
        const workspace = path.join(os.tmpdir(), `test-provider-${Date.now()}`);
        await fs.ensureDir(path.join(workspace, 'bin'));

        const result = await provider.runCommand(workspace, 'echo "$MY_CUSTOM_VAR"', { MY_CUSTOM_VAR: 'hello' });
        assert(result.stdout.trim() === 'hello', `Expected 'hello', got '${result.stdout.trim()}'`);

        await fs.remove(workspace);
        console.log('  PASS: custom env vars are preserved');
        passed++;
    } catch (e: any) {
        console.error(`  FAIL: custom env vars are preserved - ${e.message}`);
        failed++;
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Test runner error:', err);
    process.exit(1);
});
