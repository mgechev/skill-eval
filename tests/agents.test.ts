import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAgent } from '../src/agents/gemini';
import { ClaudeAgent } from '../src/agents/claude';
import { CommandResult } from '../src/types';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GeminiAgent', () => {
  it('writes instruction via base64 and runs gemini CLI', async () => {
    const agent = new GeminiAgent();
    const commands: string[] = [];
    const mockRunCommand = vi.fn().mockImplementation(async (cmd: string): Promise<CommandResult> => {
      commands.push(cmd);
      return { stdout: 'output', stderr: '', exitCode: 0 };
    });

    const result = await agent.run('Test instruction', '/workspace', mockRunCommand);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('base64');
    expect(commands[0]).toContain('/tmp/.prompt.md');
    expect(commands[1]).toContain('gemini');
    expect(commands[1]).toContain('-y');
    expect(commands[1]).toContain('--sandbox=none');
    expect(result).toContain('output');
  });

  it('returns combined stdout and stderr', async () => {
    const agent = new GeminiAgent();
    const mockRunCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'out', stderr: 'err', exitCode: 0 });

    const result = await agent.run('Test', '/workspace', mockRunCommand);
    expect(result).toContain('out');
    expect(result).toContain('err');
  });

  it('handles non-zero exit code without throwing', async () => {
    const agent = new GeminiAgent();
    const mockRunCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'partial', stderr: 'error', exitCode: 1 });

    const result = await agent.run('Test', '/workspace', mockRunCommand);
    expect(result).toContain('partial');
    expect(result).toContain('error');
  });

  it('correctly base64 encodes the instruction', async () => {
    const agent = new GeminiAgent();
    const instruction = 'Hello World!';
    let capturedCmd = '';
    const mockRunCommand = vi.fn().mockImplementation(async (cmd: string): Promise<CommandResult> => {
      if (cmd.includes('base64')) capturedCmd = cmd;
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await agent.run(instruction, '/workspace', mockRunCommand);

    const expectedB64 = Buffer.from(instruction).toString('base64');
    expect(capturedCmd).toContain(expectedB64);
  });

  it('prepends cd to gemini command when agentWorkingDir is provided', async () => {
    const agent = new GeminiAgent();
    const commands: string[] = [];
    const mockRunCommand = vi.fn().mockImplementation(async (cmd: string): Promise<CommandResult> => {
      commands.push(cmd);
      return { stdout: 'output', stderr: '', exitCode: 0 };
    });

    await agent.run('Test instruction', '/workspace', mockRunCommand, { agentWorkingDir: 'sub-dir' });

    expect(commands).toHaveLength(2);
    expect(commands[1]).toContain('cd sub-dir && gemini');
  });
});

describe('ClaudeAgent', () => {
  it('writes instruction via base64 and runs claude CLI', async () => {
    const agent = new ClaudeAgent();
    const commands: string[] = [];
    const mockRunCommand = vi.fn().mockImplementation(async (cmd: string): Promise<CommandResult> => {
      commands.push(cmd);
      return { stdout: 'output', stderr: '', exitCode: 0 };
    });

    const result = await agent.run('Test instruction', '/workspace', mockRunCommand);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('base64');
    expect(commands[0]).toContain('/tmp/.prompt.md');
    expect(commands[1]).toContain('claude');
    expect(commands[1]).toContain('-p');
    expect(commands[1]).toContain('--dangerously-skip-permissions');
    expect(result).toContain('output');
  });

  it('returns combined stdout and stderr', async () => {
    const agent = new ClaudeAgent();
    const mockRunCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'claude-out', stderr: 'claude-err', exitCode: 0 });

    const result = await agent.run('Test', '/workspace', mockRunCommand);
    expect(result).toContain('claude-out');
    expect(result).toContain('claude-err');
  });

  it('handles non-zero exit code without throwing', async () => {
    const agent = new ClaudeAgent();
    const mockRunCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'failed', exitCode: 1 });

    const result = await agent.run('Test', '/workspace', mockRunCommand);
    expect(result).toContain('failed');
  });

  it('correctly base64 encodes the instruction', async () => {
    const agent = new ClaudeAgent();
    const instruction = 'Complex instruction with "quotes" and special chars!';
    let capturedCmd = '';
    const mockRunCommand = vi.fn().mockImplementation(async (cmd: string): Promise<CommandResult> => {
      if (cmd.includes('base64')) capturedCmd = cmd;
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await agent.run(instruction, '/workspace', mockRunCommand);

    const expectedB64 = Buffer.from(instruction).toString('base64');
    expect(capturedCmd).toContain(expectedB64);
  });
});
