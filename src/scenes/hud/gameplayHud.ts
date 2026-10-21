import type Phaser from 'phaser';
import type { ItemKind } from '../../game/items';

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
}

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
];

/** Plain-text bar, 10 cells for 0..100. */
function staminaBar(value: number): string {
  const filled = Math.max(0, Math.min(10, Math.ceil(value / 10)));
  return `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`;
}

/** Minimal player HUD; the help list is hidden until toggled. */
export class GameplayHud {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly weaponText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly helpText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.statusText = scene.add.text(10, 10, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' });
    this.weaponText = scene.add.text(10, 690, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffeb3b' });
    this.hintText = scene.add.text(10, 665, 'Tab: painel · H: controles', {
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
    for (const t of [this.statusText, this.weaponText, this.hintText, this.helpText]) t.setScrollFactor(0);
    this.objects = [this.statusText, this.weaponText, this.hintText, this.helpText];
  }

  update(m: GameplayHudData): void {
    this.statusText.setText([
      `HP: ${m.hp}/${m.maxHp} · inimigo: ${m.enemyHp}/${m.enemyMaxHp}`,
      `estamina: ${staminaBar(m.stamina)} ${Math.round(m.stamina)}/100${m.stamina <= 0 ? ' EXAUSTO' : ''}`,
      `run ${m.run} · sala ${m.room} · encontro ${m.enc}/${m.encTotal}`,
    ]);
    const item = m.heldItem ? ITEM_LABELS[m.heldItem] : '-';
    this.weaponText.setText(`Arma: ${m.weaponLabel} · Item: ${item}${m.powerActive ? ' · PODER' : ''}`);
  }

  toggleHelp(): void {
    this.helpText.setVisible(!this.helpText.visible);
  }
}
