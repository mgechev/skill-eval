/**
 * Marker parser - parses interactive markers from agent output
 *
 * Supported marker formats:
 * - [NEEDS_INPUT:type] hint text
 * - [WAITING_FOR_USER] hint text
 * - [AWAITING_CONFIRMATION] hint text
 * - Chinese markers (see patterns below)
 */

export interface ParsedMarker {
    needsInput: boolean;
    inputType?: string;
    inputHint?: string;
}

/** Predefined marker patterns */
const MARKER_PATTERNS: Array<{
    pattern: RegExp;
    typeExtractor: (match: RegExpMatchArray) => { type: string; hint: string };
}> = [
    // [NEEDS_INPUT:confirmation] Please confirm?
    {
        pattern: /\[NEEDS_INPUT:(\w+)\]\s*(.*)/i,
        typeExtractor: (m) => ({ type: m[1].toLowerCase(), hint: m[2].trim() }),
    },
    // [WAITING_FOR_USER] Waiting for user input...
    {
        pattern: /\[WAITING_FOR_USER\]\s*(.*)/i,
        typeExtractor: (m) => ({ type: 'generic', hint: m[1].trim() }),
    },
    // [AWAITING_CONFIRMATION] Please confirm...
    {
        pattern: /\[AWAITING_CONFIRMATION\]\s*(.*)/i,
        typeExtractor: (m) => ({ type: 'confirmation', hint: m[1].trim() }),
    },
    // [AWAITING_CHOICE] Please select...
    {
        pattern: /\[AWAITING_CHOICE\]\s*(.*)/i,
        typeExtractor: (m) => ({ type: 'choice', hint: m[1].trim() }),
    },
    // Chinese: waiting for user confirmation
    {
        pattern: /等待用户确认[：:]\s*(.*)/,
        typeExtractor: (m) => ({ type: 'confirmation', hint: m[1].trim() }),
    },
    // Chinese: waiting for user input
    {
        pattern: /等待用户输入[：:]\s*(.*)/,
        typeExtractor: (m) => ({ type: 'generic', hint: m[1].trim() }),
    },
    // Chinese: waiting for user selection
    {
        pattern: /等待用户选择[：:]\s*(.*)/,
        typeExtractor: (m) => ({ type: 'choice', hint: m[1].trim() }),
    },
    // Chinese: please confirm whether...
    {
        pattern: /请确认(是否|如下)[：:.]?\s*(.*)/i,
        typeExtractor: (m) => ({ type: 'confirmation', hint: m[0].trim() }),
    },
    // Chinese: please select...
    {
        pattern: /请选择[：:.]?\s*(.*)/i,
        typeExtractor: (m) => ({ type: 'choice', hint: m[0].trim() }),
    },
];

/**
 * Parse interactive markers from agent output
 * @param output Agent output text
 * @returns Parsed result
 */
export function parseOutputMarkers(output: string): ParsedMarker {
    if (!output || typeof output !== 'string') {
        return { needsInput: false };
    }

    for (const { pattern, typeExtractor } of MARKER_PATTERNS) {
        const match = output.match(pattern);
        if (match) {
            const { type, hint } = typeExtractor(match);
            return {
                needsInput: true,
                inputType: type,
                inputHint: hint || undefined,
            };
        }
    }

    return { needsInput: false };
}

/**
 * Check if output contains stop markers
 * @param output Agent output text
 * @param stopPatterns List of stop patterns
 */
export function checkStopConditions(
    output: string,
    stopPatterns: string[]
): boolean {
    if (!output || !stopPatterns?.length) {
        return false;
    }

    for (const pattern of stopPatterns) {
        if (output.includes(pattern)) {
            return true;
        }
    }

    return false;
}

/**
 * Normalize input type to standard form
 */
export function normalizeInputType(type: string): string {
    const typeMap: Record<string, string> = {
        'confirm': 'confirmation',
        'choice': 'choice',
        'select': 'choice',
        'input': 'generic',
        'text': 'generic',
        'confirmation': 'confirmation',
        'generic': 'generic',
    };
    return typeMap[type.toLowerCase()] || type.toLowerCase();
}
