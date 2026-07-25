/**
 * Timeout utility
 */

/**
 * Wrap a Promise with a timeout
 * @param promise The promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param label Label for the error message
 */
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        promise.then(
            (val) => {
                clearTimeout(timer);
                resolve(val);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}
