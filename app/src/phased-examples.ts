import type { SequencePlan, PhaseDay } from '../../src/phased-plan.js';
import type { Exercise } from './api';

// Original editable examples of the progression structure, not reproductions of a source's tables.
export function examplePlan(kind: 'pushups' | 'pullups' | 'strength', exercises: Exercise[]): SequencePlan {
  const slug = kind === 'pushups' ? 'push-up' : kind === 'pullups' ? 'pull-up' : 'back-squat';
  const exercise = exercises.find((e) => e.slug === slug);
  if (!exercise) throw new Error(`Install the starter library or add ${slug} before using this example.`);
  const row = exercises.find((e) => e.slug === 'suspension-row');
  const pulldown = exercises.find((e) => e.slug === 'lat-pulldown');
  if (kind === 'pullups' && (!row || !pulldown)) throw new Error('Install the starter library to use this example.');
  const tracks = kind === 'pushups' ? [
    { key: 'foundation', name: 'Foundation', min: 0, max: 9, startPhase: 0 },
    { key: 'building', name: 'Building', min: 10, max: 1000000, startPhase: 0 },
  ] : [{ key: 'standard', name: 'Standard', min: 0, max: 1000000, startPhase: 0 }];
  const goal = { exerciseId: exercise.id, mode: 'single-set' as const, target: kind === 'pushups' ? 100 : kind === 'pullups' ? 5 : 10 };
  return {
    name: kind === 'pushups' ? 'Towards 100 pushups' : kind === 'pullups' ? 'Pull-up practice' : 'Strength: build, recover, test',
    description: 'An editable starting point. Preview each day and choose targets that match your current ability. Repeat a phase when needed.',
    ...(kind === 'pushups' ? { source: { title: 'Structure inspired by Hundred Pushups; original prescriptions', url: 'https://hundredpushups.com/' } } : {}),
    goal, assessmentExerciseId: exercise.id, tracks,
    phases: (kind === 'strength' ? ['Build strength', 'Lighter practice', 'Retest'] : ['Find your starting point', 'Build practice', 'Retest']).map((name, phase) => ({
      name, notes: phase === 2 ? 'Record one continuous test set. The goal is achieved only by logged results.' : 'Adjust targets before training.',
      progression: phase === 1 ? 'milestone' as const : 'scheduled' as const,
      ...(phase === 1 ? { milestone: { ...goal, exerciseId: kind === 'pullups' ? pulldown!.id : exercise.id, target: kind === 'pushups' ? 12 : kind === 'pullups' ? 8 : 5 } } : {}),
      days: Object.fromEntries(tracks.map((track, ti) => [track.key, Array.from({ length: 7 }, (_, day): PhaseDay => {
        const rest = ![0, 2, 4].includes(day);
        const test = (phase === 0 && day === 0) || (phase === 2 && day === 4);
        const reps = kind === 'pushups' ? 2 + ti * 4 + phase * 2 : kind === 'pullups' && phase < 2 ? 8 : kind === 'strength' ? (phase === 1 ? 3 : 5) : 1 + phase;
        const movementId = kind === 'pullups' && phase < 2 ? (phase === 0 ? row!.id : pulldown!.id) : exercise.id;
        return { name: `Day ${day + 1}${test ? ' — assessment' : ''}`, rest,
          workouts: rest ? [] : [{ name: test ? 'Assessment' : 'Practice', items: [{ exerciseId: movementId,
            sets: test ? [{ mode: 'amrap', reps: 0, restSeconds: 90 }] : Array.from({ length: 3 }, () => ({ mode: 'fixed', reps, restSeconds: 90 })) }] }] };
      })])),
    })),
  };
}
