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
import { PositionHistory } from '../../visual/stepInterpolation';
import { FloorView } from './floorView';

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
  private stepped = false;

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

  /** Records the step positions; called after every simulation step. */
  recordStep(encounter: Encounter<ProfileSink>): void {
    this.playerTrail.push(encounter.player.position);
    this.assaltanteTrail.push(encounter.assaltante.position);
    this.stepped = true;
  }

  // Sprites are drawn interpolated (up to one step behind) while debug hitboxes and aim use the logic positions,
  // so hitboxes lead the sprite by up to one step (~4 px walking, ~11 px dashing).
  /** Draws the sprites `alpha` of a step past the previous step (presentation only; logic keeps the step positions). */
  sync(encounter: Encounter<ProfileSink>, playerMoving: boolean, alpha: number): void {
    if (!this.stepped) this.recordStep(encounter); // first frame before any step
    this.playerSprite.syncPosition(this.playerTrail.at(alpha));
    this.playerSprite.syncDirection(encounter.player.facing, playerMoving);
    this.playerSprite.setTint(encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(this.assaltanteTrail.at(alpha));
    this.assaltanteSprite.syncDirection(
      encounter.assaltante.attackDirection,
      encounter.assaltante.state === 'chasing',
    );
    // Placeholder tints: swing telegraph orange; lunge telegraph cyan, lunge charge red.
    const lunge = encounter.assaltante.lungePhase;
    const tint =
      lunge === 'telegraph' ? 0x00bcd4 : lunge === 'charge' ? 0xf44336 : encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xffffff;
    this.assaltanteSprite.setTint(tint);

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
