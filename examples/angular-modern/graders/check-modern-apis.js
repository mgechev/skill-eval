// graders/check-modern-apis.js
//
// Node.js grader that performs static analysis on an Angular component
// to verify it uses modern APIs. Outputs JSON to stdout.

const fs = require('fs');

const checks = [];
const filePath = 'src/app/user-profile.component.ts';

if (!fs.existsSync(filePath)) {
  console.log(JSON.stringify({
    score: 0,
    details: 'Component file not found',
    checks: [{ name: 'file-exists', passed: false, message: filePath + ' not found' }]
  }));
  process.exit(0);
}

const source = fs.readFileSync(filePath, 'utf-8');

// Check 1: Uses signal-based input() instead of @Input()
const hasSignalInput = /=\s*input[<(]/.test(source);
const hasLegacyInput = /@Input\(\)/.test(source);
checks.push({
  name: 'signal-inputs',
  passed: hasSignalInput && !hasLegacyInput,
  message: hasLegacyInput
    ? 'Still using @Input() decorator'
    : hasSignalInput
      ? 'Uses signal-based input()'
      : 'No inputs found'
});

// Check 2: Uses inject() instead of constructor DI
const usesInject = /=\s*inject\(/.test(source);
const hasConstructorDI = /constructor\s*\([^)]*(?:private|public|protected)\s+\w+/.test(source);
checks.push({
  name: 'inject-function',
  passed: usesInject && !hasConstructorDI,
  message: hasConstructorDI
    ? 'Still using constructor injection'
    : usesInject
      ? 'Uses inject() for DI'
      : 'No DI found'
});

// Check 3: Uses built-in control flow instead of structural directives
const hasBuiltinIf = /@if\s*\(/.test(source);
const hasLegacyNgIf = /\*ngIf/.test(source);
checks.push({
  name: 'builtin-control-flow',
  passed: hasBuiltinIf && !hasLegacyNgIf,
  message: hasLegacyNgIf
    ? 'Still using *ngIf/*ngFor directives'
    : hasBuiltinIf
      ? 'Uses @if/@for built-in control flow'
      : 'No control flow found'
});

// Check 4: Uses output() instead of @Output() + EventEmitter
const hasSignalOutput = /=\s*output[<(]/.test(source);
const hasLegacyOutput = /@Output\(\)/.test(source);
checks.push({
  name: 'signal-outputs',
  passed: hasSignalOutput && !hasLegacyOutput,
  message: hasLegacyOutput
    ? 'Still using @Output() decorator'
    : hasSignalOutput
      ? 'Uses signal-based output()'
      : 'No outputs found'
});

// Check 5: No CommonModule import (not needed with built-in control flow)
const hasCommonModule = /CommonModule/.test(source);
checks.push({
  name: 'no-common-module',
  passed: !hasCommonModule,
  message: hasCommonModule
    ? 'Still importing CommonModule (not needed with built-in control flow)'
    : 'No CommonModule import'
});

// Calculate score
const passed = checks.filter(c => c.passed).length;
const score = parseFloat((passed / checks.length).toFixed(2));

console.log(JSON.stringify({ score, details: passed + '/' + checks.length + ' checks passed', checks }));
