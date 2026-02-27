import { calculateNormalizedGain, AnalyticsEngine } from '../src/analytics/engine';
import { EvalReport } from '../src/types';

async function testAnalytics() {
    console.log('--- Testing Analytics Logic ---');

    // 1. Test NG Calculation
    const testCases = [
        { with: 1.0, without: 0.5, expected: 1.0 },
        { with: 0.75, without: 0.5, expected: 0.5 },
        { with: 0.5, without: 0.5, expected: 0.0 },
        { with: 0.25, without: 0.5, expected: -0.5 },
    ];

    for (const tc of testCases) {
        const ng = calculateNormalizedGain(tc.with, tc.without);
        if (Math.abs(ng - tc.expected) < 0.001) {
            console.log(`SUCCESS: NG(${tc.with}, ${tc.without}) = ${ng}`);
        } else {
            console.error(`FAILURE: NG(${tc.with}, ${tc.without}) = ${ng}, expected ${tc.expected}`);
            process.exit(1);
        }
    }

    // 2. Test Aggregation
    const mockReports: EvalReport[] = [
        { task: 'task1', pass_rate: 0.5, pass_at_k: 0.5, pass_pow_k: 0.5, trials: [], skills_used: [] },
        { task: 'task1', pass_rate: 1.0, pass_at_k: 1.0, pass_pow_k: 1.0, trials: [], skills_used: ['skill1'] },
        { task: 'task2', pass_rate: 0.0, pass_at_k: 0.0, pass_pow_k: 0.0, trials: [], skills_used: [] },
        { task: 'task2', pass_rate: 0.5, pass_at_k: 0.5, pass_pow_k: 0.5, trials: [], skills_used: ['skill1'] },
    ];

    const engine = new AnalyticsEngine();
    const stats = engine.aggregate(mockReports);

    console.log('Aggregated Stats:', JSON.stringify(stats, null, 2));

    if (stats.find(s => s.task === 'task1')?.normalizedGain === 1.0 &&
        stats.find(s => s.task === 'task2')?.normalizedGain === 0.5) {
        console.log('SUCCESS: Aggregation verified!');
    } else {
        console.error('FAILURE: Aggregation results incorrect');
        process.exit(1);
    }
}

testAnalytics();
