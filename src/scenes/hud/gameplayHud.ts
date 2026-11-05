import type Phaser from 'phaser';
import type { ItemKind } from '../../game/items';
import { STAMINA_MAX } from '../../combat/stamina';
import type { HotkeyGates } from '../input/debugKeys';

const NO_DEV_KEYS: HotkeyGates = { toolKeys: false, debugKeys: false };

const STAMINA_BAR_CELLS = 15;

export const WEAPON_LABELS: Record<string, string> = {
  sword_shield: 'Espada + Escudo',
  bow: 'Arco',
  heavy_weapon: 'Arma Pesada',
};

export const ITEM_LABELS: Record<ItemKind, string> = {
  heal: 'Cura',
  power: 'Poder',
  bomb: 'Bomba',
};

export interface GameplayHudData {
  hp: number;
  maxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  stamina: number;
  weaponLabel: string;
  heldItem: ItemKind | null;
  powerActive: boolean;
  run: number;
  room: number;
  enc: number;
  encTotal: number;
  /** True in the boss room: the indicator reads BOSS ROOM, the boss bar shows and the plain enemy HP is dropped. */
  bossRoom?: boolean;
}

const STAMINA_FLASH_MS = 300;
export const BANNER_HOLD_MS = 1400;
export const BANNER_FADE_MS = 600;
export const BOSS_BAR_WIDTH = 600;
export const BOSS_BAR_HEIGHT = 18;
const BOSS_BAR_X = (1280 - BOSS_BAR_WIDTH) / 2;
const BOSS_BAR_Y = 62;

export const HELP_LINES = [
  'Controles:',
  '  WASD         - mover',
  '  Mouse        - mira',
  '  Clique esq   - ataque primário da arma equipada',
  '  Clique dir   - ataque secundário (sem efeito no arco)',
  '  Q (segure)   - carregado (sem efeito no arco)',
  '  1 / 2 / 3    - espada+escudo / arco / arma pesada',
  '  Shift (segure) - correr (gasta estamina)',
  '  Espaço       - esquiva (use durante o telegraph do chefe pra i-frames)',
  '  E (segure)   - guarda: aperte bem em cima do golpe = parry, segure de longe = bloqueio',
  '  F            - usar item (cura / poder / bomba)',
  '  Esc          - voltar ao menu (encerra a run; o histórico fica salvo)',
];

/** Help lines for the development keys F2/F3/F8/F9; shown only when they are enabled (see toolKeysEnabled). */
export const TOOL_KEYS_HELP_LINES = [
  '  F2 / F8 / F9 - resetar perfil / exportar / importar histórico',
  '  F3           - mostrar/ocultar hitboxes (depuração)',
];

/** Help line for the playtest shortcuts; shown only when they are enabled (see devToolsEnabled). */
export const DEBUG_KEYS_HELP_LINE = '  F4 / F6      - pular para a sala do chefe / forçar barragem (teste)';

/** The in-game help list: HELP_LINES, plus the lines of the development keys that are on. */
export function helpLines(gates: HotkeyGates): readonly string[] {
  return [...HELP_LINES, ...(gates.toolKeys ? TOOL_KEYS_HELP_LINES : []), ...(gates.debugKeys ? [DEBUG_KEYS_HELP_LINE] : [])];
}

/** Footer hint; Tab and F3 are listed only when the development keys are on. */
export function hintLine(gates: Pick<HotkeyGates, 'toolKeys'>): string {
  return gates.toolKeys ? 'Esc: menu · Tab: painel · H: controles · F3: hitboxes' : 'Esc: menu · H: controles';
}

