import * as path from 'path';
import * as fs from 'fs';
import * as fse from 'fs-extra';
import type { Tool } from 'ollama';
import type { CommandResult } from '../../types';
import type { PermissionConfig, ToolExecutor } from './types';
import { isCommandAllowed } from './permissions';

/**
 * The four agent tools with JSON Schema parameter definitions.
 */
export const AGENT_TOOLS: Tool[] = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file at the given path relative to the workspace root.',
            parameters: {
                type: 'object',
                required: ['path'],
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
                    limit: { type: 'number', description: 'Maximum number of lines to read' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file at the given path relative to the workspace root.',
            parameters: {
                type: 'object',
                required: ['path', 'content'],
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    content: { type: 'string', description: 'Content to write to the file' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'bash',
            description: 'Run a bash command in the workspace directory.',
            parameters: {
                type: 'object',
                required: ['command'],
                properties: {
                    command: { type: 'string', description: 'The bash command to execute' },
                    timeout: { type: 'number', description: 'Timeout in seconds (default: 60)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List files and directories at the given path relative to the workspace root.',
            parameters: {
                type: 'object',
                required: ['path'],
                properties: {
                    path: { type: 'string', description: 'Directory path relative to workspace root (use "." for root)' },
                },
            },
        },
    },
];

/**
 * Resolve a relative path against the workspace root, rejecting any path that escapes.
 * Also resolves symlinks to prevent symlink-based traversal attacks.
 *
 * @throws Error if the resolved path is outside the workspace boundary.
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
    const resolved = path.resolve(workspaceRoot, relativePath);
    const normalizedResolved = path.normalize(resolved);
    const normalizedRoot = path.normalize(workspaceRoot);

    if (normalizedResolved !== normalizedRoot &&
        !normalizedResolved.startsWith(normalizedRoot + path.sep)) {
        throw new Error(`Path traversal blocked: "${relativePath}" resolves outside workspace`);
    }

    // If the path exists on disk, verify the real path (catches symlink attacks)
    try {
        const realPath = fs.realpathSync(normalizedResolved);
        const realRoot = fs.realpathSync(normalizedRoot);

        if (realPath !== realRoot && !realPath.startsWith(realRoot + path.sep)) {
            throw new Error(`Path traversal blocked: "${relativePath}" symlink resolves outside workspace`);
        }
    } catch (e: any) {
        // If file doesn't exist yet, realpath will throw -- that's fine for write operations
        if (e.code !== 'ENOENT') {
            throw e;
        }
    }

    return normalizedResolved;
}

/**
 * Truncate tool output using head/tail strategy with a middle marker.
 */
export function truncateToolOutput(output: string, maxChars: number = 8000): string {
    if (output.length <= maxChars) {
        return output;
    }

    const half = Math.floor(maxChars / 2);

    return (
        output.substring(0, half) +
        `\n\n... [truncated ${output.length - maxChars} characters] ...\n\n` +
        output.substring(output.length - half)
    );
}

/**
 * Create a tool executor factory that dispatches tool calls to the correct implementation.
 */
export function createToolExecutor(
    workspaceRoot: string,
    runCommand: (cmd: string) => Promise<CommandResult>,
    permissionConfig: PermissionConfig
): ToolExecutor {
    return async (name: string, args: Record<string, unknown>): Promise<string> => {
        switch (name) {
            case 'read_file': {
                const filePath = resolveWorkspacePath(workspaceRoot, args.path as string);
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const offset = typeof args.offset === 'number' ? args.offset - 1 : 0;
                const limit = typeof args.limit === 'number' ? args.limit : lines.length;
                const selected = lines.slice(Math.max(0, offset), offset + limit);

                return truncateToolOutput(selected.join('\n'));
            }

            case 'write_file': {
                const filePath = resolveWorkspacePath(workspaceRoot, args.path as string);
                fse.ensureDirSync(path.dirname(filePath));
                fs.writeFileSync(filePath, args.content as string, 'utf-8');

                return `File written: ${args.path}`;
            }

            case 'list_directory': {
                const dirPath = resolveWorkspacePath(workspaceRoot, args.path as string);
                const entries = fs.readdirSync(dirPath);

                return truncateToolOutput(entries.join('\n'));
            }

            case 'bash': {
                const command = args.command as string;

                if (!isCommandAllowed(command, permissionConfig)) {
                    return `Error: Command not allowed by permission policy: ${command}`;
                }

                const result = await runCommand(command);

                return truncateToolOutput(
                    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}\nexit code: ${result.exitCode}`
                );
            }

            default:
                return `Error: Unknown tool "${name}"`;
        }
    };
}
