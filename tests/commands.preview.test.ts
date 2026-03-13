import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
}));

vi.mock('../src/reporters/cli', () => ({
  runCliPreview: vi.fn(),
}));

vi.mock('../src/reporters/browser', () => ({
  runBrowserPreview: vi.fn(),
}));

import * as fs from 'fs-extra';
import { runPreview } from '../src/commands/preview';
import { runCliPreview } from '../src/reporters/cli';
import { runBrowserPreview } from '../src/reporters/browser';

const mockRunCliPreview = vi.mocked(runCliPreview);
const mockRunBrowserPreview = vi.mocked(runBrowserPreview);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('runPreview', () => {
  it('calls runCliPreview for cli mode', async () => {
    await runPreview('/project', 'cli');

    expect(mockRunCliPreview).toHaveBeenCalled();
    expect(mockRunBrowserPreview).not.toHaveBeenCalled();
  });

  it('calls runBrowserPreview for browser mode', async () => {
    await runPreview('/project', 'browser');

    expect(mockRunBrowserPreview).toHaveBeenCalled();
    expect(mockRunCliPreview).not.toHaveBeenCalled();
  });

  it('constructs results dir from output dir', async () => {
    await runPreview('/project', 'cli', '/custom/output');

    const calledPath = mockRunCliPreview.mock.calls[0][0];
    expect(calledPath).toContain('/custom/output');
    expect(calledPath).toContain('project');
    expect(calledPath).toContain('results');
  });

  it('uses default temp dir when no output specified', async () => {
    await runPreview('/project', 'cli');

    const calledPath = mockRunCliPreview.mock.calls[0][0];
    expect(calledPath).toContain('skilleval');
    expect(calledPath).toContain('project');
    expect(calledPath).toContain('results');
  });
});
