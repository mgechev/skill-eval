/**
 * Skill detection — finds skills in the current directory or standard locations.
 */
import * as fs from 'fs-extra';
import * as path from 'path';

export interface DetectedSkill {
    name: string;
    path: string;       // absolute path to the skill directory
    skillMd: string;    // content of SKILL.md
}

/**
 * Detect skills in the given directory.
 *
 * Looks in these locations (in order):
 * 1. SKILL.md in the root directory (the dir itself IS the skill)
 * 2. skills/{name}/SKILL.md (sub-skills)
 * 3. .agents/skills/{name}/SKILL.md (Gemini convention)
 */
export async function detectSkills(dir: string): Promise<DetectedSkill[]> {
    const skills: DetectedSkill[] = [];

    // 1. Check if the directory itself is a skill
    const rootSkillMd = path.join(dir, 'SKILL.md');
    if (await fs.pathExists(rootSkillMd)) {
        const content = await fs.readFile(rootSkillMd, 'utf-8');
        const name = parseSkillName(content) || path.basename(dir);
        skills.push({ name, path: dir, skillMd: content });
        return skills; // If root is a skill, don't look for sub-skills
    }

    // 2. Check skills/ subdirectory
    const searchDirs = ['skills', '.agents/skills', '.claude/skills'];

    for (const searchDir of searchDirs) {
        const fullSearchDir = path.join(dir, searchDir);
        if (!await fs.pathExists(fullSearchDir)) continue;

        const entries = await fs.readdir(fullSearchDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillMdPath = path.join(fullSearchDir, entry.name, 'SKILL.md');
            if (await fs.pathExists(skillMdPath)) {
                const content = await fs.readFile(skillMdPath, 'utf-8');
                const name = parseSkillName(content) || entry.name;
                skills.push({
                    name,
                    path: path.join(fullSearchDir, entry.name),
                    skillMd: content,
                });
            }
        }
    }

    return skills;
}

/**
 * Parse the skill name from SKILL.md content.
 * Looks for YAML frontmatter `name:` or first `# Heading`.
 */
function parseSkillName(content: string): string | undefined {
    // Try YAML frontmatter
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
        if (nameMatch) return nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    // Try first heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
        return headingMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
    }

    return undefined;
}
