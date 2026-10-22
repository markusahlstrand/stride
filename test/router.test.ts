/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import { parseRoute, formatRoute } from '../app/src/router.js';

describe('phased workout navigation', () => {
  it('keeps the selected occurrence through a URL round trip and a refresh', () => {
    const second = { name: 'workout' as const, id: 'programme', occurrenceId: 'second-workout' };
    expect(formatRoute(second)).toBe('#/workouts/programme?day=second-workout');
    expect(parseRoute(formatRoute(second))).toEqual(second);
  });
  it('preserves ordinary workout links without an occurrence', () => {
    expect(parseRoute('#/workouts/programme')).toEqual({ name: 'workout', id: 'programme' });
    expect(formatRoute({ name: 'workout', id: 'programme' })).toBe('#/workouts/programme');
  });
});
