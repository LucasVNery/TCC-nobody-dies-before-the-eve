// Boss plan: gate on having faced the boss, then keep the top-N valid habits.
import { BOSS_CONFIG, type BossConfig } from './bossConfig';
import type { HabitEvidence } from './habitEvidence';
import { evaluateHabits, type ConfidenceSource } from './habits';
import type { BossPlan, HabitId } from './types';

const zeroLevels = (): BossPlan['levels'] => ({ far: 0, passive_defense: 0, dodge_abuse: 0, reflex_dash: 0 });
const ORDER: readonly HabitId[] = ['far', 'passive_defense', 'dodge_abuse', 'reflex_dash'];

export function planBoss(
  evidence: Pick<HabitEvidence, 'facedBoss' | 'runs'>,
  profile: ConfidenceSource,
  cfg: BossConfig = BOSS_CONFIG,
): BossPlan {
  const levels = zeroLevels();
  if (!evidence.facedBoss) return { gateOpen: false, levels, records: [] };
  const kept = evaluateHabits(evidence.runs(), profile, cfg)
    .filter((s) => s.valid)
    // Level descending; ties keep HabitId order.
    .sort((a, b) => b.level - a.level || ORDER.indexOf(a.habit) - ORDER.indexOf(b.habit))
    .slice(0, cfg.maxActive);
  for (const s of kept) levels[s.habit] = s.level;
  const records = kept.map((s) => ({
    habit: s.habit, level: s.level, runs_qualifying: s.qualifying,
    runs_window: s.windowRuns, confidence: s.confidence, active: true,
  }));
  return { gateOpen: true, levels, records };
}
