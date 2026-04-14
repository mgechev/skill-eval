import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs-extra before importing
vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  readFile: vi.fn(),
}));

import * as fs from 'fs-extra';
import { loadEvalConfig, resolveTask } from '../src/core/config';
import { EvalTaskConfig, EvalDefaults } from '../src/core/config.types';

const mockPathExists = vi.mocked(fs.pathExists);
const mockReadFile = vi.mocked(fs.readFile);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadEvalConfig', () => {
  it('throws when eval.yaml is missing', async () => {
    mockPathExists.mockResolvedValue(false as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('No eval configuration found');
  });

  it('throws when YAML is not an object', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('just a string' as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('must be a YAML object');
  });

  it('throws when tasks array is missing', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('version: "1"\n' as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('at least one task');
  });

  it('throws when tasks array is empty', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('version: "1"\ntasks: []\n' as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('at least one task');
  });

  it('throws when task is missing name', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - instruction: "do something"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('missing a "name"');
  });

  it('throws when task is missing instruction', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('missing an "instruction"');
  });

  it('throws when task has no graders', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: "do something"
`;
    mockReadFile.mockResolvedValue(yaml as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('at least one grader');
  });

  it('throws on workspace mapping without src/dest', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: "do something"
    workspace:
      - { foo: bar }
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('without dest');
  });

  it('parses valid config correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
skill: ./SKILL.md
defaults:
  agent: claude
  trials: 10
  docker:
    base: ubuntu:22.04
tasks:
  - name: test-task
    instruction: "install the app"
    graders:
      - type: deterministic
        run: "echo ok"
        weight: 0.7
      - type: llm_rubric
        rubric: "check quality"
        weight: 0.3
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.version).toBe('1');
    expect(config.skill).toBe('./SKILL.md');
    expect(config.defaults.agent).toBe('claude');
    expect(config.defaults.trials).toBe(10);
    expect(config.defaults.docker.base).toBe('ubuntu:22.04');
    expect(config.tasks).toHaveLength(1);
    expect(config.tasks[0].name).toBe('test-task');
    expect(config.tasks[0].graders).toHaveLength(2);
    expect(config.tasks[0].graders[0].weight).toBe(0.7);
    expect(config.tasks[0].graders[1].type).toBe('llm_rubric');
  });

  it('loads a custom config file correctly', async () => {
    mockPathExists.mockImplementation(async (p) => typeof p === 'string' && p.endsWith('eval-baseline.yaml'));
    const yaml = `version: "1"
tasks:
  - name: baseline-task
    instruction: "do baseline"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockImplementation(async (p) => {
        if (typeof p === 'string' && p.endsWith('eval-baseline.yaml')) return yaml;
        return '' as any;
    });

    const config = await loadEvalConfig('/test', 'eval-baseline.yaml');
    expect(config.tasks[0].name).toBe('baseline-task');
  });

  it('parses trialConfig correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: "do it"
    trialConfig:
      setup: "echo setup"
      cleanup: "echo cleanup"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.tasks[0].trialConfig?.setup).toBe('echo setup');
    expect(config.tasks[0].trialConfig?.cleanup).toBe('echo cleanup');
  });

  it('parses default trialConfig correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
defaults:
  trialConfig:
    setup: "echo default setup"
    cleanup: "echo default cleanup"
tasks:
  - name: test-task
    instruction: "do it"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.defaults.trialConfig?.setup).toBe('echo default setup');
    expect(config.defaults.trialConfig?.cleanup).toBe('echo default cleanup');
  });

  it('applies default values when defaults not specified', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: do it
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.defaults.agent).toBe('gemini');
    expect(config.defaults.provider).toBe('docker');
    expect(config.defaults.trials).toBe(5);
    expect(config.defaults.timeout).toBe(300);
    expect(config.defaults.threshold).toBe(0.8);
    expect(config.defaults.docker.base).toBe('node:20-slim');
  });

  it('handles workspace string shorthand', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: do it
    workspace:
      - fixtures/app.js
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.tasks[0].workspace).toEqual([
      { src: 'fixtures/app.js', dest: 'app.js' },
    ]);
  });

  it('handles workspace objects with chmod', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: do it
    workspace:
      - src: scripts/run.sh
        dest: /workspace/run.sh
        chmod: "+x"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.tasks[0].workspace).toEqual([
      { src: 'scripts/run.sh', dest: '/workspace/run.sh', chmod: '+x' },
    ]);
  });

  it('defaults grader weight to 1.0', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: do it
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.tasks[0].graders[0].weight).toBe(1.0);
  });

  it('parses env variables correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
defaults:
  env:
    GLOBAL_VAR: "global"
tasks:
  - name: test-task
    instruction: "do it"
    env:
      TASK_VAR: "task"
    trialConfig:
      env:
        TRIAL_VAR: "trial"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.defaults.env).toEqual({ GLOBAL_VAR: 'global' });
    expect(config.tasks[0].env).toEqual({ TASK_VAR: 'task' });
    expect(config.tasks[0].trialConfig?.env).toEqual({ TRIAL_VAR: 'trial' });
  });

  it('parses default workspace correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
defaults:
  workspace:
    - fixtures/common.js
tasks:
  - name: test-task
    instruction: "do it"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.defaults.workspace).toEqual([
      { src: 'fixtures/common.js', dest: 'common.js' },
    ]);
  });

  it('throws when defaults.environment.mounts is not an array', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
defaults:
  environment:
    mounts: "not an array"
tasks:
  - name: test-task
    instruction: "do it"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('defaults.environment.mounts must be an array');
  });

  it('throws when task environment.mounts is not an array', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: "do it"
    environment:
      mounts: "not an array"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);
    await expect(loadEvalConfig('/test')).rejects.toThrow('environment.mounts must be an array');
  });

  it('parses valid mounts correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
defaults:
  environment:
    mounts:
      - "/host:/container:ro"
tasks:
  - name: test-task
    instruction: "do it"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.defaults.environment.mounts).toEqual(['/host:/container:ro']);
  });

  it('parses agentWorkingDir correctly', async () => {
    mockPathExists.mockResolvedValue(true as any);
    const yaml = `version: "1"
tasks:
  - name: test-task
    instruction: "do it"
    agentWorkingDir: "sub-dir"
    graders:
      - type: deterministic
        run: "echo ok"
`;
    mockReadFile.mockResolvedValue(yaml as any);

    const config = await loadEvalConfig('/test');
    expect(config.tasks[0].agentWorkingDir).toBe('sub-dir');
  });
});

