import type Phaser from 'phaser';
import type { Encounter } from '../../combat/encounter';
import type { ProfileSink } from '../../profile/profileSink';
import type { LoggedEvent } from '../../telemetry/schema';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { ASSET_KEYS } from '../../visual/assetRegistry';
import { ENTITY_VISUAL_WIDTH, ENTITY_VISUAL_HEIGHT } from '../../visual/placeholderTextures';
import { GROUND_PROJECTION } from '../../visual/groundProjection';
import { DirectionalSprite } from '../../visual/directionalSprite';
import { FLOOR_TILESET, SKIRT_TILES } from '../../visual/floor/composeFloor';
import { FloorTracker } from '../../visual/floor/floorFromEvents';
import { FLOOR_TILE_IDS } from '../../visual/floor/floorAssets';
import { PositionHistory } from '../../visual/stepInterpolation';
import { FloorView } from './floorView';

const WALK_FRAME_COUNT = 6;

/** Procedural floor (rebuilt on room.enter) and the two character sprites, with i-frame / attack tints. */
export class WorldView {
  readonly playerSprite: DirectionalSprite;
  readonly assaltanteSprite: DirectionalSprite;
  private readonly floor: FloorView<Phaser.GameObjects.Image, Phaser.Textures.DynamicTexture>;
  private readonly floorTracker: FloorTracker;
  private readonly playerTrail = new PositionHistory();
  private readonly assaltanteTrail = new PositionHistory();
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
    this.assaltanteSprite.setTint(encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xffffff);
  }
}
