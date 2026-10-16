import type Phaser from 'phaser';
import type { Encounter } from '../../combat/encounter';
import type { ProfileSink } from '../../profile/profileSink';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { ASSET_KEYS } from '../../visual/assetRegistry';
import { ENTITY_VISUAL_WIDTH, ENTITY_VISUAL_HEIGHT, ISO_CONFIG } from '../../visual/placeholderTextures';
import { createGroundTilemap } from '../../visual/groundTilemap';
import { DirectionalSprite } from '../../visual/directionalSprite';

const WALK_FRAME_COUNT = 6;

/** Ground tilemap and the two character sprites, with i-frame / attack tints. */
export class WorldView {
  readonly playerSprite: DirectionalSprite;
  readonly assaltanteSprite: DirectionalSprite;

  constructor(scene: Phaser.Scene) {
    createGroundTilemap(scene, ARENA_BOUNDS, ISO_CONFIG);
    this.playerSprite = new DirectionalSprite(
      scene,
      { idleTextureKey: ASSET_KEYS.playerIdle, walkTextureKey: ASSET_KEYS.playerWalk, walkFrameCount: WALK_FRAME_COUNT },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 100, y: 300 },
      ISO_CONFIG,
    );
    this.assaltanteSprite = new DirectionalSprite(
      scene,
      { idleTextureKey: ASSET_KEYS.assaltanteIdle, walkTextureKey: ASSET_KEYS.assaltanteWalk, walkFrameCount: WALK_FRAME_COUNT },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 400, y: 300 },
      ISO_CONFIG,
    );
  }

  sync(encounter: Encounter<ProfileSink>, playerMoving: boolean): void {
    this.playerSprite.syncPosition(encounter.player.position);
    this.playerSprite.syncDirection(encounter.player.facing, playerMoving);
    this.playerSprite.setTint(encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(encounter.assaltante.position);
    this.assaltanteSprite.syncDirection(
      encounter.assaltante.attackDirection,
      encounter.assaltante.state === 'chasing',
    );
    this.assaltanteSprite.setTint(encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xffffff);
  }
}
