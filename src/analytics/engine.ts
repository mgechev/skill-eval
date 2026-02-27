import * as fs from 'fs-extra';
import * as path from 'path';
import { EvalReport } from '../types';

export interface AggregateStats {
    task: string;
    passRateNoSkill: number;
    passRateWithSkill: number;
    normalizedGain: number;
    avgDurationMs: number;
    avgCommands: number;
}

/**
 * Calculates Normalized Gain (NG) as defined in the SkillsBench paper.
 * NG = (p_with - p_without) / (1 - p_without)
 */
export function calculateNormalizedGain(pWith: number, pWithout: number): number {
    if (pWithout === 1) {
        return pWith === 1 ? 0 : -1;
    }
    return (pWith - pWithout) / (1 - pWithout);
}

export class AnalyticsEngine {
    async loadReports(logDir: string): Promise<EvalReport[]> {
        const files = await fs.readdir(logDir);
        const reports: EvalReport[] = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const report = await fs.readJSON(path.join(logDir, file));
                reports.push(report);
            }
        }

        return reports;
    }

    aggregate(reports: EvalReport[]): AggregateStats[] {
        const taskGroups: Record<string, {
            withSkill: EvalReport[];
            withoutSkill: EvalReport[];
        }> = {};

        for (const report of reports) {
            if (!taskGroups[report.task]) {
                taskGroups[report.task] = { withSkill: [], withoutSkill: [] };
            }

            const hasSkills = report.skills_used && report.skills_used.length > 0;
            if (hasSkills) {
                taskGroups[report.task].withSkill.push(report);
            } else {
                taskGroups[report.task].withoutSkill.push(report);
            }
        }

        const stats: AggregateStats[] = [];

        for (const [task, data] of Object.entries(taskGroups)) {
            const allReports = [...data.withSkill, ...data.withoutSkill];

            const avgWith = data.withSkill.length > 0
                ? data.withSkill.reduce((a, b) => a + b.pass_rate, 0) / data.withSkill.length
                : 0;
            const avgWithout = data.withoutSkill.length > 0
                ? data.withoutSkill.reduce((a, b) => a + b.pass_rate, 0) / data.withoutSkill.length
                : 0;

            const allTrials = allReports.flatMap(r => r.trials);
            const avgDurationMs = allTrials.length > 0
                ? allTrials.reduce((s, t) => s + (t.duration_ms || 0), 0) / allTrials.length
                : 0;
            const avgCommands = allTrials.length > 0
                ? allTrials.reduce((s, t) => s + (t.n_commands || 0), 0) / allTrials.length
                : 0;

            stats.push({
                task,
                passRateWithSkill: avgWith,
                passRateNoSkill: avgWithout,
                normalizedGain: calculateNormalizedGain(avgWith, avgWithout),
                avgDurationMs,
                avgCommands
            });
        }

        return stats;
    }
}