/** Plain-text bar of `cells` cells for 0..max; any value above 0 shows at least one cell. */
export function staminaBar(value: number, max: number = STAMINA_MAX, cells: number = STAMINA_BAR_CELLS): string {
  const filled = value > 0 ? Math.max(0, Math.min(cells, Math.ceil((value / max) * cells))) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(cells - filled)}]`;
}

/** Encounter indicator: the author's "encontro" is the room, "inimigo" the encounter within it. */
export function encounterLine(m: Pick<GameplayHudData, 'room' | 'enc' | 'encTotal' | 'bossRoom'>): string {
  return m.bossRoom ? 'BOSS ROOM' : `ENCONTRO ${m.room} · INIMIGO ${m.enc}/${m.encTotal}`;
}

/** Small run tag. */
export function runTag(run: number): string {
  return `run ${run}`;
}

/** Banner opacity `elapsedMs` after it was triggered: full during the hold, then a linear fade to 0. */
export function bannerAlpha(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs <= BANNER_HOLD_MS) return 1;
  return Math.max(0, 1 - (elapsedMs - BANNER_HOLD_MS) / BANNER_FADE_MS);
}

/** Filled pixel width of the boss bar; any hp above 0 shows at least 1px, clamped to [0, width]. */
export function bossBarFill(hp: number, maxHp: number, width: number = BOSS_BAR_WIDTH): number {
  if (!(hp > 0) || !(maxHp > 0)) return 0;
  return Math.max(1, Math.min(width, Math.round((hp / maxHp) * width)));
}

/** Boss bar numeric label. */
export function bossBarLabel(hp: number, maxHp: number): string {
  return `CHEFE  ${Math.max(0, Math.ceil(hp))}/${Math.ceil(maxHp)}`;
}

/** Player HP line; the enemy part is dropped in the boss room (the boss bar replaces it). */
export function statusLine(m: Pick<GameplayHudData, 'hp' | 'maxHp' | 'enemyHp' | 'enemyMaxHp' | 'bossRoom'>): string {
  const hp = `HP: ${m.hp}/${m.maxHp}`;
  return m.bossRoom ? hp : `${hp} · inimigo: ${m.enemyHp}/${m.enemyMaxHp}`;
}

/** Minimal player HUD; the help list is hidden until toggled. */
export class GameplayHud {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly staminaText: Phaser.GameObjects.Text;
  private readonly runText: Phaser.GameObjects.Text;
  private staminaFlashUntil = 0;
  private readonly indicatorText: Phaser.GameObjects.Text;
  private readonly bannerText: Phaser.GameObjects.Text;
  private readonly bossBar: Phaser.GameObjects.Graphics;
  private readonly bossLabel: Phaser.GameObjects.Text;
  private bannerStart = -1;
  private wasBossRoom = false;
  private readonly weaponText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly helpText: Phaser.GameObjects.Text;
  private readonly noticeText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, gates: HotkeyGates = NO_DEV_KEYS) {
    const line = { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' };
    this.statusText = scene.add.text(10, 10, '', line);
    this.staminaText = scene.add.text(10, 29, '', line);
    this.runText = scene.add.text(10, 48, '', line);
    this.weaponText = scene.add.text(10, 690, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffeb3b' });
    this.hintText = scene.add.text(10, 665, hintLine(gates), {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#aaaaaa',
    });
    this.helpText = scene.add.text(590, 10, [...helpLines(gates)], {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffffff',
    });
    this.helpText.setVisible(false);
    this.runText.setFontSize(13).setColor('#aaaaaa');
    this.indicatorText = scene.add.text(640, 8, '', { fontFamily: 'monospace', fontSize: '28px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.bannerText = scene.add.text(640, 300, 'BOSS ROOM', { fontFamily: 'monospace', fontSize: '84px', color: '#ff5252', fontStyle: 'bold', stroke: '#000000', strokeThickness: 8 }).setOrigin(0.5).setAlpha(0).setVisible(false);
    this.bossBar = scene.add.graphics().setVisible(false);
    this.bossLabel = scene.add.text(640, BOSS_BAR_Y + BOSS_BAR_HEIGHT / 2, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setVisible(false);
    this.noticeText = scene.add.text(640, 640, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ff8a80' }).setOrigin(0.5).setVisible(false);
    const all = [this.statusText, this.staminaText, this.runText, this.weaponText, this.hintText, this.helpText, this.indicatorText, this.bannerText, this.bossBar, this.bossLabel, this.noticeText];
    for (const t of all) t.setScrollFactor(0);
    this.bossBar.setDepth(0);
    this.bannerText.setDepth(10);
    this.bossLabel.setDepth(1);
    this.objects = all;
  }

  update(m: GameplayHudData): void {
    const exhausted = m.stamina <= 0;
    this.statusText.setText(statusLine(m));
    this.staminaText.setText(`estamina: ${staminaBar(m.stamina)} ${Math.round(m.stamina)}/${STAMINA_MAX}${exhausted ? ' EXAUSTO' : ''}`);
    const flashing = performance.now() < this.staminaFlashUntil;
    this.staminaText.setColor(exhausted || flashing ? '#ff5252' : '#ffffff');
    this.staminaText.setBackgroundColor(flashing ? '#7f0000' : '');
    this.runText.setText(runTag(m.run));
    this.runText.setPosition(1270 - this.runText.width, 10);
    this.indicatorText.setText(encounterLine(m));
    this.updateBoss(m);
    const item = m.heldItem ? ITEM_LABELS[m.heldItem] : '-';
    this.weaponText.setText(`Arma: ${m.weaponLabel} · Item: ${item}${m.powerActive ? ' · PODER' : ''}`);
  }

  /** Boss-room banner (fades on its own; never pauses anything) and wide boss health bar. */
  private updateBoss(m: GameplayHudData): void {
    const boss = !!m.bossRoom;
    if (boss && !this.wasBossRoom) this.bannerStart = performance.now();
    this.wasBossRoom = boss;
    const alpha = boss && this.bannerStart >= 0 ? bannerAlpha(performance.now() - this.bannerStart) : 0;
    this.bannerText.setAlpha(alpha).setVisible(alpha > 0);
    this.bossBar.setVisible(boss);
    this.bossLabel.setVisible(boss);
    if (!boss) return;
    const g = this.bossBar;
    g.clear();
    g.fillStyle(0x000000, 0.7).fillRect(BOSS_BAR_X - 3, BOSS_BAR_Y - 3, BOSS_BAR_WIDTH + 6, BOSS_BAR_HEIGHT + 6);
    g.fillStyle(0x4a1010, 1).fillRect(BOSS_BAR_X, BOSS_BAR_Y, BOSS_BAR_WIDTH, BOSS_BAR_HEIGHT);
    g.fillStyle(0xd32f2f, 1).fillRect(BOSS_BAR_X, BOSS_BAR_Y, bossBarFill(m.enemyHp, m.enemyMaxHp), BOSS_BAR_HEIGHT);
    this.bossLabel.setText(bossBarLabel(m.enemyHp, m.enemyMaxHp));
  }

  /** Brief flash of the stamina line when an action was denied for lack of stamina. */
  flashStamina(): void {
    this.staminaFlashUntil = performance.now() + STAMINA_FLASH_MS;
  }

  toggleHelp(): void {
    this.helpText.setVisible(!this.helpText.visible);
  }

  /** A plain-text warning line for the whole run (e.g. the run is not being saved); '' hides it. */
  setNotice(text: string): void {
    this.noticeText.setText(text).setVisible(text !== '');
  }

  /** The development keys changed (the account changed mid-run): the hint and the help list follow. */
  setGates(gates: HotkeyGates): void {
    this.hintText.setText(hintLine(gates));
    this.helpText.setText([...helpLines(gates)]);
  }
}
