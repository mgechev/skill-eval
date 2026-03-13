import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock fs-extra before importing the module
vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import * as fs from 'fs-extra';
import { detectSkills } from '../src/core/skills';

const mockPathExists = vi.mocked(fs.pathExists);
const mockReadFile = vi.mocked(fs.readFile);
const mockReaddir = vi.mocked(fs.readdir);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('detectSkills', () => {
  it('detects root SKILL.md and returns immediately', async () => {
    mockPathExists.mockImplementation(async (p: any) => {
      return String(p).endsWith('SKILL.md');
    });
    mockReadFile.mockResolvedValue('# My Awesome Skill\n\nThis is a skill.' as any);

    const skills = await detectSkills('/project');

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-awesome-skill');
    expect(skills[0].path).toBe('/project');
    expect(skills[0].skillMd).toContain('My Awesome Skill');
  });

  it('detects skill name from YAML frontmatter', async () => {
    const content = `---
name: cool-skill
---
# Cool Skill
Some description`;

    mockPathExists.mockImplementation(async (p: any) => {
      return String(p).endsWith('SKILL.md');
    });
    mockReadFile.mockResolvedValue(content as any);

    const skills = await detectSkills('/project');
    expect(skills[0].name).toBe('cool-skill');
  });

  it('detects skill name from quoted YAML frontmatter', async () => {
    const content = `---
name: "my-quoted-skill"
---
Content here`;

    mockPathExists.mockImplementation(async (p: any) => {
      return String(p).endsWith('SKILL.md');
    });
    mockReadFile.mockResolvedValue(content as any);

    const skills = await detectSkills('/project');
    expect(skills[0].name).toBe('my-quoted-skill');
  });

  it('falls back to directory name when no name found in content', async () => {
    mockPathExists.mockImplementation(async (p: any) => {
      return String(p).endsWith('SKILL.md');
    });
    mockReadFile.mockResolvedValue('Just some plain text without headings.' as any);

    const skills = await detectSkills('/project/my-dir');
    expect(skills[0].name).toBe('my-dir');
  });

  it('scans skills/ subdirectory when no root SKILL.md', async () => {
    mockPathExists.mockImplementation(async (p: any) => {
      const s = String(p);
      if (s === path.join('/project', 'SKILL.md')) return false;
      if (s === path.join('/project', 'skills')) return true;
      if (s === path.join('/project', '.agents/skills')) return false;
      if (s === path.join('/project', '.claude/skills')) return false;
      if (s.endsWith('SKILL.md')) return true;
      return false;
    });
    mockReaddir.mockResolvedValue([
      { name: 'skill-a', isDirectory: () => true, isFile: () => false } as any,
      { name: 'readme.txt', isDirectory: () => false, isFile: () => true } as any,
    ] as any);
    mockReadFile.mockResolvedValue('# Skill A\nDescription' as any);

    const skills = await detectSkills('/project');
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('skill-a');
  });

  it('returns empty array when no skills found anywhere', async () => {
    mockPathExists.mockResolvedValue(false as any);

    const skills = await detectSkills('/empty-project');
    expect(skills).toEqual([]);
  });
});
