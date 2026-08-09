import { describe, it, expect } from 'vitest';
import { progressBar } from '../src/utils/cli';

describe('progressBar', () => {
  it('renders the example from the docs', () => {
    expect(progressBar(10, 20)).toBe('▓▓▓▓▓░░░░░  10/20  50%');
  });

  it('is empty at the start and full at the end', () => {
    expect(progressBar(0, 22)).toBe('░░░░░░░░░░  0/22  0%');
    expect(progressBar(22, 22)).toBe('▓▓▓▓▓▓▓▓▓▓  22/22  100%');
  });

  it('always renders exactly `segments` cells', () => {
    for (let done = 0; done <= 7; done++) {
      const bar = progressBar(done, 7).split('  ')[0];
      expect(bar).toHaveLength(10);
    }
  });

  it('honours a custom segment count', () => {
    expect(progressBar(1, 4, 4)).toBe('▓░░░  1/4  25%');
  });

  it('does not divide by zero when there are no tasks', () => {
    expect(progressBar(0, 0)).toBe('░░░░░░░░░░  0/0  0%');
  });

  it('clamps rather than overflowing when done exceeds total', () => {
    expect(progressBar(5, 3)).toBe('▓▓▓▓▓▓▓▓▓▓  5/3  100%');
  });
});
