import Docker from 'dockerode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { EnvironmentProvider } from './core';

export class DockerProvider implements EnvironmentProvider {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async setup(taskPath: string, skillsPaths: string[], env?: Record<string, string>): Promise<string> {
    const imageName = `skill-eval-${path.basename(taskPath)}-${Date.now()}`;

    console.log(`Building image ${imageName}...`);
    // Pass entire task directory as context
    const stream = await this.docker.buildImage({
      context: taskPath,
      src: ['.']
    }, { t: imageName, dockerfile: 'environment/Dockerfile' });

    const buildResult = await new Promise<any[]>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null, res: any[]) => err ? reject(err) : resolve(res));
    });

    // Check for build errors in the result stream
    const buildError = buildResult.find((item: any) => item.error || item.errorDetail);
    if (buildError) {
      throw new Error(`Docker build failed: ${buildError.error || buildError.errorDetail?.message || 'Unknown error'}`);
    }

    const envPairs = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [];

    const container = await this.docker.createContainer({
      Image: imageName,
      Cmd: ['tail', '-f', '/dev/null'], // Keep container running
      Env: envPairs,
      Tty: true
    });

    await container.start();

    // Inject skills
    const skillsDir = '/workspace/.agents/skills';
    const mkdirExec = await container.exec({ Cmd: ['mkdir', '-p', skillsDir], AttachStdout: true, AttachStderr: true });
    await mkdirExec.start({});

    for (const skillPath of skillsPaths) {
      const content = await fs.readFile(skillPath);
      const skillName = path.basename(skillPath);
      // Simplified: we'd ideally use putArchive or similar for robustness, 
      // but for this demo we'll write it directly if possible or skip for now.
      // For now, let's assume skills are doc files we can copy via a tar stream or similar.
    }

    return container.id;
  }

  async runCommand(containerId: string, command: string, env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
      stream.on('data', (chunk) => data += chunk.toString());
      stream.on('end', () => resolve(data));
      stream.on('error', (err) => reject(err));
    });

    const result = await exec.inspect();

    return {
      stdout: output,
      stderr: '', // Docker combined output
      exitCode: result.ExitCode ?? 0
    };
  }

  async cleanup(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      await container.stop();
      await container.remove();

      // Also cleanup the image
      const image = this.docker.getImage(info.Image);
      await image.remove();
    } catch (e) {
      console.warn(`Failed to cleanup container ${containerId}: ${e}`);
    }
  }
}
