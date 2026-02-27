#!/bin/bash
# Reference solution for superlint_demo
# Proves the task is solvable and graders are correctly configured

export PATH="$PWD/bin:$PATH"

# Step 1: Check
superlint check

# Step 2: Fix
superlint fix --target app.js

# Step 3: Verify (creates .superlint-passed)
superlint verify
