import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fsReal from 'fs';
import * as fsExtra from 'fs-extra';
import { LocalProvider } from '../src/providers/local';
import { EnvironmentSetupOpts } from '../src/types';

describe('LocalProvider', () => {
  const provider = new LocalProvider();
  let tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      try { await fsExtra.remove(dir); } catch {}
    }
    tempDirs = [];
  });

  describe('setup', () => {
    it('creates a temp directory and copies task files', async () => {
      // Create a real temp task directory
      const taskDir = path.join(os.tmpdir(), `skillgrade-test-task-${Date.now()}`);
      await fsExtra.ensureDir(taskDir);
      await fsExtra.writeFile(path.join(taskDir, 'task.toml'), 'version = "1"');
      tempDirs.push(taskDir);

      const setupOpts: EnvironmentSetupOpts = {
        timeoutSec: 300,
        environment: { cpus: 2, memory_mb: 2048 },
      };

      const workspace = await provider.setup(taskDir, [], setupOpts);
      tempDirs.push(workspace);

      expect(workspace).toContain('skillgrade-');
      expect(await fsExtra.pathExists(workspace)).toBe(true);
      expect(await fsExtra.pathExists(path.join(workspace, 'task.toml'))).toBe(true);
    });

    it('injects skills into discovery directories', async () => {
      const taskDir = path.join(os.tmpdir(), `skillgrade-test-task-${Date.now()}`);
      const skillDir = path.join(os.tmpdir(), `skillgrade-test-skill-${Date.now()}`);
      await fsExtra.ensureDir(taskDir);
      await fsExtra.ensureDir(skillDir);
      await fsExtra.writeFile(path.join(skillDir, 'SKILL.md'), '# Test Skill');
      tempDirs.push(taskDir, skillDir);

      const setupOpts: EnvironmentSetupOpts = {
        timeoutSec: 300,
        environment: { cpus: 2, memory_mb: 2048 },
      };

      const workspace = await provider.setup(taskDir, [skillDir], setupOpts);
      tempDirs.push(workspace);

      const skillName = path.basename(skillDir);
      // Check Gemini discovery path
      const geminiPath = path.join(workspace, '.agents', 'skills', skillName, 'SKILL.md');
      expect(await fsExtra.pathExists(geminiPath)).toBe(true);

      // Check Claude discovery path
      const claudePath = path.join(workspace, '.claude', 'skills', skillName, 'SKILL.md');
      expect(await fsExtra.pathExists(claudePath)).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('removes the workspace directory', async () => {
      const tempDir = path.join(os.tmpdir(), `skillgrade-cleanup-test-${Date.now()}`);
      await fsExtra.ensureDir(tempDir);
      await fsExtra.writeFile(path.join(tempDir, 'file.txt'), 'test');

      await provider.cleanup(tempDir);
      expect(await fsExtra.pathExists(tempDir)).toBe(false);
    });

    it('handles non-existent directory gracefully', async () => {
      // Should not throw
      await provider.cleanup('/tmp/nonexistent-dir-' + Date.now());
    });
  });

  describe('runCommand', () => {
    it('executes a command and captures stdout', async () => {
      const tempDir = path.join(os.tmpdir(), `skillgrade-cmd-test-${Date.now()}`);
      await fsExtra.ensureDir(tempDir);
      tempDirs.push(tempDir);

      const result = await provider.runCommand(tempDir, 'echo "hello world"');
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('captures stderr', async () => {
      const tempDir = path.join(os.tmpdir(), `skillgrade-cmd-test-${Date.now()}`);
      await fsExtra.ensureDir(tempDir);
      tempDirs.push(tempDir);

      const result = await provider.runCommand(tempDir, 'echo "error" >&2');
      expect(result.stderr.trim()).toBe('error');
    });

    it('returns non-zero exit code', async () => {
      const tempDir = path.join(os.tmpdir(), `skillgrade-cmd-test-${Date.now()}`);
      await fsExtra.ensureDir(tempDir);
      tempDirs.push(tempDir);

      const result = await provider.runCommand(tempDir, 'exit 42');
      expect(result.exitCode).toBe(42);
    });

    it('passes environment variables', async () => {
      const tempDir = path.join(os.tmpdir(), `skillgrade-cmd-test-${Date.now()}`);
      await fsExtra.ensureDir(tempDir);
      tempDirs.push(tempDir);

      const result = await provider.runCommand(tempDir, 'echo $TEST_VAR', { TEST_VAR: 'test_value' });
      expect(result.stdout.trim()).toBe('test_value');
    });

    it('runs command in the correct working directory', async () => {
      const tempDir = path.join(os.tmpdir(), `skillgrade-cmd-test-${Date.now()}`);
      await fsExtra.ensureDir(tempDir);
      tempDirs.push(tempDir);

      const result = await provider.runCommand(tempDir, 'pwd');
      // The path might have /private prefix on macOS
      expect(result.stdout.trim()).toContain(path.basename(tempDir));
    });
  });
});