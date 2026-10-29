import type Phaser from 'phaser';
import type { Encounter } from '../../combat/encounter';
import type { ProfileSink } from '../../profile/profileSink';
import type { LoggedEvent } from '../../telemetry/schema';
import type { Vec2 } from '../../combat/types';
import type { AttackSector } from '../../combat/sector';
import type { TelegraphView } from '../../combat/assaltanteController';
import { ACTION_REGISTRY } from '../../combat/actionRegistry';
import { ENTITY_SIZE, ENTITY_VISUAL_HEIGHT } from '../../visual/placeholderTextures';
import { GROUND_PROJECTION, toScreen } from '../../visual/groundProjection';
import { DAMAGE_NUMBER_MS, shakeFor, telegraphFill } from '../../visual/feedbackDefs';
import { rangeEllipseSize, sectorPoints } from './debugDraw';

const ARC_FADE_MS = 150;
const ARC_ALPHA = 0.35;
const PLAYER_ARC_COLOR = 0xffffff;
const ENEMY_ARC_COLOR = 0xff5252;
const TELEGRAPH_OUTLINE_ALPHA = 0.55;
const TELEGRAPH_FILL_ALPHA = 0.35;
const TELEGRAPH_COLORS = { swing: 0xff9800, combo: 0xff9800, slam: 0xf44336, lunge: 0x00bcd4 } as const;
const CAP_SAMPLES = 8;
const RING_MS = 350;
const POOL_SIZE = 16;
const ITEM_RING_COLORS = { heal: 0x4caf50, power: 0x9c27b0, bomb: 0xf44336 } as const;

interface Ring {
  pos: Vec2;
  color: number;
  startMs: number;
  maxRadius: number;
}

interface ArcTrack {
  sector: AttackSector | null;
  lastSeenMs: number;
}

interface NumberSlot {
  text: Phaser.GameObjects.Text;
  startMs: number;
  x: number;
  y: number;
  active: boolean;
}

export interface FeedbackHooks {
  shake(px: number, decayMs: number): void;
  flash(target: 'player' | 'enemy'): void;
  staminaDenied(): void;
}

function centre(pos: Vec2): Vec2 {
  // Entities are square; their centre is a half-size offset from the logic position.
  return { x: pos.x + ENTITY_SIZE / 2, y: pos.y + ENTITY_SIZE / 2 };
}

function hitKind(actionId: string): 'light' | 'heavy' {
  // actionIds outside the registry (item.bomb, bow.shot) shake as light.
  const type = ACTION_REGISTRY.get(actionId)?.actionType;
  return type === 'heavy' || type === 'charged' ? 'heavy' : 'light';
}

/**
 * World-space combat feedback: strike arcs, telegraph indicators, damage numbers, rings and the power aura.
 * Every Phaser object is created up front (pools) so CameraRig.attach keeps them off the UI camera.
 */
export class FeedbackView {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly arcGraphics: Phaser.GameObjects.Graphics;
  private readonly telegraphGraphics: Phaser.GameObjects.Graphics;
  private readonly ringGraphics: Phaser.GameObjects.Graphics;
  private readonly numbers: NumberSlot[] = [];
  private readonly rings: Ring[] = [];
  private readonly playerArc: ArcTrack = { sector: null, lastSeenMs: -Infinity };
  private readonly enemyArc: ArcTrack = { sector: null, lastSeenMs: -Infinity };
  private encounter: Encounter<ProfileSink> | null = null;

