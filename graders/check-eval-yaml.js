/**
 * Deterministic grader for the create-eval-config task.
 * Validates that the agent produced a valid eval.yaml.
 */
const fs = require('fs');

function run() {
    const checks = [];
    let passed = 0;
    const total = 5;

    // Check 1: eval.yaml exists
    const exists = fs.existsSync('eval.yaml');
    if (exists) passed++;
    checks.push({ name: 'file-exists', passed: exists, message: exists ? 'eval.yaml exists' : 'eval.yaml not found' });

    if (!exists) {
        console.log(JSON.stringify({ score: 0, details: '0/5 checks passed — eval.yaml not found', checks }));
        return;
    }

    const content = fs.readFileSync('eval.yaml', 'utf8');

    // Check 2: has version field
    const hasVersion = /version:\s*["']?1["']?/.test(content);
    if (hasVersion) passed++;
    checks.push({ name: 'has-version', passed: hasVersion, message: hasVersion ? 'version: "1" present' : 'Missing version field' });

    // Check 3: has tasks array
    const hasTasks = /^tasks:/m.test(content);
    if (hasTasks) passed++;
    checks.push({ name: 'has-tasks', passed: hasTasks, message: hasTasks ? 'tasks section present' : 'Missing tasks section' });

    // Check 4: has deterministic grader
    const hasDeterministic = /type:\s*deterministic/.test(content);
    if (hasDeterministic) passed++;
    checks.push({ name: 'has-deterministic', passed: hasDeterministic, message: hasDeterministic ? 'Has deterministic grader' : 'Missing deterministic grader' });

    // Check 5: has llm_rubric grader
    const hasLlmRubric = /type:\s*llm_rubric/.test(content);
    if (hasLlmRubric) passed++;
    checks.push({ name: 'has-llm-rubric', passed: hasLlmRubric, message: hasLlmRubric ? 'Has llm_rubric grader' : 'Missing llm_rubric grader' });

    const score = passed / total;
    console.log(JSON.stringify({ score, details: `${passed}/${total} checks passed`, checks }));
}

run();
