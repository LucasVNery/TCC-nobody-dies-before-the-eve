import type Phaser from 'phaser';
import type { Encounter } from '../../combat/encounter';
import type { ProfileSink } from '../../profile/profileSink';
import type { Vec2, AABB } from '../../combat/types';
import type { AttackSector } from '../../combat/sector';
import { ATTACK_RANGE } from '../../ai/rules/assaltanteRules';
import { ENTITY_SIZE } from '../../visual/placeholderTextures';
import { toScreen, GROUND_PROJECTION, type GroundProjection } from '../../visual/groundProjection';

const HURTBOX_COLOR = 0xffffff;
const ATTACK_HITBOX_COLOR = 0xffeb3b;
const ATTACK_RANGE_COLOR = 0xff9800;

/** Projected sector outline: the origin first, then `samples + 1` arc points. */
export function sectorPoints(sector: AttackSector, projection: GroundProjection, samples = 10): Vec2[] {
  const centerAngle = Math.atan2(sector.direction.y, sector.direction.x);
  const points: Vec2[] = [toScreen(sector.origin, projection)];
  for (let i = 0; i <= samples; i++) {
    const angle = centerAngle - sector.halfAngleRad + (2 * sector.halfAngleRad * i) / samples;
    points.push(
      toScreen(
        {
          x: sector.origin.x + Math.cos(angle) * sector.reach,
          y: sector.origin.y + Math.sin(angle) * sector.reach,
        },
        projection,
      ),
    );
  }
  return points;
}

/** The four projected corners of a box, in order. */
export function boxCorners(box: AABB, projection: GroundProjection): Vec2[] {
  const corners: Vec2[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  return corners.map((corner) => toScreen(corner, projection));
}

/** On-screen size of a circular world range (radius `range`) under the projection. */
export function rangeEllipseSize(range: number, p: GroundProjection): { width: number; height: number } {
  const diameter = { x: range * 2, y: range * 2 };
  const projected = toScreen(diameter, p);
  return { width: projected.x, height: projected.y };
}

export class DebugDraw {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(100000);
  }

  draw(encounter: Encounter<ProfileSink>): void {
    const g = this.graphics;
    g.clear();

    g.lineStyle(1, HURTBOX_COLOR, 0.6);
    g.strokePoints(boxCorners(encounter.player.hurtbox(), GROUND_PROJECTION), true);
    g.strokePoints(boxCorners(encounter.assaltante.hurtbox(), GROUND_PROJECTION), true);

    const assaltanteCenter: Vec2 = {
      x: encounter.assaltante.position.x + ENTITY_SIZE / 2,
      y: encounter.assaltante.position.y + ENTITY_SIZE / 2,
    };
    const rangeScreenCenter = toScreen(assaltanteCenter, GROUND_PROJECTION);
    g.lineStyle(1, ATTACK_RANGE_COLOR, 0.6);
    const rangeSize = rangeEllipseSize(ATTACK_RANGE, GROUND_PROJECTION);
    g.strokeEllipse(rangeScreenCenter.x, rangeScreenCenter.y, rangeSize.width, rangeSize.height);

    g.fillStyle(ATTACK_HITBOX_COLOR, 0.4);
    const playerAttack = encounter.player.attackHitbox();
    if (playerAttack) g.fillPoints(sectorPoints(playerAttack, GROUND_PROJECTION), true);
    const assaltanteAttack = encounter.assaltante.attackHitbox();
    if (assaltanteAttack) g.fillPoints(sectorPoints(assaltanteAttack, GROUND_PROJECTION), true);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
