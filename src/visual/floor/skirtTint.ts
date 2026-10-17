// Grey tint for skirt tiles: white at the playable edge, darkening to 0x666666 at the outer ring.

export function skirtTint(distance: number, skirt: number): number {
  const t = skirt > 0 ? Math.min(1, Math.max(0, distance / skirt)) : 0;
  const c = Math.round(255 * (1 - 0.6 * t));
  return (c << 16) | (c << 8) | c;
}