  constructor(scene: Phaser.Scene, private readonly hooks: FeedbackHooks) {
    this.telegraphGraphics = scene.add.graphics().setDepth(85000);
    this.arcGraphics = scene.add.graphics().setDepth(91000);
    this.ringGraphics = scene.add.graphics().setDepth(92000);
    for (let i = 0; i < POOL_SIZE; i++) {
      const text = scene.add
        .text(0, 0, '', {
          fontFamily: 'monospace',
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(95000)
        .setVisible(false);
      this.numbers.push({ text, startMs: 0, x: 0, y: 0, active: false });
    }
    this.objects = [this.telegraphGraphics, this.arcGraphics, this.ringGraphics, ...this.numbers.map((n) => n.text)];
  }

  /** Event-driven effects; called for every logged event, live. */
  handleEvent(e: LoggedEvent): void {
    const enc = this.encounter;
    const now = performance.now();
    switch (e.type) {
      case 'enemy.hurt': {
        const s = shakeFor(hitKind(String(e.actionId ?? '')));
        this.hooks.shake(s.px, s.decayMs);
        this.hooks.flash('enemy');
        if (enc) this.spawnNumber(enc.assaltante.position, Number(e.dmg), '#ffeb3b', now);
        break;
      }
      case 'player.hurt': {
        const s = shakeFor('heavy');
        this.hooks.shake(s.px, s.decayMs);
        this.hooks.flash('player');
        if (enc) this.spawnNumber(enc.player.position, Number(e.dmg), '#ff5252', now);
        break;
      }
      case 'player.defense':
        if (e.perfect === true && enc) {
          this.rings.push({ pos: centre(enc.player.position), color: 0xffffff, startMs: now, maxRadius: 90 });
        }
        break;
      case 'player.stamina_denied':
        this.hooks.staminaDenied();
        break;
      case 'item.use':
        if (enc) {
          const color = ITEM_RING_COLORS[e.kind as keyof typeof ITEM_RING_COLORS] ?? 0xffffff;
          this.rings.push({ pos: centre(enc.player.position), color, startMs: now, maxRadius: 70 });
        }
        break;
      default:
        break;
    }
  }

  /** Once per frame, after the simulation advanced. */
  update(encounter: Encounter<ProfileSink>): void {
    this.encounter = encounter;
    const now = performance.now();
    this.drawArcs(encounter, now);
    this.drawTelegraph(encounter.assaltante.telegraph);
    this.drawRings(encounter, now);
    this.updateNumbers(now);
  }

  private drawArcs(encounter: Encounter<ProfileSink>, now: number): void {
    const g = this.arcGraphics;
    g.clear();
    const tracks: Array<[ArcTrack, AttackSector | null, number]> = [
      [this.playerArc, encounter.player.attackHitbox(), PLAYER_ARC_COLOR],
      [this.enemyArc, encounter.assaltante.attackHitbox(), ENEMY_ARC_COLOR],
    ];
    for (const [track, live, color] of tracks) {
      if (live) {
        track.sector = {
          origin: { ...live.origin },
          direction: { ...live.direction },
          reach: live.reach,
          halfAngleRad: live.halfAngleRad,
        };
        track.lastSeenMs = now;
      }
      if (!track.sector) continue;
      const age = now - track.lastSeenMs;
      if (age >= ARC_FADE_MS) {
        track.sector = null;
        continue;
      }
      g.fillStyle(color, ARC_ALPHA * (1 - age / ARC_FADE_MS));
      g.fillPoints(sectorPoints(track.sector, GROUND_PROJECTION), true);
    }
  }

  private drawTelegraph(t: TelegraphView | null): void {
    const g = this.telegraphGraphics;
    g.clear();
    if (!t) return;
    const color = TELEGRAPH_COLORS[t.kind];
    const fill = telegraphFill(t.progress);
    if (t.kind === 'lunge' && t.travel !== undefined && t.contactDistance !== undefined) {
      // Stadium: the logic hits within contactDistance of the body at any point of the path (and 'travel' is the
      // real path length), so the danger area extends contactDistance sideways and past the end, with a round cap.
      const dir = t.direction;
      const w = t.contactDistance;
      const travel = t.travel;
      const stadium = (len: number): Vec2[] => {
        const base = Math.atan2(dir.y, dir.x);
        const pts: Vec2[] = [];
        // Start side: square at the origin (the cap behind the enemy is not a threat worth drawing).
        pts.push({ x: t.origin.x + dir.y * w, y: t.origin.y - dir.x * w });
        const end = { x: t.origin.x + dir.x * len, y: t.origin.y + dir.y * len };
        for (let i = 0; i <= CAP_SAMPLES; i++) {
          const a = base - Math.PI / 2 + (Math.PI * i) / CAP_SAMPLES;
          pts.push({ x: end.x + Math.cos(a) * w, y: end.y + Math.sin(a) * w });
        }
        pts.push({ x: t.origin.x - dir.y * w, y: t.origin.y + dir.x * w });
        return pts.map((p) => toScreen(p, GROUND_PROJECTION));
      };
      g.lineStyle(2, color, TELEGRAPH_OUTLINE_ALPHA);
      g.strokePoints(stadium(travel), true);
      g.fillStyle(color, TELEGRAPH_FILL_ALPHA);
      g.fillPoints(stadium(travel * fill), true);
      return;
    }
    if (t.kind === 'slam') {
      const c = toScreen(t.origin, GROUND_PROJECTION);
      const full = rangeEllipseSize(t.reach, GROUND_PROJECTION);
      const part = rangeEllipseSize(t.reach * fill, GROUND_PROJECTION);
      g.lineStyle(2, color, TELEGRAPH_OUTLINE_ALPHA);
      g.strokeEllipse(c.x, c.y, full.width, full.height);
      g.fillStyle(color, TELEGRAPH_FILL_ALPHA);
      g.fillEllipse(c.x, c.y, part.width, part.height);
      return;
    }
    const sector = (reach: number): AttackSector => ({
      origin: t.origin,
      direction: t.direction,
      reach,
      halfAngleRad: t.halfAngleRad,
    });
    g.lineStyle(2, color, TELEGRAPH_OUTLINE_ALPHA);
    g.strokePoints(sectorPoints(sector(t.reach), GROUND_PROJECTION), true);
    g.fillStyle(color, TELEGRAPH_FILL_ALPHA);
    g.fillPoints(sectorPoints(sector(t.reach * fill), GROUND_PROJECTION), true);
  }

  private drawRings(encounter: Encounter<ProfileSink>, now: number): void {
    const g = this.ringGraphics;
    g.clear();
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const t = (now - r.startMs) / RING_MS;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const c = toScreen(r.pos, GROUND_PROJECTION);
      const size = rangeEllipseSize(r.maxRadius * (0.3 + 0.7 * t), GROUND_PROJECTION);
      g.lineStyle(3, r.color, 1 - t);
      g.strokeEllipse(c.x, c.y, size.width, size.height);
    }
    if (encounter.items.powerActive) {
      const c = toScreen(centre(encounter.player.position), GROUND_PROJECTION);
      const pulse = 0.5 + 0.5 * Math.sin(now / 150);
      const size = rangeEllipseSize(34 + 4 * pulse, GROUND_PROJECTION);
      g.fillStyle(ITEM_RING_COLORS.power, 0.18 + 0.12 * pulse);
      g.fillEllipse(c.x, c.y, size.width, size.height);
      g.lineStyle(2, ITEM_RING_COLORS.power, 0.7);
      g.strokeEllipse(c.x, c.y, size.width, size.height);
    }
  }

  private spawnNumber(entityPos: Vec2, dmg: number, color: string, now: number): void {
    const slot = this.numbers.find((n) => !n.active) ?? this.numbers[0];
    const at = toScreen(centre(entityPos), GROUND_PROJECTION);
    slot.active = true;
    slot.startMs = now;
    slot.x = at.x + (Math.random() - 0.5) * 16;
    slot.y = at.y - ENTITY_VISUAL_HEIGHT * 0.6;
    slot.text.setText(String(Math.round(dmg))).setColor(color).setVisible(true);
  }

  private updateNumbers(now: number): void {
    for (const n of this.numbers) {
      if (!n.active) continue;
      const t = (now - n.startMs) / DAMAGE_NUMBER_MS;
      if (t >= 1) {
        n.active = false;
        n.text.setVisible(false);
        continue;
      }
      n.text.setPosition(n.x, n.y - 36 * t).setAlpha(1 - t * t);
    }
  }
}
