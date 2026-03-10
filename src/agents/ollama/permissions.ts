import picomatch from 'picomatch';
import type { PermissionConfig } from './types';

/**
 * Picomatch options for bash command matching.
 * - dot: true -- match dotfiles/hidden paths in URLs
 * - bash: true -- disable path segment splitting so * matches across /
 */
const MATCH_OPTIONS: picomatch.PicomatchOptions = { dot: true, bash: true };

/**
 * Tier 1: Hardcoded secure denylist -- immutable patterns that can NEVER be overridden.
 * These represent catastrophic or irreversible operations.
 */
export const SECURE_DENYLIST: string[] = [
    'rm -rf /*',
    'rm -rf /',
    'rm -fr /*',
    'rm -fr /',
    'mkfs*',
    'dd if=*of=/dev/*',
    ':(){:|:&};:',
    'chmod -R 777 /*',
    'chmod -R 777 /',
    'wget * | bash',
    'curl * | bash',
    'curl * | sh',
    'wget * | sh',
    'shutdown*',
    'reboot*',
    'halt*',
    'poweroff*',
    'init 0',
    'init 6',
    'kill -9 -1',
    'killall -9 *',
    'pkill -9 *',
    '> /dev/sda',
    'mv /* /dev/null',
    'sudo su*',
    'sudo -i*',
    'sudo bash*',
    'sudo sh*',
];

/**
 * Tier 2: Agent default denylist -- sensible defaults that CAN be overridden by task.toml allowlists.
 */
export const AGENT_DEFAULT_DENYLIST: string[] = [
    'git reset --hard*',
    'git clean -f*',
    'git push --force*',
    'npm audit fix --force*',
    'curl *',
    'curl',
    'wget *',
    'wget',
];

/**
 * Tier 2: Agent default allowlist -- empty by default (allow all minus denylists).
 */
export const AGENT_DEFAULT_ALLOWLIST: string[] = [];

/**
 * Check whether a bash command is allowed under the three-tier permission model.
 *
 * Tier 1: Secure denylist -- always blocks, no override possible.
 * Tier 2+3: Agent defaults merged with task overrides.
 *   - If a command matches the task allowlist, it bypasses the agent denylist (but NOT secure denylist).
 *   - If a command matches the effective denylist and is not in any allowlist, it is blocked.
 *   - If no allowlist entries exist, all commands pass (minus denylists).
 */
export function isCommandAllowed(command: string, config: PermissionConfig): boolean {
    // Tier 1: Hardcoded secure denylist -- NEVER override
    for (const pattern of config.secureDenylist) {
        if (picomatch.isMatch(command, pattern, MATCH_OPTIONS)) {
            return false;
        }
    }

    // Check if command is explicitly allowed by task allowlist (overrides agent denylist)
    const taskAllowed = config.taskAllowlist.length > 0 &&
        config.taskAllowlist.some(pattern => picomatch.isMatch(command, pattern, MATCH_OPTIONS));

    if (taskAllowed) {
        return true;
    }

    // Check agent + task denylists
    const effectiveDenylist = [...config.agentDenylist, ...config.taskDenylist];

    for (const pattern of effectiveDenylist) {
        if (picomatch.isMatch(command, pattern, MATCH_OPTIONS)) {
            return false;
        }
    }

    // If agent allowlist is non-empty, command must match at least one pattern
    if (config.agentAllowlist.length > 0) {
        return config.agentAllowlist.some(pattern => picomatch.isMatch(command, pattern, MATCH_OPTIONS));
    }

    return true;
}
