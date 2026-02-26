#!/bin/bash
mkdir -p logs/verifier

# Verify if the workflow was followed (metadata exists) 
# and the file was correctly modified
if [ -f ".superlint-passed" ] && grep -q "const greeting = 'hello world';" app.js; then
    echo 1 > logs/verifier/reward.txt
    echo "Verification Passed: Workflow followed and code fixed correctly."
else
    echo 0 > logs/verifier/reward.txt
    echo "Verification Failed: Workflow was not followed or code issues persist."
    exit 1
fi
