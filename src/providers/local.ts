import * as fs from 'fs-extra';
import * as path from 'path';
import { spawn } from 'child_process';
import { EnvironmentProvider, EnvironmentSetupOpts, CommandResult } from '../types';

export class LocalProvider implements EnvironmentProvider {
    async setup(taskPath: string, skillsPaths: string[], opts: EnvironmentSetupOpts, env?: Record<string, string>): Promise<string> {
        const tempDir = path.join('/tmp', `skillgrade-${Math.random().toString(36).substring(7)}`);
        await fs.ensureDir(tempDir);
        try {
            await fs.copy(taskPath, tempDir);

            // Inject skills into agent discovery paths
            // Gemini: .agents/skills/  |  Claude: .claude/skills/
            if (skillsPaths.length > 0) {
                const homeDir = process.env.HOME || '/root';
                const discoveryDirs = [
                    path.join(homeDir, '.agents', 'skills'),
                    path.join(homeDir, '.claude', 'skills'),
                ];

                console.warn(`[SkillGrade] Injecting skills into ${homeDir}/.agents/skills and .claude/skills`);

                for (const skillsDir of discoveryDirs) {
                    await fs.ensureDir(skillsDir);
                    for (const spath of skillsPaths) {
                        const skillName = path.basename(spath);
                        await fs.copy(spath, path.join(skillsDir, skillName));
                    }
                }
            }

            if (opts.trialSetup) {
                const result = await this.runCommand(tempDir, opts.trialSetup, env);
                if (result.exitCode !== 0) {
                    throw new Error(`Per-trial setup failed with exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
                }
            }

            return tempDir;
        } catch (e) {
            await this.cleanup(tempDir);
            throw e;
        }
    }

    async cleanup(workspacePath: string): Promise<void> {
        if (await fs.pathExists(workspacePath)) {
            await fs.remove(workspacePath);
        }
    }

    async runCommand(workspacePath: string, command: string, env?: Record<string, string>): Promise<CommandResult> {
        return new Promise((resolve) => {
            const child = spawn(command, {
                shell: true,
                cwd: workspacePath,
                env: { ...process.env, ...env }
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            child.on('close', (code) => {
                resolve({ stdout, stderr, exitCode: code ?? 1 });
            });

            child.on('error', () => {
                resolve({ stdout, stderr, exitCode: 1 });
            });
        });
    }
}
