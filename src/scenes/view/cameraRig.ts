import Phaser from 'phaser';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { GROUND_PROJECTION } from '../../visual/groundProjection';
import { CAMERA_FOLLOW_LERP, VOID_COLOR, worldCameraBounds } from '../../visual/cameraDefaults';
import { DEFAULT_ZOOM, zoomAfterWheel } from '../../visual/cameraZoom';

/**
 * Main camera draws only the world (bounded, following the player, wheel zoom);
 * a separate unzoomed UI camera draws only the UI objects.
 */
export class CameraRig {
  constructor(private readonly scene: Phaser.Scene) {}

  /** All world objects must already exist when this is called. */
  attach(follow: Phaser.GameObjects.Container, uiObjects: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    const bounds = worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, 2);

    const main = scene.cameras.main;
    main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    main.startFollow(follow, true, CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_LERP);
    main.roundPixels = true;
    main.setBackgroundColor(VOID_COLOR);
    main.setZoom(DEFAULT_ZOOM);
    scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      main.setZoom(zoomAfterWheel(main.zoom, dy));
    });

    main.ignore(uiObjects);
    const uiCamera = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
    uiCamera.ignore(scene.children.list.filter((obj) => !uiObjects.includes(obj)));
  }
}
