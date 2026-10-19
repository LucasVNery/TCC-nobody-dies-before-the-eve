// Floor tile asset registry: ids, texture keys and URLs of the Blender-rendered tiles
// (tools/blender/render_floor_tiles.py). No Phaser import: the floor dependency rule
// forbids it, so loadFloorTiles takes the structural slice of a scene it needs
// (a Phaser.Scene satisfies it).

export const FLOOR_TILE_IDS: readonly string[] = ['floor_base', 'floor_a', 'floor_b', 'floor_worn', 'floor_edge'];

export const FLOOR_TILE_KEYS: Record<string, string> = Object.fromEntries(
  FLOOR_TILE_IDS.map((id) => [id, `floor:${id}`]),
);

export const FLOOR_TILE_URLS: Record<string, string> = Object.fromEntries(
  FLOOR_TILE_IDS.map((id) => [id, `/assets/tiles/floor/${id}.png`]),
);

/** Native pixel size of every floor tile PNG (drawn at half size as a 64x32 diamond). */
export const FLOOR_TILE_TEXTURE = { width: 128, height: 64 } as const;

export interface FloorTileLoaderScene {
  load: { image(key: string, url: string): unknown };
}

export function loadFloorTiles(scene: FloorTileLoaderScene): void {
  for (const id of FLOOR_TILE_IDS) scene.load.image(FLOOR_TILE_KEYS[id], FLOOR_TILE_URLS[id]);
}
