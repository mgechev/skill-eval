#!/bin/bash
superlint check
superlint fix --target app.js
superlint verify
