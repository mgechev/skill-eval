import * as fs from 'fs-extra';
import * as path from 'path';
import { spawn } from 'child_process';
import { EnvironmentProvider, CommandResult, TaskConfig } from '../types';

export class LocalProvider implements EnvironmentProvider {
    async setup(taskPath: string, skillsPaths: string[], _taskConfig: TaskConfig, env?: Record<string, string>): Promise<string> {
        const tempDir = path.join('/tmp', `skill-eval-${Math.random().toString(36).substring(7)}`);
        await fs.ensureDir(tempDir);
        await fs.copy(taskPath, tempDir);

        const skillsDir = path.join(tempDir, '.agents', 'skills');
        await fs.ensureDir(skillsDir);

        for (const spath of skillsPaths) {
            const skillName = path.basename(spath);
            await fs.copy(spath, path.join(skillsDir, skillName));
        }

        return tempDir;
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
