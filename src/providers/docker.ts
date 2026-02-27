import Docker from 'dockerode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as tar from 'tar-stream';
import { EnvironmentProvider, CommandResult, TaskConfig } from '../types';

export class DockerProvider implements EnvironmentProvider {
    private docker: Docker;
    private imageRefCounts: Map<string, number> = new Map();

    constructor() {
        this.docker = new Docker();
    }

    async setup(taskPath: string, skillsPaths: string[], taskConfig: TaskConfig, env?: Record<string, string>): Promise<string> {
        const imageName = `skill-eval-${path.basename(taskPath)}-${Date.now()}`;

        const stream = await this.docker.buildImage({
            context: taskPath,
            src: ['.']
        }, { t: imageName, dockerfile: 'environment/Dockerfile' });

        const buildResult = await new Promise<any[]>((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err: Error | null, res: any[]) => err ? reject(err) : resolve(res));
        });

        const buildError = buildResult.find((item: any) => item.error || item.errorDetail);
        if (buildError) {
            throw new Error(`Docker build failed: ${buildError.error || buildError.errorDetail?.message || 'Unknown error'}`);
        }

        const envPairs = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [];

        const container = await this.docker.createContainer({
            Image: imageName,
            Cmd: ['tail', '-f', '/dev/null'],
            Env: envPairs,
            Tty: true,
            HostConfig: {
                NanoCpus: taskConfig.environment.cpus * 1e9,
                Memory: taskConfig.environment.memory_mb * 1024 * 1024,
            }
        });

        await container.start();

        // Track image reference count for safe cleanup
        this.imageRefCounts.set(imageName, (this.imageRefCounts.get(imageName) || 0) + 1);

        // Inject skills into agent discovery paths
        if (skillsPaths.length > 0) {
            // Gemini: .agents/skills/  |  Claude: .claude/skills/
            const discoveryDirs = ['/workspace/.agents/skills', '/workspace/.claude/skills'];

            for (const dir of discoveryDirs) {
                const mkdirExec = await container.exec({ Cmd: ['mkdir', '-p', dir], AttachStdout: true, AttachStderr: true });
                const mkdirStream = await mkdirExec.start({});
                await new Promise<void>((resolve) => {
                    mkdirStream.on('end', resolve);
                    mkdirStream.on('error', resolve);
                    mkdirStream.resume();
                });

                for (const skillPath of skillsPaths) {
                    const skillName = path.basename(skillPath);
                    const archive = await this.createTarFromDir(skillPath, skillName);
                    await container.putArchive(archive, { path: dir });
                }
            }
        }

        return container.id;
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

    async cleanup(containerId: string): Promise<void> {
        const container = this.docker.getContainer(containerId);
        let imageName: string | undefined;

        // Get the image name before killing the container
        try {
            const info = await container.inspect();
            // info.Config.Image has the image name (not sha), info.Image has the sha
            imageName = info.Config?.Image || undefined;
        } catch (e) {
            // Container already gone
        }

        // Force-kill then remove (handles timed-out containers still running)
        try {
            await container.kill().catch(() => { });  // kill if running
            await container.remove({ force: true });
        } catch (e) {
            // Already removed
        }

        // Only remove the image when no other containers reference it
        if (imageName) {
            const remaining = (this.imageRefCounts.get(imageName) || 1) - 1;
            this.imageRefCounts.set(imageName, remaining);

            if (remaining <= 0) {
                this.imageRefCounts.delete(imageName);
                try {
                    const image = this.docker.getImage(imageName);
                    await image.remove({ force: true });
                } catch (e) {
                    // Image may already be removed or in use by another process
                }
            }
        }
    }
}
