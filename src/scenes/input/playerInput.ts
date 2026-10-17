import Phaser from 'phaser';
import type { ActionType } from '../../combat/actionRegistry';
import type { Vec2 } from '../../combat/types';
import { aimOrigin, mapAim, mapMovement } from './mapMovement';

export interface PlayerIntents {
  setMoveInput(dx: number, dy: number): void;
  setAimDirection(v: Vec2): void;
  switchWeapon(id: string): void;
  releaseAction(): void;
  tryDodge(): void;
  startBlock(): void;
  stopBlock(): void;
  tryEquippedAction(type: ActionType): boolean;
  readonly equippedWeaponId: string;
  readonly position: Vec2;
}

export interface InputSnapshot {
  keysDown: string[];
  move: { dx: number; dy: number };
  aim: Vec2;
}

const KC = Phaser.Input.Keyboard.KeyCodes;

/** Reads keyboard and pointer and drives the player's intents; does nothing while `intents()` is null. */
export class PlayerInput {
  private readonly keys: Record<
    'weapon1' | 'weapon2' | 'weapon3' | 'charged' | 'dodge' | 'guard' | 'up' | 'down' | 'left' | 'right',
    Phaser.Input.Keyboard.Key
  >;
  private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin;
  private move = { dx: 0, dy: 0 };
  private aim: Vec2 = { x: 0, y: 0 };
  private readonly onPointerDown: (pointer: Phaser.Input.Pointer) => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly intents: () => PlayerIntents | null,
  ) {
    scene.input.mouse?.disableContextMenu();
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    this.keyboard = keyboard;
    this.keys = {
      weapon1: keyboard.addKey(KC.ONE),
      weapon2: keyboard.addKey(KC.TWO),
      weapon3: keyboard.addKey(KC.THREE),
      charged: keyboard.addKey(KC.Q),
      dodge: keyboard.addKey(KC.SPACE),
      guard: keyboard.addKey(KC.E),
      up: keyboard.addKey(KC.W),
      down: keyboard.addKey(KC.S),
      left: keyboard.addKey(KC.A),
      right: keyboard.addKey(KC.D),
    };
    const k = this.keys;
    k.weapon1.on('down', () => this.intents()?.switchWeapon('sword_shield'));
    k.weapon2.on('down', () => this.intents()?.switchWeapon('bow'));
    k.weapon3.on('down', () => this.intents()?.switchWeapon('heavy_weapon'));
    k.charged.on('down', () => this.tryAction('charged'));
    k.charged.on('up', () => this.intents()?.releaseAction());
    k.dodge.on('down', () => this.intents()?.tryDodge());
    k.guard.on('down', () => this.intents()?.startBlock());
    k.guard.on('up', () => this.intents()?.stopBlock());

    this.onPointerDown = (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        if (!this.tryAction('light')) this.tryAction('throw');
      } else if (pointer.rightButtonDown()) {
        this.tryAction('heavy');
      }
    };
    scene.input.on('pointerdown', this.onPointerDown);
  }

  /** Per-frame: aim from the pointer, move from WASD. */
  update(): void {
    const intents = this.intents();
    if (!intents) return;
    const pointer = this.scene.input.activePointer;
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.aim = mapAim(worldPoint, aimOrigin(intents.position));
    intents.setAimDirection(this.aim);

    const k = this.keys;
    const ix = (k.right.isDown ? 1 : 0) - (k.left.isDown ? 1 : 0);
    const iy = (k.down.isDown ? 1 : 0) - (k.up.isDown ? 1 : 0);
    this.move = mapMovement(ix, iy);
    intents.setMoveInput(this.move.dx, this.move.dy);
  }

  snapshot(): InputSnapshot {
    const down: string[] = [];
    for (const [name, key] of Object.entries(this.keys)) if (key.isDown) down.push(name);
    return { keysDown: down, move: { ...this.move }, aim: { ...this.aim } };
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown);
    for (const key of Object.values(this.keys)) {
      key.removeAllListeners();
      this.keyboard.removeKey(key);
    }
  }

  private tryAction(type: ActionType): boolean {
    return this.intents()?.tryEquippedAction(type) ?? false;
  }
}
