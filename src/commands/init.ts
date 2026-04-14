/**
 * `skillgrade init` command.
 *
 * Detects skills in the current directory and generates an eval.yaml template.
 * With an API key, uses an LLM to generate intelligent eval tasks.
 * Without an API key, generates a well-commented template.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { detectSkills } from '../core/skills';
import { parseEnvFile } from '../utils/env';

export async function runInit(dir: string, opts: { force?: boolean, config?: string } = {}) {
  const filename = opts.config || 'eval.yaml';
  const evalPath = path.isAbsolute(filename) ? filename : path.join(dir, filename);
  const displayFilename = path.basename(evalPath);

  if (await fs.pathExists(evalPath)) {
    if (opts.force) {
      await fs.remove(evalPath);
    } else {
      console.error(`  ${displayFilename} already exists. Use --force to overwrite.`);
      throw new Error(`${displayFilename} already exists`);
    }
  }

  console.log('\nskillgrade init\n');

  // Detect skills
  const skills = await detectSkills(dir);

  if (skills.length === 0) {
    console.log('  No SKILL.md found. Creating a generic template.');
    console.log('     Place a SKILL.md in this directory for better scaffolding.\n');
    await writeTemplate(evalPath, 'my-skill', 'Describe what the agent should do with this skill.');
    return;
  }

  console.log(`  Found ${skills.length} skill(s): ${skills.map(s => s.name).join(', ')}\n`);

  // Load .env file if present
  const envPath = path.join(dir, '.env');
  if (await fs.pathExists(envPath)) {
    const envVars = parseEnvFile(await fs.readFile(envPath, 'utf-8'));
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // Try LLM-powered scaffold — auto-detect from available API key
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const llmProvider = geminiKey ? 'gemini' : anthropicKey ? 'anthropic' : openaiKey ? 'openai' : null;
  const llmApiKey = geminiKey || anthropicKey || openaiKey;

  const providerLabel: Record<string, string> = { gemini: 'Gemini', anthropic: 'Anthropic', openai: 'OpenAI' };

  if (llmProvider && llmApiKey) {
    const { Spinner, fmt } = await import('../utils/cli');
    const spinner = new Spinner('init', `generating eval with ${providerLabel[llmProvider]}`);
    try {
      const config = await generateWithLLM(skills, llmApiKey, llmProvider);
      await fs.writeFile(evalPath, config, 'utf-8');
      spinner.stop(fmt.green(`created ${displayFilename}`));
      const cmd = opts.config ? `skillgrade --config=${opts.config}` : 'skillgrade';
      console.log(`     Review and edit the file, then run: ${cmd}\n`);
      return;
    } catch (err: any) {
      spinner.stop(fmt.red(`AI generation failed: ${err.message}`));
      console.log('     Falling back to template.\n');
    }
  } else {
    console.log('  Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY for AI-powered eval generation.\n');
  }

  // Fallback: template-based scaffold
  const skill = skills[0];
  const taskName = `test-${skill.name}`;
  const instruction = extractInstructionHint(skill.skillMd);
  await writeTemplate(evalPath, taskName, instruction, opts.config);
}

async function writeTemplate(evalPath: string, taskName: string, instruction: string, configFilename?: string) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'eval.yaml.template');
  let template: string;

  if (await fs.pathExists(templatePath)) {
    template = await fs.readFile(templatePath, 'utf-8');
  } else {
    // Inline fallback if template file not found (e.g., if installed globally)
    template = getInlineTemplate();
  }

  const result = template
    .replace(/\{\{TASK_NAME\}\}/g, taskName)
    .replace(/\{\{INSTRUCTION\}\}/g, instruction);

  const displayFilename = path.basename(evalPath);
  await fs.writeFile(evalPath, result, 'utf-8');
  console.log(`  Created ${displayFilename}.`);
  const cmd = configFilename ? `skillgrade --config=${configFilename}` : 'skillgrade';
  console.log(`     Edit the file to define your eval tasks, then run: ${cmd}\n`);
}

/**
 * Extract a reasonable instruction hint from SKILL.md content.
 */
function extractInstructionHint(skillMd: string): string {
  // Try to get the first paragraph after the main heading
  const lines = skillMd.split('\n');
  let foundHeading = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('# ') && !foundHeading) {
      foundHeading = true;
      continue;
    }
    if (foundHeading) {
      if (line.trim() === '' && paragraphLines.length > 0) break;
      if (line.startsWith('#')) break;
      if (line.trim()) paragraphLines.push(line.trim());
    }
  }

  if (paragraphLines.length > 0) {
    return `TODO: Write an instruction based on this skill.\n      Skill description: ${paragraphLines.join(' ')}`;
  }

  return 'TODO: Write an instruction for the agent.';
}

/**
 * Generate eval.yaml content using Gemini API.
 */
