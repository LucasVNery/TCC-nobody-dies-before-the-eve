import type Phaser from 'phaser';
import type { Encounter } from '../../combat/encounter';
import type { ProfileSink } from '../../profile/profileSink';
import type { LoggedEvent } from '../../telemetry/schema';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { ITEM, type ItemKind } from '../../game/items';
import { ASSET_KEYS } from '../../visual/assetRegistry';
import { ENTITY_VISUAL_WIDTH, ENTITY_VISUAL_HEIGHT } from '../../visual/placeholderTextures';
import { GROUND_PROJECTION, toScreen } from '../../visual/groundProjection';
import { DirectionalSprite } from '../../visual/directionalSprite';
import { FLOOR_TILESET, SKIRT_TILES } from '../../visual/floor/composeFloor';
import { FloorTracker } from '../../visual/floor/floorFromEvents';
import { FLOOR_TILE_IDS } from '../../visual/floor/floorAssets';
import { FLASH_MS } from '../../visual/feedbackDefs';
import { PositionHistory } from '../../visual/stepInterpolation';
import { FloorView } from './floorView';
import { rangeEllipseSize } from './debugDraw';
import { BOSS_BASE_TINT, enemyTint } from '../../visual/enemyTint';

const WALK_FRAME_COUNT = 6;

/** Placeholder item colors by kind. */
const ITEM_COLORS: Record<ItemKind, number> = { heal: 0x4caf50, power: 0x9c27b0, bomb: 0xf44336 };

/** Procedural floor (rebuilt on room.enter) and the two character sprites, with i-frame / attack tints. */
export class WorldView {
  readonly playerSprite: DirectionalSprite;
  readonly assaltanteSprite: DirectionalSprite;
  private readonly floor: FloorView<Phaser.GameObjects.Image, Phaser.Textures.DynamicTexture>;
  private readonly floorTracker: FloorTracker;
  private readonly playerTrail = new PositionHistory();
  private readonly assaltanteTrail = new PositionHistory();
  private readonly projectileGraphics: Phaser.GameObjects.Graphics;
  private readonly itemGraphics: Phaser.GameObjects.Graphics;
  private readonly auraGraphics: Phaser.GameObjects.Graphics;
  private stepped = false;
  private playerFlashUntil = 0;
  private enemyFlashUntil = 0;

