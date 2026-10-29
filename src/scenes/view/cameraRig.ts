import Phaser from 'phaser';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { GROUND_PROJECTION } from '../../visual/groundProjection';
import { CAMERA_FOLLOW_LERP, VOID_COLOR, worldCameraBounds } from '../../visual/cameraDefaults';
import { DEFAULT_ZOOM, zoomAfterWheel } from '../../visual/cameraZoom';
import { SKIRT_TILES } from '../../visual/floor/composeFloor';
import { followLerp } from '../../visual/stepInterpolation';

/**
 * Main camera draws only the world (bounded, following the player, wheel zoom);
 * a separate unzoomed UI camera draws only the UI objects.
 */
export class CameraRig {
  private shakeAmplitude = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** All world objects must already exist when this is called. */
  attach(follow: Phaser.GameObjects.Container, uiObjects: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    const bounds = worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, SKIRT_TILES);

    const main = scene.cameras.main;
    main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    main.startFollow(follow, false, CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_LERP);
    main.setBackgroundColor(VOID_COLOR);
    main.setZoom(DEFAULT_ZOOM);
    scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      main.setZoom(zoomAfterWheel(main.zoom, dy));
    });

    main.ignore(uiObjects);
    const uiCamera = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
    uiCamera.ignore(scene.children.list.filter((obj) => !uiObjects.includes(obj)));
  }

  /**
   * Camera shake on the main (world) camera only, so the UI camera stays still. Amplitude `px` is in screen px
   * and decays linearly to 0 over `decayMs`; a weaker request never cuts a stronger shake short.
   */
  shake(px: number, decayMs: number): void {
    const main = this.scene.cameras.main;
    const effect = main.shakeEffect;
    if (effect.isRunning && px < this.shakeAmplitude * (1 - effect.progress)) return;
    this.shakeAmplitude = px;
    main.shake(decayMs, 0, true, (cam: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      // Phaser's offset is intensity * viewport * zoom; scale so the peak offset is `px` on screen at any zoom.
      cam.shakeEffect.intensity.set((this.shakeAmplitude * (1 - progress)) / (cam.width * cam.zoom));
    });
  }

  /** Once per frame: scales the follow lerp by the frame time so the camera converges at the same rate at any frame rate. */
  update(deltaMs: number): void {
    const lerp = followLerp(CAMERA_FOLLOW_LERP, deltaMs);
    this.scene.cameras.main.setLerp(lerp, lerp);
  }
}
