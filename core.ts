import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import * as toml from 'toml';

export interface TaskMetadata {
    author_name: string;
    author_email: string;
    difficulty: string;
    category: string;
    tags: string[];
}

export interface TaskConfig {
    version: string;
    metadata: TaskMetadata;
    verifier: { timeout_sec: number };
    agent: { timeout_sec: number };
    environment: {
        build_timeout_sec: number;
        cpus: number;
        memory_mb: number;
        storage_mb: number;
    };
}

export abstract class BaseAgent {
    abstract run(
        instruction: string,
        workspacePath: string,
        runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    ): Promise<string>;
}

export interface EnvironmentProvider {
    setup(taskPath: string, skillsPaths: string[], env?: Record<string, string>): Promise<string>;
    cleanup(workspacePath: string): Promise<void>;
    runCommand(workspacePath: string, command: string, env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export class LocalProvider implements EnvironmentProvider {
    async setup(taskPath: string, skillsPaths: string[], env?: Record<string, string>): Promise<string> {
        const tempDir = path.join('/tmp', `skilleval-${Math.random().toString(36).substring(7)}`);
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

    async runCommand(workspacePath: string, command: string, env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        const result = spawnSync(command, {
            shell: true,
            cwd: workspacePath,
            encoding: 'utf-8',
            env: { ...process.env, ...env }
        });
        return {
            stdout: result.stdout as string,
            stderr: result.stderr as string,
            exitCode: result.status ?? 1
        };
    }
}

export async function loadTaskConfig(taskPath: string): Promise<TaskConfig> {
    const configPath = path.join(taskPath, 'task.toml');
    const content = await fs.readFile(configPath, 'utf-8');
    return toml.parse(content);
}