  constructor(scene: Phaser.Scene) {
    // The floor container must exist before any other world object and before CameraRig.attach.
    this.floorTracker = new FloorTracker(
      Math.ceil(ARENA_BOUNDS.width / GROUND_PROJECTION.tileWorldSize),
      Math.ceil(ARENA_BOUNDS.height / GROUND_PROJECTION.tileWorldSize),
      SKIRT_TILES,
      FLOOR_TILESET,
    );
    this.floor = new FloorView<Phaser.GameObjects.Image, Phaser.Textures.DynamicTexture>(scene, ARENA_BOUNDS, GROUND_PROJECTION, FLOOR_TILE_IDS);
    this.floor.rebuild(this.floorTracker.initial());
    this.auraGraphics = scene.add.graphics();
    this.projectileGraphics = scene.add.graphics();
    this.projectileGraphics.setDepth(90000);
    this.itemGraphics = scene.add.graphics();
    this.itemGraphics.setDepth(89000);
    this.playerSprite = new DirectionalSprite(
      scene,
      { idleTextureKey: ASSET_KEYS.playerIdle, walkTextureKey: ASSET_KEYS.playerWalk, walkFrameCount: WALK_FRAME_COUNT },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 100, y: 300 },
      GROUND_PROJECTION,
    );
    this.assaltanteSprite = new DirectionalSprite(
      scene,
      { idleTextureKey: ASSET_KEYS.assaltanteIdle, walkTextureKey: ASSET_KEYS.assaltanteWalk, walkFrameCount: WALK_FRAME_COUNT },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 400, y: 300 },
      GROUND_PROJECTION,
    );
  }

  /** Feeds a logged event to the floor tracker; a room change rebuilds the floor. */
  handleEvent(e: LoggedEvent): void {
    try {
      const layout = this.floorTracker.apply(e);
      if (layout) this.floor.rebuild(layout);
    } catch (err) {
      console.warn('[floor] failed to update', err);
    }
  }

  /** White flash of FLASH_MS on the entity that was hit; the normal tint logic resumes afterwards. */
  flash(target: 'player' | 'enemy'): void {
    const until = performance.now() + FLASH_MS;
    if (target === 'player') this.playerFlashUntil = until;
    else this.enemyFlashUntil = until;
  }

  /** Records the step positions; called after every simulation step. */
  recordStep(encounter: Encounter<ProfileSink>): void {
    this.playerTrail.push(encounter.player.position);
    this.assaltanteTrail.push(encounter.assaltante.position);
    this.stepped = true;
  }

  /** Boss aura: a pulsing ground ellipse under the boss body, separate from the sprite (cleared outside boss mode). */
  private drawAura(encounter: Encounter<ProfileSink>, alpha: number, isBoss: boolean, now: number): void {
    const g = this.auraGraphics;
    g.clear();
    if (!isBoss) return;
    const body = encounter.assaltante.bodySize;
    const pos = this.assaltanteTrail.at(alpha);
    const centre = toScreen({ x: pos.x + body.width / 2, y: pos.y + body.height / 2 }, GROUND_PROJECTION);
    const pulse = 0.5 + 0.5 * Math.sin(now / 450);
    const size = rangeEllipseSize((Math.max(body.width, body.height) / 2) * (2 + 0.1 * pulse), GROUND_PROJECTION);
    g.fillStyle(BOSS_BASE_TINT, 0.35 + 0.15 * pulse);
    g.fillEllipse(centre.x, centre.y, size.width, size.height);
    g.lineStyle(2, 0xff5a5a, 0.7 + 0.3 * pulse);
    g.strokeEllipse(centre.x, centre.y, size.width, size.height);
    g.setDepth(this.assaltanteSprite.gameObject.depth - 1);
  }

  // Sprites are drawn interpolated (up to one step behind) while debug hitboxes and aim use the logic positions,
  // so hitboxes lead the sprite by up to one step (~4 px walking, ~11 px dashing).
  /** Draws the sprites `alpha` of a step past the previous step (presentation only; logic keeps the step positions). */
  sync(encounter: Encounter<ProfileSink>, playerMoving: boolean, alpha: number): void {
    if (!this.stepped) this.recordStep(encounter); // first frame before any step
    this.playerSprite.syncPosition(this.playerTrail.at(alpha));
    this.playerSprite.syncDirection(encounter.player.facing, playerMoving);
    const now = performance.now();
    if (now < this.playerFlashUntil) this.playerSprite.setTintFill(0xffffff);
    else this.playerSprite.setTint(encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(this.assaltanteTrail.at(alpha));
    this.assaltanteSprite.syncDirection(
      encounter.assaltante.attackDirection,
      encounter.assaltante.state === 'chasing',
    );
    const bodyScale = encounter.assaltante.bodyScale;
    const isBoss = bodyScale > 1;
    this.assaltanteSprite.setBodyScale(bodyScale);
    const tint = enemyTint({
      lunge: encounter.assaltante.lungePhase,
      attacking: encounter.assaltante.state === 'attacking',
      boss: isBoss,
    });
    if (now < this.enemyFlashUntil) this.assaltanteSprite.setTintFill(0xffffff);
    else this.assaltanteSprite.setTint(tint);
    this.drawAura(encounter, alpha, isBoss, now);

    // Placeholder arrows: one small circle per active projectile (logic positions).
    const g = this.projectileGraphics;
    g.clear();
    g.fillStyle(0xffeb3b, 1);
    for (const p of encounter.projectiles.active) {
      const at = toScreen(p.pos, GROUND_PROJECTION);
      g.fillCircle(at.x, at.y, 4);
    }

    // Placeholder items: one colored circle per item on the ground (logic positions, box center).
    const ig = this.itemGraphics;
    ig.clear();
    for (const item of encounter.items.onMap) {
      const at = toScreen({ x: item.pos.x + ITEM.size / 2, y: item.pos.y + ITEM.size / 2 }, GROUND_PROJECTION);
      ig.fillStyle(ITEM_COLORS[item.kind], 1);
      ig.fillCircle(at.x, at.y, 9);
    }
  }
}
