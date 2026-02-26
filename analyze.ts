import { AnalyticsEngine } from './analytics';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const logDirArg = args.find(arg => arg.startsWith('--logDir='));
  const logDir = logDirArg ? logDirArg.split('=')[1] : './results';

  console.log(`Analyzing reports in: ${path.resolve(logDir)}`);

  const engine = new AnalyticsEngine();
  try {
    const reports = await engine.loadReports(logDir);
    if (reports.length === 0) {
      console.log('No reports found to analyze.');
      return;
    }

    const stats = engine.aggregate(reports);

    console.log('\n--- SkillsBench Analytics Summary ---');
    console.table(stats.map(s => ({
      Task: s.task,
      'Pass Rate (No Skill)': (s.passRateNoSkill * 100).toFixed(1) + '%',
      'Pass Rate (With Skill)': (s.passRateWithSkill * 100).toFixed(1) + '%',
      'Normalized Gain': s.normalizedGain.toFixed(2)
    })));
  } catch (e) {
    console.error('Analysis failed:', e);
  }
}

main();
