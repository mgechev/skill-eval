/**
 * Shell helpers for building agent CLI invocations.
 */

/**
 * Single-quote a value for a POSIX shell.
 *
 * Agent commands are assembled as strings and handed to `sh -c`, so any value
 * that came from eval.yaml or a CLI flag has to be quoted before it lands in
 * one.
 */
export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
