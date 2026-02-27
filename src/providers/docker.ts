import Docker from 'dockerode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as tar from 'tar-stream';
import { EnvironmentProvider, CommandResult, TaskConfig } from '../types';

export class DockerProvider implements EnvironmentProvider {
    private docker: Docker;

    constructor() {
        this.docker = new Docker();
    }

    async setup(taskPath: string, skillsPaths: string[], taskConfig: TaskConfig, env?: Record<string, string>): Promise<string> {
        const imageName = `skill-eval-${path.basename(taskPath)}-${Date.now()}`;

        console.log(`Building image ${imageName}...`);
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
        let imageId: string | undefined;

        try {
            const info = await container.inspect();
            imageId = info.Image;
        } catch (e) {
            console.warn(`Failed to inspect container ${containerId}: ${e}`);
        }

        try {
            await container.stop();
        } catch (e) {
            // Container may already be stopped
        }

        try {
            await container.remove({ force: true });
        } catch (e) {
            console.warn(`Failed to remove container ${containerId}: ${e}`);
        }

        if (imageId) {
            try {
                const image = this.docker.getImage(imageId);
                await image.remove({ force: true });
            } catch (e) {
                console.warn(`Failed to remove image ${imageId}: ${e}`);
            }
        }
    }
}
