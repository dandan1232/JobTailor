declare module "fontkit" {
  export function create(buffer: Buffer): {
    hasGlyphForCodePoint(codePoint: number): boolean;
  };
}
