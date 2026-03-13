/**
 * Grader calibration test: 12 transcript variants against qwen3:4b with think:false.
 * Tests evidence-grounded prompt for partial-credit discrimination.
 * Run: node tests/grader-calibration.mjs
 */
const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
const model = process.env.GRADER_MODEL || 'qwen3:4b';

const rubric = `# Code Quality Rubric for SuperLint Task
## Workflow Compliance (0-0.4)
- Did the agent follow the mandatory 3-step workflow (check -> fix -> verify)?
- Did the agent run superlint check before attempting fixes?
- Did the agent use superlint fix --target app.js (not manual edits)?
- Did the agent run superlint verify as the final step?
## Tool Discovery (0-0.3)
- Did the agent discover and read the skill documentation?
- Did the agent explore available commands before acting?
- Did the agent avoid using tools not specified in the instructions (e.g., eslint)?
## Efficiency (0-0.3)
- Was the task completed in a reasonable number of commands?
- Did the agent avoid unnecessary trial-and-error?
- Did the agent avoid redundant operations?`;

const variants = [
  { name: '1. PERFECT (check+fix+verify)',     expect: [0.85, 1.0],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint check\nFound 3 issues in app.js\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n$ superlint verify\nAll checks passed. 0 issues remaining.\n## Agent Output\nI ran check, fix, then verify.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '2. MISSING CHECK (fix+verify)',      expect: [0.3, 0.65],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n$ superlint verify\nAll checks passed. 0 issues remaining.\n## Agent Output\nI fixed and verified.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '3. MISSING VERIFY (check+fix)',      expect: [0.3, 0.65],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint check\nFound 3 issues in app.js\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n## Agent Output\nI checked and fixed but forgot to verify.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '4. ONLY CHECK',                      expect: [0.05, 0.35],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint check\nFound 3 issues in app.js\n## Agent Output\nI checked the code.\n## Prior Grader Results (automated tests)\n- deterministic: score=0.00 - Failed` },
  { name: '5. ONLY VERIFY',                     expect: [0.0, 0.25],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint verify\nAll checks passed. 0 issues remaining.\n## Agent Output\nI verified the code.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '6. ONLY FIX',                        expect: [0.1, 0.4],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n## Agent Output\nI fixed the code.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '7. ALL 3 + ESLINT (extra tool)',     expect: [0.6, 0.85],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint check\nFound 3 issues in app.js\n$ eslint app.js\nNo errors found.\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n$ superlint verify\nAll checks passed. 0 issues remaining.\n## Agent Output\nI checked with superlint and eslint, then fixed and verified.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '8. CORRECT BUT INEFFICIENT',         expect: [0.55, 0.85],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint check\nFound 3 issues in app.js\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n$ superlint check\nFound 0 issues in app.js\n$ superlint fix --target app.js\nNo issues to fix.\n$ superlint verify\nAll checks passed. 0 issues remaining.\n## Agent Output\nI ran check/fix twice then verified.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '9. WRONG ORDER (verify first)',      expect: [0.2, 0.55],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint verify\n3 issues remain.\n$ superlint check\nFound 3 issues in app.js\n$ superlint fix --target app.js\nFixed 3 issues in app.js\n## Agent Output\nI verified first, then checked and fixed.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '10. MANUAL EDIT (sed instead of fix)', expect: [0.2, 0.55],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ superlint check\nFound 3 issues in app.js\n$ sed -i 's/var/const/g' app.js\n$ superlint verify\nAll checks passed. 0 issues remaining.\n## Agent Output\nI checked, fixed manually with sed, then verified.\n## Prior Grader Results (automated tests)\n- deterministic: score=1.00 - Passed` },
  { name: '11. INCOMPLETE (started, gave up)',  expect: [0.05, 0.25],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Commands Executed\n$ ls\napp.js  package.json\n$ superlint check\nFound 3 issues in app.js\n## Agent Output\nI found 3 issues but I am not sure how to fix them.\n## Prior Grader Results (automated tests)\n- deterministic: score=0.00 - Failed` },
  { name: '12. EMPTY (did nothing)',            expect: [0.0, 0.05],
    transcript: `## Task Instruction\nUse the superlint CLI tool to check, fix, and verify app.js.\n## Agent Output\nI was unable to complete the task.\n## Prior Grader Results (automated tests)\n- deterministic: score=0.00 - Failed` },
];

// Extract criteria from rubric, tracking section headers (mirrors parseResponse logic)
const criteriaLines = [];
const criteriaSections = new Map();
let currentSection = '';

for (const rawLine of rubric.split('\n')) {
  const line = rawLine.trim();
  const sectionMatch = line.match(/^#{1,3}\s+(.+)/);

  if (sectionMatch) {
    currentSection = sectionMatch[1].toLowerCase();
  } else if (line.startsWith('- ')) {
    const criterion = line.replace(/^- /, '');
    criteriaLines.push(criterion);
    criteriaSections.set(criterion, currentSection);
  }
}

const numberedCriteria = criteriaLines
  .map((c, i) => `${i + 1}. ${c}`)
  .join('\n');

function buildPrompt(transcript) {
  return `You are an evaluation judge. Evaluate the agent session below.

STEP 1 -- EXTRACT EVIDENCE: List every shell command the agent actually ran (from "Commands Executed" section). Only include commands that appear verbatim. If none, return an empty array.

STEP 2 -- CHECK EACH CRITERION: For each numbered criterion below, answer true ONLY if the commands_found evidence directly supports it. Answer false otherwise.

## Criteria to evaluate (answer ALL ${criteriaLines.length}):
${numberedCriteria}

## Session Transcript
${transcript}

Respond with ONLY a JSON object: {"commands_found": ["cmd1", ...], "criteria": [{"criterion": "<exact criterion text>", "met": true/false}, ...], "reasoning": "<brief explanation>"}`;
}

async function grade(v) {
  const start = Date.now();
  const resp = await fetch(host + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(v.transcript),
      stream: false,
      think: false,
      format: {
        type: 'object',
        properties: {
          commands_found: { type: 'array', items: { type: 'string' } },
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                criterion: { type: 'string' },
                met: { type: 'boolean' },
              },
              required: ['criterion', 'met'],
            },
          },
          reasoning: { type: 'string' },
        },
        required: ['commands_found', 'criteria', 'reasoning'],
      },
      options: { temperature: 0, num_predict: 512, num_ctx: 4096 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const data = await resp.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const text = data?.response || data?.thinking || '';

  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { commands_found: [], criteria: [], reasoning: 'no JSON in response' };
  } catch {
    parsed = { commands_found: [], criteria: [], reasoning: 'parse error: ' + text.substring(0, 100) };
  }

  // Compute score using dimension-aware weighting (matches parseResponse logic)
  let score;
  if (Array.isArray(parsed.criteria) && parsed.criteria.length > 0) {
    // Section-based classification (must match parseResponse in src/graders/index.ts)
    const sectionOf = (criterion) => {
      const exact = criteriaSections.get(criterion);

      if (exact) {
        return exact;
      }

      const needle = criterion.toLowerCase().substring(0, 40);

      for (const [rubricCriterion, section] of criteriaSections) {
        if (rubricCriterion.toLowerCase().substring(0, 40) === needle) {
          return section;
        }
      }

      return '';
    };

    // Must match parseResponse in src/graders/index.ts
    const isWorkflow = (criterion) => {
      const section = sectionOf(criterion);

      if (section) {
        return /workflow|compliance|procedure|protocol|pipeline|process.*step|step.*process/i.test(section);
      }

      return /workflow|compliance|mandatory|procedure|protocol|pipeline/i.test(criterion);
    };

    const isEfficiency = (criterion) => {
      const section = sectionOf(criterion);

      if (section) {
        return /efficien|overhead|resource.*usage/i.test(section);
      }

      return /efficien|redundan|trial.and.error|reasonable.*command|unnecessary|extraneous|superfluous|wasteful|excess/i.test(criterion);
    };

    // Technique A: Workflow gate for efficiency
    const workflowCriteria = parsed.criteria.filter(c => isWorkflow(c.criterion));
    const workflowMet = workflowCriteria.filter(c => c.met).length;
    const workflowPct = workflowCriteria.length > 0 ? workflowMet / workflowCriteria.length : 0;
    if (workflowPct < 0.5) {
      for (const c of parsed.criteria) {
        if (isEfficiency(c.criterion) && c.met) { c.met = false; }
      }
    }

    // Technique E: Intra-section entailment (must match parseResponse)
    const summaryPattern = /\b\d+-step\b|workflow|process|procedure|pipeline|protocol|sequence|lifecycle/i;
    for (const c of parsed.criteria) {
      if (!c.met || !summaryPattern.test(c.criterion)) { continue; }
      const section = sectionOf(c.criterion);
      if (!section) { continue; }
      const siblingFailed = parsed.criteria.some(
        s => s !== c && sectionOf(s.criterion) === section && !s.met
      );
      if (siblingFailed) { c.met = false; }
    }

    // Technique C: Weighted scoring - workflow 2x
    let weightedMet = 0, weightedTotal = 0;
    for (const c of parsed.criteria) {
      const w = isWorkflow(c.criterion) ? 2.0 : 1.0;
      weightedTotal += w;
      if (c.met) { weightedMet += w; }
    }
    score = weightedTotal > 0 ? weightedMet / weightedTotal : 0;

    // Technique D: Score cap if mandatory workflow not followed (must match parseResponse)
    const workflowSynonyms = /workflow|process|procedure|protocol|pipeline/i;
    const workflowFollowed = parsed.criteria.find(c =>
      /mandatory|follow|required|prescribed|correct|proper/i.test(c.criterion)
      && workflowSynonyms.test(c.criterion)
    );
    if (workflowFollowed && !workflowFollowed.met) { score = Math.min(score, 0.4); }
  } else {
    score = parsed.score !== undefined ? parsed.score : -1;
  }
  score = Math.round(score * 1000) / 1000;

  const checklist = (parsed.criteria || []).map(c => `${c.met ? '[OK]' : '[  ]'} ${c.criterion}`).join('\n       ');
  const inRange = score >= v.expect[0] && score <= v.expect[1];
  return { ...v, score, cmds: parsed.commands_found, reasoning: parsed.reasoning, checklist, time: elapsed, inRange, criteriaCount: (parsed.criteria || []).length };
}

console.log(`\nGrader Calibration Test (model: ${model})\n`);

const results = [];
for (const v of variants) {
  const r = await grade(v);
  const status = r.inRange ? '[OK]' : '[MISS]';
  console.log(`${status} ${r.name}: ${r.score} (${r.criteriaCount} criteria, expect ${r.expect[0]}-${r.expect[1]}) [${r.time}s]`);
  console.log(`     cmds: ${JSON.stringify(r.cmds)}`);
  if (r.checklist) { console.log(`     checks:\n       ${r.checklist}`); }
  console.log(`     reason: ${(r.reasoning || '').substring(0, 150)}`);
  results.push(r);
}

// Summary
console.log('\n=== SUMMARY ===');
console.log('Variant                                   | Score | Range       | Status | Time');
console.log('------------------------------------------|-------|-------------|--------|------');
for (const r of results) {
  const name = r.name.substring(0, 42).padEnd(42);
  const score = String(r.score).padStart(5);
  const range = `${r.expect[0]}-${r.expect[1]}`.padEnd(11);
  const status = r.inRange ? '  [OK] ' : ' [MISS]';
  console.log(`${name} | ${score} | ${range} | ${status} | ${r.time}s`);
}

const hits = results.filter(r => r.inRange).length;
const total = results.length;
console.log(`\nCalibration: ${hits}/${total} variants in expected range`);

// Monotonicity checks
const perfect = results[0].score;
const incomplete = results[10].score;
const empty = results[11].score;
const onlyCheck = results[3].score;
console.log(`\nMonotonicity: perfect(${perfect}) > incomplete(${incomplete}) >= empty(${empty}): ${perfect > incomplete && incomplete >= empty ? 'PASS' : 'FAIL'}`);
console.log(`Discrimination: perfect(${perfect}) > onlyCheck(${onlyCheck}) > empty(${empty}): ${perfect > onlyCheck && onlyCheck > empty ? 'PASS' : 'FAIL'}`);