async function generateWithLLM(
  skills: Array<{ name: string; skillMd: string }>,
  apiKey: string,
  provider: 'gemini' | 'anthropic' | 'openai' = 'gemini'
): Promise<string> {
  const skillSummaries = skills.map(s =>
    `## Skill: ${s.name}\n\n${s.skillMd}`
  ).join('\n\n---\n\n');

  const prompt = `You are an expert at creating evaluation tasks for AI agent skills.

Given the following skill definition(s), generate an eval.yaml file that defines 1-2 evaluation tasks to test whether an AI agent correctly discovers and uses the skill.

For each task:
- Write a realistic instruction (what a user would ask the agent to do)
- Define workspace files if needed (fixture files the agent works on)
- Write a deterministic grader (shell script that outputs JSON to stdout)
- Write an LLM rubric (criteria for the LLM judge)

IMPORTANT GRADING RULES:
- Deterministic graders MUST output JSON to stdout: {"score": 0.0-1.0, "details": "...", "checks": [...]}
- Do NOT use exit codes for scoring. The grader should always exit 0 and report the score in JSON.
- Use awk for floating point arithmetic (bc is not available in node:20-slim).
- The "checks" array is optional but recommended for per-check breakdown.
- For workspace files, only reference files that exist in the skill directory or that the agent will create.

CRITICAL — FILENAME CONSISTENCY:
- The instruction MUST tell the agent exactly what filenames to create (e.g., "Save the result as output.txt").
- The deterministic grader MUST only check for filenames that are explicitly mentioned in the instruction.
- NEVER check for a hardcoded filename that the instruction does not mention — the agent will choose its own names and the grader will fail.
- Example: if the grader checks for "output.html", the instruction must say "Save the HTML file as output.html".

${skillSummaries}

Respond with ONLY the eval.yaml content. Use this exact format:

version: "1"

defaults:
  agent: gemini
  provider: docker
  trials: 5
  timeout: 300
  threshold: 0.8
  docker:
    base: node:20-slim

tasks:
  - name: <descriptive-task-name>
    instruction: |
      <realistic user instruction>
      Save <expected output> as <exact-filename>.
    workspace:
      # Files to copy into the agent's workspace (optional).
      # Use string shorthand or src/dest objects:
      # - fixtures/app.js                    # copies as app.js
      # - src: templates/viewer.html
      #   dest: templates/viewer.html
    graders:
      - type: deterministic
        run: |
          # Check conditions and output JSON
          passed=0
          total=2
          c1_pass=false c1_msg="Check 1 failed"
          c2_pass=false c2_msg="Check 2 failed"

          if <check1>; then
            passed=$((passed + 1))
            c1_pass=true; c1_msg="Check 1 passed"
          fi

          if <check2>; then
            passed=$((passed + 1))
            c2_pass=true; c2_msg="Check 2 passed"
          fi

          score=$(awk "BEGIN {printf \\"%.2f\\", $passed/$total}")
          echo "{\\"score\\":$score,\\"details\\":\\"$passed/$total checks passed\\",\\"checks\\":[{\\"name\\":\\"check1\\",\\"passed\\":$c1_pass,\\"message\\":\\"$c1_msg\\"},{\\"name\\":\\"check2\\",\\"passed\\":$c2_pass,\\"message\\":\\"$c2_msg\\"}]}"
        weight: 0.7
      - type: llm_rubric
        rubric: |
          <evaluation criteria>
        weight: 0.3`;

  let text: string;
  const fetchOpts = { signal: AbortSignal.timeout(120_000) };

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
      ...fetchOpts,
    });

    if (!response.ok) {
      throw new Error(`Anthropic API returned ${response.status}`);
    }

    const data = await response.json() as any;
    text = data.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Anthropic API');
  } else if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
      ...fetchOpts,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API returned ${response.status}`);
    }

    const data = await response.json() as any;
    text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from OpenAI API');
  } else {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
      ...fetchOpts,
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json() as any;
    text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini API');
  }

  // Extract YAML from response (strip markdown code fences if present)
  const yamlContent = text.replace(/```ya?ml\n?/g, '').replace(/```\n?/g, '').trim();
  return yamlContent + '\n';
}

function getInlineTemplate(): string {
  return `version: "1"

defaults:
  agent: gemini
  provider: docker
  trials: 5
  timeout: 300
  threshold: 0.8
  docker:
    base: node:20-slim

tasks:
  - name: {{TASK_NAME}}
    instruction: |
      {{INSTRUCTION}}

    graders:
      - type: deterministic
        run: |
          # Grader must output JSON: {"score": 0.0-1.0, "details": "...", "checks": [...]}
          echo '{"score": 0.0, "details": "TODO: implement grader"}'
        weight: 0.7

      - type: llm_rubric
        rubric: |
          TODO: Write evaluation criteria.
        weight: 0.3
`;
}
