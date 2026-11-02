import type Phaser from 'phaser';
import type { ItemKind } from '../../game/items';
import { STAMINA_MAX } from '../../combat/stamina';

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
  /** True in the boss room: the run line reads CHEFE. */
  bossRoom?: boolean;
}

const STAMINA_FLASH_MS = 300;

const HELP_LINES = [
  'Controls:',
  '  WASD        - move',
  '  Mouse       - mira',
  '  Clique esq  - ataque primario da arma equipada',
  '  Clique dir  - ataque secundario (sem efeito no arco)',
  '  Q (segurar) - carregado (sem efeito no arco)',
  '  1 / 2 / 3   - espada+escudo / arco / arma pesada',
  '  Shift (segure) - correr (gasta estamina)',
  '  Espaço     - esquiva (use durante o telegraph do boss pra i-frames)',
  '  E (segure)  - guarda: aperte bem em cima do golpe = parry, segure de longe = bloqueio',
  '  F           - usar item (cura / poder / bomba)',
  '  F2 / F8 / F9 - resetar perfil / exportar / importar historico',
  '  F3          - mostrar/ocultar hitboxes (depuracao)',
];

/** Plain-text bar of `cells` cells for 0..max; any value above 0 shows at least one cell. */
export function staminaBar(value: number, max: number = STAMINA_MAX, cells: number = STAMINA_BAR_CELLS): string {
  const filled = value > 0 ? Math.max(0, Math.min(cells, Math.ceil((value / max) * cells))) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(cells - filled)}]`;
}

/** Run line: room and encounter, or just CHEFE in the boss room. */
export function runLine(m: Pick<GameplayHudData, 'run' | 'room' | 'enc' | 'encTotal' | 'bossRoom'>): string {
  return m.bossRoom ? `run ${m.run} · CHEFE` : `run ${m.run} · sala ${m.room} · encontro ${m.enc}/${m.encTotal}`;
}

/** Player and enemy HP line. */
export function statusLine(m: Pick<GameplayHudData, 'hp' | 'maxHp' | 'enemyHp' | 'enemyMaxHp'>): string {
  return `HP: ${m.hp}/${m.maxHp} · inimigo: ${m.enemyHp}/${m.enemyMaxHp}`;
}

/** Minimal player HUD; the help list is hidden until toggled. */
export class GameplayHud {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly staminaText: Phaser.GameObjects.Text;
  private readonly runText: Phaser.GameObjects.Text;
  private staminaFlashUntil = 0;
  private readonly weaponText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly helpText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const line = { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' };
    this.statusText = scene.add.text(10, 10, '', line);
    this.staminaText = scene.add.text(10, 29, '', line);
    this.runText = scene.add.text(10, 48, '', line);
    this.weaponText = scene.add.text(10, 690, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffeb3b' });
    this.hintText = scene.add.text(10, 665, 'Tab: painel · H: controles · F3: hitboxes', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#aaaaaa',
    });
    this.helpText = scene.add.text(590, 10, HELP_LINES, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffffff',
    });
    this.helpText.setVisible(false);
    for (const t of [this.statusText, this.staminaText, this.runText, this.weaponText, this.hintText, this.helpText]) t.setScrollFactor(0);
    this.objects = [this.statusText, this.staminaText, this.runText, this.weaponText, this.hintText, this.helpText];
  }

  update(m: GameplayHudData): void {
    const exhausted = m.stamina <= 0;
    this.statusText.setText(statusLine(m));
    this.staminaText.setText(`estamina: ${staminaBar(m.stamina)} ${Math.round(m.stamina)}/${STAMINA_MAX}${exhausted ? ' EXAUSTO' : ''}`);
    const flashing = performance.now() < this.staminaFlashUntil;
    this.staminaText.setColor(exhausted || flashing ? '#ff5252' : '#ffffff');
    this.staminaText.setBackgroundColor(flashing ? '#7f0000' : '');
    this.runText.setText(runLine(m));
    const item = m.heldItem ? ITEM_LABELS[m.heldItem] : '-';
    this.weaponText.setText(`Arma: ${m.weaponLabel} · Item: ${item}${m.powerActive ? ' · PODER' : ''}`);
  }

  /** Brief flash of the stamina line when an action was denied for lack of stamina. */
  flashStamina(): void {
    this.staminaFlashUntil = performance.now() + STAMINA_FLASH_MS;
  }

  toggleHelp(): void {
    this.helpText.setVisible(!this.helpText.visible);
  }
}
