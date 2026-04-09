import { Grader } from './index';
import { GraderConfig, GraderResult, EnvironmentProvider } from '../types';

export class ToolUsageGrader implements Grader {
    async grade(
        workspace: string,
        provider: EnvironmentProvider,
        config: GraderConfig,
        _taskPath: string,
        _sessionLog: any[],
        env?: Record<string, string>
    ): Promise<GraderResult> {
        const expectedTools = config.expectedTools || [];

        if (expectedTools.length === 0) {
            return {
                grader_type: 'tool_usage',
                score: 1.0,
                weight: config.weight,
                details: 'No tools expected.'
            };
        }

        // Read .tool_calls.log from workspace
        const result = await provider.runCommand(workspace, 'cat .tool_calls.log', env);

        if (result.exitCode !== 0) {
            // If file doesn't exist, it might mean no tools were called!
            // Let's check if the file exists first or handle the error.
            // If cat fails because file doesn't exist, it usually means no tools were called.
            // So calledTools is empty.
            // Let's check if stderr contains "No such file or directory".
            if (result.stderr.includes('No such file or directory')) {
                const expectedStrs = expectedTools.map(t => `${t.name}${t.args ? `(${JSON.stringify(t.args)})` : ''}`);
                return {
                    grader_type: 'tool_usage',
                    score: 0.0,
                    weight: config.weight,
                    details: `Missing expected tools: ${expectedStrs.join(', ')}. No tools were called.`
                };
            }

            return {
                grader_type: 'tool_usage',
                score: 0.0,
                weight: config.weight,
                details: `Failed to read .tool_calls.log. Exit code: ${result.exitCode}. Stderr: ${result.stderr.trim()}`
            };
        }

        const lines = result.stdout.split('\n');
        const calledTools: { name: string, args: Record<string, any> }[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const event = JSON.parse(trimmed);
                if (event.type === 'tool_use') {
                    const toolName = event.tool_name || event.name || (event.tool_use && event.tool_use.name);
                    const parameters = event.parameters || event.args || (event.tool_use && event.tool_use.args) || {};
                    if (toolName) {
                        calledTools.push({ name: toolName, args: parameters });
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        const missingTools: string[] = [];

        for (const et of expectedTools) {
            const expectedName = et.name;
            const expectedArgs = et.args;

            const found = calledTools.find(ct => {
                if (ct.name !== expectedName) return false;
                if (!expectedArgs) return true; // Name match is enough if no args expected

                // Check if expectedArgs is a subset of ct.args
                return isSubset(expectedArgs, ct.args);
            });

            if (!found) {
                missingTools.push(`${et.name}${et.args ? `(${JSON.stringify(et.args)})` : ''}`);
            }
        }

        if (missingTools.length === 0) {
            const expectedStrs = expectedTools.map(t => `${t.name}${t.args ? `(${JSON.stringify(t.args)})` : ''}`);
            return {
                grader_type: 'tool_usage',
                score: 1.0,
                weight: config.weight,
                details: `All expected tools were called: ${expectedStrs.join(', ')}`
            };
        } else {
            const calledStrs = calledTools.map(t => `${t.name}(${JSON.stringify(t.args)})`);
            return {
                grader_type: 'tool_usage',
                score: 0.0,
                weight: config.weight,
                details: `Missing expected tools: ${missingTools.join(', ')}. Called tools: ${calledStrs.join(', ')}`
            };
        }
    }
}

function isSubset(subset: Record<string, any>, superset: Record<string, any>): boolean {
    for (const key in subset) {
        if (subset.hasOwnProperty(key)) {
            const val = subset[key];
            const superVal = superset[key];
            if (typeof val === 'object' && val !== null) {
                if (typeof superVal !== 'object' || superVal === null) return false;
                if (!isSubset(val, superVal)) return false;
            } else if (val !== superVal) {
                return false;
            }
        }
    }
    return true;
}
