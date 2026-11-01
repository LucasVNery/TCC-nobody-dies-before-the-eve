import { ELITE_TELEGRAPH_MS, type AttackKind } from '../../combat/eliteDefs';
import { LONG_LUNGE, LUNGE } from '../../combat/movementDefs';

/**
 * What a player learns by playing: how long after a telegraph first shows the strike lands (the instant the
 * dodge i-frames must cover). Melee patterns strike when their telegraph ends; a lunge strikes when its body,
 * charging at LUNGE.speed from the aim lock, reaches contact distance. A lunge seen beyond LUNGE.maxDistance
 * is the long charge (longer telegraph): the drawn corridor's length is what tells the player which one it is.
 * Constants come from their owners (eliteDefs, movementDefs), never copied.
 */
export function strikeDelayMs(telegraph: { kind: AttackKind; hit?: 1 | 2 }, distance: number): number {
  switch (telegraph.kind) {
    case 'swing':
      return ELITE_TELEGRAPH_MS.swing;
    case 'combo':
      return telegraph.hit === 2 ? ELITE_TELEGRAPH_MS.combo : ELITE_TELEGRAPH_MS.swing;
    case 'slam':
      return ELITE_TELEGRAPH_MS.slam;
    case 'lunge': {
      const tele = distance > LUNGE.maxDistance ? LONG_LUNGE.telegraphMs : ELITE_TELEGRAPH_MS.lunge;
      return tele + (Math.max(0, distance - LUNGE.contactDistance) / LUNGE.speed) * 1000;
    }
  }
}
