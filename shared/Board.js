export const BOARD_SIZE = 15;
export const START_SQUARE = Object.freeze({ x: 7, y: 7 });

export const MULTIPLIER = Object.freeze({
  NORMAL: "N",
  DOUBLE_LETTER: "DL",
  TRIPLE_LETTER: "TL",
  DOUBLE_WORD: "DW",
  TRIPLE_WORD: "TW"
});

const N = MULTIPLIER.NORMAL;
const DL = MULTIPLIER.DOUBLE_LETTER;
const TL = MULTIPLIER.TRIPLE_LETTER;
const DW = MULTIPLIER.DOUBLE_WORD;
const TW = MULTIPLIER.TRIPLE_WORD;

export const BOARD_LAYOUT = Object.freeze([
  [TW, N, N, DL, N, N, N, TW, N, N, N, DL, N, N, TW],
  [N, DW, N, N, N, TL, N, N, N, TL, N, N, N, DW, N],
  [N, N, DW, N, N, N, DL, N, DL, N, N, N, DW, N, N],
  [DL, N, N, DW, N, N, N, DL, N, N, N, DW, N, N, DL],
  [N, N, N, N, DW, N, N, N, N, N, DW, N, N, N, N],
  [N, TL, N, N, N, TL, N, N, N, TL, N, N, N, TL, N],
  [N, N, DL, N, N, N, DL, N, DL, N, N, N, DL, N, N],
  [TW, N, N, DL, N, N, N, DW, N, N, N, DL, N, N, TW],
  [N, N, DL, N, N, N, DL, N, DL, N, N, N, DL, N, N],
  [N, TL, N, N, N, TL, N, N, N, TL, N, N, N, TL, N],
  [N, N, N, N, DW, N, N, N, N, N, DW, N, N, N, N],
  [DL, N, N, DW, N, N, N, DL, N, N, N, DW, N, N, DL],
  [N, N, DW, N, N, N, DL, N, DL, N, N, N, DW, N, N],
  [N, DW, N, N, N, TL, N, N, N, TL, N, N, N, DW, N],
  [TW, N, N, DL, N, N, N, TW, N, N, N, DL, N, N, TW]
]);

export function inBounds(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

export function getMultiplier(x, y) {
  if (!inBounds(x, y)) {
    return MULTIPLIER.NORMAL;
  }
  return BOARD_LAYOUT[y][x] ?? MULTIPLIER.NORMAL;
}

export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
}

export function isCenterSquare(x, y) {
  return x === START_SQUARE.x && y === START_SQUARE.y;
}
