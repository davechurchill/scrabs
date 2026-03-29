export const BLANK_SYMBOL = "?";
export const RACK_SIZE = 7;

export const LETTER_VALUES = Object.freeze({
  A: 1,
  B: 3,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 2,
  H: 4,
  I: 1,
  J: 8,
  K: 5,
  L: 1,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 1,
  V: 4,
  W: 4,
  X: 8,
  Y: 4,
  Z: 10,
  [BLANK_SYMBOL]: 0
});

export const LETTER_DISTRIBUTION = Object.freeze({
  A: 9,
  B: 2,
  C: 2,
  D: 4,
  E: 12,
  F: 2,
  G: 3,
  H: 2,
  I: 9,
  J: 1,
  K: 1,
  L: 4,
  M: 2,
  N: 6,
  O: 8,
  P: 2,
  Q: 1,
  R: 6,
  S: 4,
  T: 6,
  U: 4,
  V: 2,
  W: 2,
  X: 1,
  Y: 2,
  Z: 1,
  [BLANK_SYMBOL]: 2
});

export function getTilePoints(letter) {
  return LETTER_VALUES[letter] ?? 0;
}

export function tileDisplayLetter(tile) {
  if (!tile) {
    return "";
  }

  if (tile.letter === BLANK_SYMBOL) {
    return "_";
  }

  return tile.letter;
}

export function shuffleInPlace(items, random = Math.random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export function buildInitialBag(random = Math.random) {
  const bag = [];
  let nextId = 1;

  for (const [letter, count] of Object.entries(LETTER_DISTRIBUTION)) {
    const points = getTilePoints(letter);
    for (let i = 0; i < count; i += 1) {
      bag.push({
        id: `tile-${nextId}`,
        letter,
        points
      });
      nextId += 1;
    }
  }

  shuffleInPlace(bag, random);
  return bag;
}

export function drawTiles(bag, count) {
  const drawn = [];
  for (let i = 0; i < count && bag.length > 0; i += 1) {
    const tile = bag.pop();
    if (tile) {
      drawn.push(tile);
    }
  }
  return drawn;
}

export function totalTilePoints(tiles) {
  return tiles.reduce((total, tile) => total + (tile?.points ?? 0), 0);
}
