import { HELP_LINES } from '../hud/gameplayHud';

export const HOW_TO_PLAY_LINES: readonly string[] = [
  ...HELP_LINES,
  '',
  'Como funciona:',
  '  Cada sala tem alguns inimigos, um de cada vez (INIMIGO b/n no HUD);',
  '  ENCONTRO no HUD é o número da sala.',
  '  Depois do terceiro inimigo da run vem a BOSS ROOM, com o chefe.',
  '  Parry: E bem no instante do golpe. Bloqueio: E segurado de longe.',
  '  Esquiva: Espaço; no telegraph do chefe ela dá i-frames.',
  '  O chefe só se adapta aos seus hábitos depois de ser enfrentado',
  '  uma vez e de você repetir o mesmo hábito em cerca de 3 runs.',
];