describe('resolveTask', () => {
  const defaults: EvalDefaults = {
    agent: 'gemini',
    provider: 'docker',
    trials: 5,
    timeout: 300,
    threshold: 0.8,
    docker: { base: 'node:20-slim' },
    environment: { cpus: 1, memory_mb: 512 },
  };

  it('applies defaults when task has no overrides', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    // The instruction is inline (multi-line would be caught, single line tries file path)
    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.agent).toBe('gemini');
    expect(resolved.provider).toBe('docker');
    expect(resolved.trials).toBe(5);
    expect(resolved.timeout).toBe(300);
    expect(resolved.docker.base).toBe('node:20-slim');
  });

  it('task overrides take precedence over defaults', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it now',
      agent: 'claude',
      provider: 'local',
      trials: 10,
      timeout: 600,
      docker: { base: 'ubuntu:22.04' },
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.agent).toBe('claude');
    expect(resolved.provider).toBe('local');
    expect(resolved.trials).toBe(10);
    expect(resolved.timeout).toBe(600);
    expect(resolved.docker.base).toBe('ubuntu:22.04');
  });

  it('resolves instruction from file when it exists', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'instruction.md',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('File content here' as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.instruction).toBe('File content here');
  });

  it('keeps inline multi-line instruction as-is', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'line 1\nline 2\nline 3',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.instruction).toBe('line 1\nline 2\nline 3');
  });

  it('resolves deterministic grader run from file', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'multi\nline instruction',
      graders: [{ type: 'deterministic', run: 'test.sh', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('#!/bin/bash\necho pass' as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.graders[0].run).toBe('#!/bin/bash\necho pass');
  });

  it('resolves deterministic grader run from file with arguments', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'multi\nline instruction',
      graders: [{ type: 'deterministic', run: 'test.sh --arg1 val1', weight: 1.0 }],
    };

    mockPathExists.mockImplementation(async (p) => {
        if (typeof p === 'string') {
            if (p.endsWith('test.sh --arg1 val1')) return false;
            if (p.endsWith('test.sh')) return true;
        }
        return false;
    });
    mockReadFile.mockResolvedValue('#!/bin/bash\necho $1' as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.graders[0].run).toBe('(\n  set -- --arg1 val1\n  #!/bin/bash\necho $1\n)');
  });

  it('resolves llm_rubric grader rubric from file', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'multi\nline instruction',
      graders: [{ type: 'llm_rubric', rubric: 'rubric.md', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('Evaluate quality...' as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.graders[0].rubric).toBe('Evaluate quality...');
  });

  it('resolves solution path', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'multi\nline',
      solution: 'solutions/solve.sh',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.solution).toContain('solutions/solve.sh');
  });

  it('sets empty workspace when not provided', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'multi\nline',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.workspace).toEqual([]);
  });

  it('merges workspace mappings correctly', async () => {
    const defaultsWithWorkspace = {
      ...defaults,
      workspace: [
        { src: 'common.js', dest: 'common.js' },
        { src: 'default-only.js', dest: 'default-only.js' },
      ],
    };
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [
        { src: 'task-specific.js', dest: 'task-specific.js' },
        { src: 'overridden.js', dest: 'common.js' },
      ],
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaultsWithWorkspace, '/base');
    expect(resolved.workspace).toHaveLength(3);
    expect(resolved.workspace).toContainEqual({ src: 'default-only.js', dest: 'default-only.js' });
    expect(resolved.workspace).toContainEqual({ src: 'task-specific.js', dest: 'task-specific.js' });
    expect(resolved.workspace).toContainEqual({ src: 'overridden.js', dest: 'common.js' });
  });

  it('preserves grader setup field', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'multi\nline',
      graders: [{
        type: 'deterministic',
        setup: 'npm install -g typescript',
        run: 'echo ok',
        weight: 1.0,
      }],
    };

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.graders[0].setup).toBe('npm install -g typescript');
  });

  it('merges env variables correctly', async () => {
    const defaultsWithEnv = {
      ...defaults,
      env: { GLOBAL_VAR: 'global', OVERRIDDEN: 'global' },
    };
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      env: { TASK_VAR: 'task', OVERRIDDEN: 'task' },
      trialConfig: {
        env: { TRIAL_VAR: 'trial' },
      },
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaultsWithEnv, '/base');
    expect(resolved.env).toEqual({
      GLOBAL_VAR: 'global',
      TASK_VAR: 'task',
      OVERRIDDEN: 'task',
    });
    expect(resolved.trialConfig?.env).toEqual({ TRIAL_VAR: 'trial' });
  });

  it('merges trialConfig correctly', async () => {
    const defaultsWithTrialConfig = {
      ...defaults,
      trialConfig: {
        setup: 'echo default setup',
        cleanup: 'echo default cleanup',
        env: { DEFAULT_VAR: 'default' },
      },
    };
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      trialConfig: {
        setup: 'echo task setup',
        cleanup: 'echo task cleanup',
        env: { TASK_VAR: 'task' },
      },
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaultsWithTrialConfig, '/base');
    expect(resolved.trialConfig?.setup).toBe('echo default setup\necho task setup');
    expect(resolved.trialConfig?.cleanup).toBe('echo default cleanup\necho task cleanup');
    expect(resolved.trialConfig?.env).toEqual({
      DEFAULT_VAR: 'default',
      TASK_VAR: 'task',
    });
  });

  it('merges trialConfig with file references correctly', async () => {
    const defaultsWithTrialConfig = {
      ...defaults,
      trialConfig: {
        setup: 'default_setup.sh',
        cleanup: 'echo default cleanup',
      },
    };
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      trialConfig: {
        setup: 'echo task setup',
        cleanup: 'task_cleanup.sh',
      },
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockImplementation(async (p) => typeof p === 'string' && (p.endsWith('default_setup.sh') || p.endsWith('task_cleanup.sh')));
    mockReadFile.mockImplementation(async (p) => {
        if (typeof p === 'string') {
            if (p.endsWith('default_setup.sh')) return 'echo from default file';
            if (p.endsWith('task_cleanup.sh')) return 'echo from task file';
        }
        return '' as any;
    });

    const resolved = await resolveTask(task, defaultsWithTrialConfig, '/base');
    expect(resolved.trialConfig?.setup).toBe('echo from default file\necho task setup');
    expect(resolved.trialConfig?.cleanup).toBe('echo default cleanup\necho from task file');
  });

  it('merges trialConfig with arguments correctly', async () => {
    const defaultsWithTrialConfig = {
      ...defaults,
      trialConfig: {
        setup: 'default_setup.sh --flag1',
      },
    };
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      trialConfig: {
        setup: 'task_setup.sh --flag2',
      },
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockImplementation(async (p) => {
        if (typeof p === 'string') {
            if (p.endsWith('default_setup.sh')) return true;
            if (p.endsWith('task_setup.sh')) return true;
        }
        return false;
    });
    mockReadFile.mockImplementation(async (p) => {
        if (typeof p === 'string') {
            if (p.endsWith('default_setup.sh')) return 'echo from default file';
            if (p.endsWith('task_setup.sh')) return 'echo from task file';
        }
        return '' as any;
    });

    const resolved = await resolveTask(task, defaultsWithTrialConfig, '/base');
    expect(resolved.trialConfig?.setup).toBe('(\n  set -- --flag1\n  echo from default file\n)\n(\n  set -- --flag2\n  echo from task file\n)');
  });

  it('resolves ~ in mounts', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      environment: {
        mounts: ['~/.config:/tmp/config'],
      },
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.environment.mounts).toHaveLength(1);
    expect(resolved.environment.mounts![0]).not.toContain('~');
    expect(resolved.environment.mounts![0]).toContain(require('os').homedir());
  });

  it('resolves agentWorkingDir correctly', async () => {
    const task: EvalTaskConfig = {
      name: 'test-task',
      instruction: 'do it',
      agentWorkingDir: 'sub-dir',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    };

    mockPathExists.mockResolvedValue(false as any);

    const resolved = await resolveTask(task, defaults, '/base');
    expect(resolved.agentWorkingDir).toBe('sub-dir');
  });
});
