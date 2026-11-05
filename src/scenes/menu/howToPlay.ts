import { HELP_LINES, TOOL_KEYS_HELP_LINES } from '../hud/gameplayHud';

const HOW_IT_WORKS_LINES: readonly string[] = [
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

/** The menu's Como jogar text; the F2/F3/F8/F9 lines only when those keys are on (see toolKeysEnabled). */
export function howToPlayLines(toolKeys: boolean): readonly string[] {
  return [...HELP_LINES, ...(toolKeys ? TOOL_KEYS_HELP_LINES : []), ...HOW_IT_WORKS_LINES];
}
