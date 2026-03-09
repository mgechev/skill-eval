---
status: resolved
trigger: "LocalProvider PATH augmentation fails from PowerShell — workspace bin/ not preceding /usr/bin, custom env vars empty"
created: 2026-03-09T00:00:00Z
updated: 2026-03-09T13:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - When spawned from PowerShell, spawn('bash') resolves to WSL bash (C:\WINDOWS\system32\bash.exe) instead of Git Bash (C:\Program Files\Git\usr\bin\bash.exe). WSL bash reconstructs PATH from Linux defaults and drops Windows env vars.
test: Fix applied and self-verified (4/4 tests pass from Git Bash)
expecting: All 4 tests should also pass from PowerShell with the fix
next_action: User verification from PowerShell terminal

## Symptoms

expected: workspace bin/ directory prepended to PATH (preceding /usr/bin); custom env vars like MY_CUSTOM_VAR=hello preserved in child bash process
actual: Test 1 FAIL - workspace bin/ at idx 9, /usr/bin at idx 3. Test 3 FAIL - MY_CUSTOM_VAR is empty string instead of 'hello'. Tests 2 and 4 PASS.
errors: "Expected workspace bin/ (idx 9) to precede /usr/bin (idx 3) in PATH" and "Expected 'hello', got ''"
reproduction: Run `npx ts-node tests/local-provider.test.ts` from PowerShell. All 4 pass from Git Bash; tests 1 and 3 fail from PowerShell.
started: After Plan 08 fix attempt (spawn bash --norc --noprofile -c)

## Eliminated

- hypothesis: MSYS2 msys-2.0.dll PATH conversion reorders PATH entries
  evidence: When using Git Bash explicitly, bin/ is at idx 0 and PATH order is correct. The issue is not MSYS2 conversion but wrong bash binary being used.
  timestamp: 2026-03-09T12:20:00Z

- hypothesis: Node.js spawn env propagation is broken on Windows
  evidence: Both Git Bash and WSL bash receive env vars from Node. The difference is WSL bash drops them during its own startup, not Node failing to send them.
  timestamp: 2026-03-09T12:20:00Z

- hypothesis: --norc --noprofile not preventing PATH reordering
  evidence: These flags work correctly with Git Bash. WSL bash ignores them for PATH because WSL's init layer (not bash startup files) constructs the PATH.
  timestamp: 2026-03-09T12:20:00Z

## Evidence

- timestamp: 2026-03-09T12:05:00Z
  checked: Minimal env spawn - PATH with only POSIX paths
  found: ENOENT when spawning 'bash' because Node cannot find bash.exe without Windows PATH dirs
  implication: bash resolution depends on Windows PATH; different PATH = different bash binary

- timestamp: 2026-03-09T12:10:00Z
  checked: bash.exe locations on system
  found: C:\Program Files\Git\usr\bin\bash.exe (2.5MB, MSYS2) and C:\WINDOWS\system32\bash.exe (67KB, WSL launcher)
  implication: Two completely different bash implementations exist on the system

- timestamp: 2026-03-09T12:12:00Z
  checked: bash --version for each
  found: Git bash = "x86_64-pc-msys", system32 bash = "aarch64-unknown-linux-gnu"
  implication: system32 bash is WSL (Linux), not MSYS2

- timestamp: 2026-03-09T12:15:00Z
  checked: Simulated PowerShell PATH (without Git\usr dirs)
  found: Only bash.exe found is at C:\WINDOWS\system32 and WindowsApps (both WSL)
  implication: From PowerShell, spawn('bash') resolves to WSL bash, not Git Bash

- timestamp: 2026-03-09T12:20:00Z
  checked: Direct comparison - Git Bash vs WSL Bash with identical env
  found: |
    Git Bash: bin/ at idx 0, /usr/bin at idx 5, MY_CUSTOM_VAR=hello (all correct)
    WSL Bash: bin/ at idx 9, /usr/bin at idx 3, MY_CUSTOM_VAR= (empty) (exact match of reported failures)
  implication: ROOT CAUSE CONFIRMED - WSL bash resolves from PowerShell, reconstructs PATH from Linux defaults, drops env vars

- timestamp: 2026-03-09T12:25:00Z
  checked: PATH separator behavior - colon vs semicolon on Windows
  found: |
    Colon-joined PATH produces broken entry [1]='C' from drive letter splitting.
    Semicolon-joined PATH produces clean POSIX entries after MSYS2 conversion.
  implication: Secondary fix needed - use ';' as PATH separator on Windows

- timestamp: 2026-03-09T12:40:00Z
  checked: Complete fix - resolveGitBash() + semicolon separator
  found: All 4 tests pass from Git Bash after fix
  implication: Fix works in self-verification; needs PowerShell verification

## Resolution

root_cause: When launched from PowerShell, Node.js spawn('bash') resolves to C:\WINDOWS\system32\bash.exe (WSL bash launcher) instead of C:\Program Files\Git\usr\bin\bash.exe (Git Bash). WSL bash (a) constructs its own PATH from Linux defaults, putting /usr/local/sbin, /usr/local/bin, /usr/bin before the workspace bin/ entry, and (b) does not inherit custom Windows env vars like MY_CUSTOM_VAR. Secondary issue: PATH was joined with ':' (colon) which splits Windows drive letters.
fix: |
  Two changes to src/providers/local.ts:
  1. Added resolveGitBash() function that locates Git Bash explicitly via `git --exec-path`,
     falling back to common install paths, with module-level caching.
  2. Changed PATH separator from ':' to ';' on Windows (process.platform === 'win32'),
     so MSYS2 bash correctly converts the full Windows PATH to POSIX format.
verification: 4/4 tests pass from Git Bash. Awaiting user verification from PowerShell.
files_changed:
  - src/providers/local.ts
