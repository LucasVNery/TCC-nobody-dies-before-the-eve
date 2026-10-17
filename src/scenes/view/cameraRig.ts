import Phaser from 'phaser';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import type { Vec2 } from '../../combat/types';
import { toScreen, GROUND_PROJECTION } from '../../visual/groundProjection';
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
    const arenaCorners: Vec2[] = [
      { x: ARENA_BOUNDS.x, y: ARENA_BOUNDS.y },
      { x: ARENA_BOUNDS.x + ARENA_BOUNDS.width, y: ARENA_BOUNDS.y },
      { x: ARENA_BOUNDS.x, y: ARENA_BOUNDS.y + ARENA_BOUNDS.height },
      { x: ARENA_BOUNDS.x + ARENA_BOUNDS.width, y: ARENA_BOUNDS.y + ARENA_BOUNDS.height },
    ];
    const projectedCorners = arenaCorners.map((corner) => toScreen(corner, GROUND_PROJECTION));
    const margin = GROUND_PROJECTION.tileScreenWidth;
    const minX = Math.min(...projectedCorners.map((p) => p.x)) - margin;
    const maxX = Math.max(...projectedCorners.map((p) => p.x)) + margin;
    const minY = Math.min(...projectedCorners.map((p) => p.y)) - margin;
    const maxY = Math.max(...projectedCorners.map((p) => p.y)) + margin;

    const main = scene.cameras.main;
    main.setBounds(minX, minY, maxX - minX, maxY - minY);
    main.startFollow(follow);
    main.setZoom(DEFAULT_ZOOM);
    scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      main.setZoom(zoomAfterWheel(main.zoom, dy));
    });

    main.ignore(uiObjects);
    const uiCamera = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
    uiCamera.ignore(scene.children.list.filter((obj) => !uiObjects.includes(obj)));
  }
}
