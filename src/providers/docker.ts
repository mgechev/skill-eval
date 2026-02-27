import Docker from 'dockerode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as tar from 'tar-stream';
import { EnvironmentProvider, CommandResult, TaskConfig } from '../types';

export class DockerProvider implements EnvironmentProvider {
    private docker: Docker;
    private preparedImage?: string;
    private taskConfig?: TaskConfig;
    private envPairs: string[] = [];

    constructor() {
        this.docker = new Docker();
    }

    /**
     * Build the image once, inject skills, commit a snapshot.
     * All subsequent setup() calls create containers from this image.
     */
    async prepare(taskPath: string, skillsPaths: string[], taskConfig: TaskConfig, env?: Record<string, string>): Promise<string> {
        this.taskConfig = taskConfig;
        this.envPairs = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [];

        const baseName = `skill-eval-${path.basename(taskPath)}-${Date.now()}`;

        // Build image from Dockerfile
        const stream = await this.docker.buildImage({
            context: taskPath,
            src: ['.']
        }, { t: baseName, dockerfile: 'environment/Dockerfile' });

        const buildResult = await new Promise<any[]>((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err: Error | null, res: any[]) => err ? reject(err) : resolve(res));
        });

        const buildError = buildResult.find((item: any) => item.error || item.errorDetail);
        if (buildError) {
            throw new Error(`Docker build failed: ${buildError.error || buildError.errorDetail?.message || 'Unknown error'}`);
        }

        // If we have skills, inject them into a temp container and commit as a new image
        if (skillsPaths.length > 0) {
            const tmpContainer = await this.docker.createContainer({
                Image: baseName,
                Cmd: ['tail', '-f', '/dev/null'],
                Tty: false
            });

            await tmpContainer.start();

            const discoveryDirs = ['/workspace/.agents/skills', '/workspace/.claude/skills'];
            for (const dir of discoveryDirs) {
                const mkdirExec = await tmpContainer.exec({ Cmd: ['mkdir', '-p', dir], AttachStdout: true, AttachStderr: true });
                const mkdirStream = await mkdirExec.start({});
                await new Promise<void>((resolve) => {
                    mkdirStream.on('end', resolve);
                    mkdirStream.on('error', resolve);
                    mkdirStream.resume();
                });

                for (const skillPath of skillsPaths) {
                    const skillName = path.basename(skillPath);
                    const archive = await this.createTarFromDir(skillPath, skillName);
                    await tmpContainer.putArchive(archive, { path: dir });
                }
            }

            // Commit the container with skills baked in
            const committed = await tmpContainer.commit({ repo: `${baseName}-ready` });
            this.preparedImage = `${baseName}-ready`;

            // Clean up temp container and base image
            await tmpContainer.kill().catch(() => { });
            await tmpContainer.remove({ force: true }).catch(() => { });
            await this.docker.getImage(baseName).remove({ force: true }).catch(() => { });

            console.log(`  Image ready: ${this.preparedImage} (${committed.Id.substring(7, 19)})`);
        } else {
            this.preparedImage = baseName;
            console.log(`  Image ready: ${this.preparedImage}`);
        }

        return this.preparedImage;
    }

    /**
     * Per-trial: create a fresh container from the prepared image.
     * This is fast — no build, no skill injection.
     */
    async setup(taskPath: string, skillsPaths: string[], taskConfig: TaskConfig, env?: Record<string, string>): Promise<string> {
        // If prepare() wasn't called, fall back to building inline
        if (!this.preparedImage) {
            await this.prepare(taskPath, skillsPaths, taskConfig, env);
        }

        const config = this.taskConfig || taskConfig;
        const envPairs = this.envPairs.length > 0 ? this.envPairs
            : (env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : []);

        const container = await this.docker.createContainer({
            Image: this.preparedImage!,
            Cmd: ['tail', '-f', '/dev/null'],
            Env: envPairs,
            Tty: true,
            HostConfig: {
                NanoCpus: config.environment.cpus * 1e9,
                Memory: config.environment.memory_mb * 1024 * 1024,
            }
        });

        await container.start();
        return container.id;
    }

    /**
     * Per-trial cleanup: kill and remove the container only.
     * The image is preserved for reuse.
     */
    async cleanup(containerId: string): Promise<void> {
        const container = this.docker.getContainer(containerId);

        try {
            await container.kill().catch(() => { });
            await container.remove({ force: true });
        } catch (e) {
            // Already removed
        }
    }

    /**
     * One-time teardown: remove the prepared image after all trials.
     */
    async teardown(): Promise<void> {
        if (this.preparedImage) {
            try {
                await this.docker.getImage(this.preparedImage).remove({ force: true });
            } catch (e) {
                // Already removed
            }
            this.preparedImage = undefined;
        }
    }

    private async createTarFromDir(dirPath: string, prefix: string): Promise<Buffer> {
        const pack = tar.pack();
        const files = await this.walkDir(dirPath);

        for (const filePath of files) {
            const relativePath = path.relative(dirPath, filePath);
            const content = await fs.readFile(filePath);
            pack.entry({ name: path.join(prefix, relativePath) }, content);
        }

        pack.finalize();

        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            pack.on('data', (chunk: Buffer) => chunks.push(chunk));
            pack.on('end', () => resolve(Buffer.concat(chunks)));
            pack.on('error', reject);
        });
    }

    private async walkDir(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.walkDir(fullPath));
            } else {
                files.push(fullPath);
            }
        }
        return files;
    }

    async runCommand(containerId: string, command: string, env?: Record<string, string>): Promise<CommandResult> {
        const container = this.docker.getContainer(containerId);
        const envPairs = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [];

        const exec = await container.exec({
            Cmd: ['/bin/bash', '-c', command],
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
            Env: envPairs
        });

        const stream = await exec.start({ Tty: true });
        const output = await new Promise<string>((resolve, reject) => {
            let data = '';
            stream.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });
            stream.on('end', () => resolve(data));
            stream.on('error', (err: Error) => reject(err));
        });

        const result = await exec.inspect();

        return {
            stdout: output,
            stderr: '',
            exitCode: result.ExitCode ?? 0
        };
    }

    async diagnose(containerId: string): Promise<string> {
        const container = this.docker.getContainer(containerId);
        const lines: string[] = ['=== Docker Container Diagnostics ==='];

        const runDiag = async (label: string, cmd: string) => {
            try {
                const exec = await container.exec({
                    Cmd: ['/bin/bash', '-c', cmd],
                    AttachStdout: true,
                    AttachStderr: true,
                    Tty: false
                });
                const stream = await exec.start({});
                const output = await new Promise<string>((resolve) => {
                    let data = '';
                    stream.on('data', (chunk: Buffer) => data += chunk.toString());
                    stream.on('end', () => resolve(data.trim()));
                    stream.on('error', () => resolve('(error)'));
                    setTimeout(() => resolve(data.trim() || '(timeout)'), 5000);
                });
                lines.push(`\n--- ${label} ---\n${output}`);
            } catch (e) {
                lines.push(`\n--- ${label} ---\n(failed: ${e})`);
            }
        };

        await runDiag('Processes', 'ps aux 2>/dev/null || cat /proc/[0-9]*/cmdline 2>/dev/null | tr "\\0" " "');
        await runDiag('Open files (gemini)', 'ls -la /proc/$(pgrep -f gemini | head -1)/fd 2>/dev/null || echo "no gemini process"');
        await runDiag('Network connections', 'cat /proc/net/tcp 2>/dev/null | head -20 || echo "no /proc/net/tcp"');
        await runDiag('Memory', 'cat /proc/meminfo 2>/dev/null | head -5 || echo "no meminfo"');
        await runDiag('Disk', 'df -h /workspace 2>/dev/null || echo "no df"');

        return lines.join('\n');
    }
}
