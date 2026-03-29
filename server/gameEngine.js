import crypto from "node:crypto";

import {
  BOARD_SIZE,
  MULTIPLIER,
  createEmptyBoard,
  getMultiplier,
  inBounds
} from "../shared/Board.js";
import {
  BLANK_SYMBOL,
  RACK_SIZE,
  buildInitialBag,
  drawTiles,
  shuffleInPlace,
  totalTilePoints
} from "../shared/Letters.js";

export class GameRuleError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "GameRuleError";
    this.statusCode = statusCode;
  }
}

const GAME_CODES = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function nowIso() {
  return new Date().toISOString();
}

function createPlayer(name, key) {
  return {
    name,
    key,
    score: 0,
    rack: [],
    joinedAt: nowIso(),
    lastSeenAt: nowIso()
  };
}

function otherPlayerIndex(playerIndex) {
  return playerIndex === 0 ? 1 : 0;
}

function appendHistory(game, text, type = "info") {
  game.history.push({
    ts: nowIso(),
    type,
    text
  });

  if (game.history.length > 80) {
    game.history = game.history.slice(game.history.length - 80);
  }
}

function getRackById(rack) {
  return new Map(rack.map((tile) => [tile.id, tile]));
}

function normalizePlacements(placements) {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new GameRuleError("Place at least one tile.");
  }

  return placements.map((placement, index) => {
    const x = Number(placement?.x);
    const y = Number(placement?.y);
    const tileId = String(placement?.tileId ?? "").trim();
    const providedLetter =
      placement?.letter == null ? "" : String(placement.letter).trim().toUpperCase();

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new GameRuleError(`Placement ${index + 1} has invalid coordinates.`);
    }

    if (!inBounds(x, y)) {
      throw new GameRuleError("A tile was placed outside the board.");
    }

    if (!tileId) {
      throw new GameRuleError("A placed tile is missing an id.");
    }

    if (providedLetter && !/^[A-Z]$/.test(providedLetter)) {
      throw new GameRuleError("Blank tiles must be assigned a single A-Z letter.");
    }

    return {
      x,
      y,
      tileId,
      letter: providedLetter
    };
  });
}

function validateNoPlacementConflicts(game, placements) {
  const usedCoordinates = new Set();

  for (const placement of placements) {
    const key = `${placement.x},${placement.y}`;

    if (usedCoordinates.has(key)) {
      throw new GameRuleError("Each placement must target a unique square.");
    }
    usedCoordinates.add(key);

    if (game.board[placement.y][placement.x]) {
      throw new GameRuleError("You cannot place tiles on occupied squares.");
    }
  }
}

function boardHasAnyTiles(board) {
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x]) {
        return true;
      }
    }
  }

  return false;
}

function placementsTouchExistingBoardTile(game, placements) {
  for (const placement of placements) {
    const { x, y } = placement;
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];

    for (const [neighborX, neighborY] of neighbors) {
      if (!inBounds(neighborX, neighborY)) {
        continue;
      }

      if (game.board[neighborY][neighborX]) {
        return true;
      }
    }
  }

  return false;
}

function validatePlacementAdjacency(game, placements) {
  if (!boardHasAnyTiles(game.board)) {
    return;
  }

  if (!placementsTouchExistingBoardTile(game, placements)) {
    throw new GameRuleError("New tiles must connect to an existing word.");
  }
}

function calculateFreestylePlacementScore(placements) {
  let letterTotal = 0;
  let wordMultiplier = 1;

  for (const placement of placements) {
    let tileScore = placement.cell.points;
    const multiplier = getMultiplier(placement.x, placement.y);

    if (multiplier === MULTIPLIER.DOUBLE_LETTER) {
      tileScore *= 2;
    } else if (multiplier === MULTIPLIER.TRIPLE_LETTER) {
      tileScore *= 3;
    }

    if (multiplier === MULTIPLIER.DOUBLE_WORD) {
      wordMultiplier *= 2;
    } else if (multiplier === MULTIPLIER.TRIPLE_WORD) {
      wordMultiplier *= 3;
    }

    letterTotal += tileScore;
  }

  return letterTotal * wordMultiplier;
}

function finalizeGame(game, reason, finishingPlayerIndex = null) {
  if (game.status === "finished") {
    return;
  }

  const rackTotals = game.players.map((player) => (player ? totalTilePoints(player.rack) : 0));

  if (
    reason === "went_out" &&
    Number.isInteger(finishingPlayerIndex) &&
    game.players[finishingPlayerIndex]
  ) {
    let bonus = 0;

    for (let i = 0; i < game.players.length; i += 1) {
      if (i === finishingPlayerIndex || !game.players[i]) {
        continue;
      }

      game.players[i].score -= rackTotals[i];
      bonus += rackTotals[i];
    }

    game.players[finishingPlayerIndex].score += bonus;
    appendHistory(
      game,
      `${game.players[finishingPlayerIndex].name} went out and receives ${bonus} bonus points from remaining tiles.`,
      "result"
    );
  } else {
    for (let i = 0; i < game.players.length; i += 1) {
      if (!game.players[i]) {
        continue;
      }
      game.players[i].score -= rackTotals[i];
    }

    appendHistory(game, "Game ended after six consecutive scoreless turns.", "result");
  }

  const scores = game.players.map((player) => (player ? player.score : Number.NEGATIVE_INFINITY));
  const maxScore = Math.max(...scores);
  const winners = scores
    .map((score, index) => ({ score, index }))
    .filter(({ score }) => score === maxScore);

  game.winnerIndex = winners.length === 1 ? winners[0].index : null;
  game.status = "finished";
  game.turnIndex = null;
  game.endedReason = reason;
}

function ensureReadyTurn(game, playerIndex) {
  if (game.status === "waiting") {
    throw new GameRuleError("Waiting for a second player to join.", 409);
  }

  if (game.status === "finished") {
    throw new GameRuleError("This game is already finished.", 409);
  }

  if (game.turnIndex !== playerIndex) {
    throw new GameRuleError("It is not your turn.", 409);
  }
}

function markUpdated(game) {
  game.updatedAt = nowIso();
}

export function createPlayerKey() {
  return crypto.randomBytes(16).toString("hex");
}

export function generateGameCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += GAME_CODES[Math.floor(random() * GAME_CODES.length)];
  }
  return code;
}

export function createNewGame({ code, hostName, hostKey, random = Math.random }) {
  const bag = buildInitialBag(random);
  const host = createPlayer(hostName, hostKey);
  host.rack.push(...drawTiles(bag, RACK_SIZE));

  return {
    code,
    status: "waiting",
    players: [host, null],
    bag,
    board: createEmptyBoard(),
    turnIndex: 0,
    winnerIndex: null,
    endedReason: null,
    consecutiveScorelessTurns: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [
      {
        ts: nowIso(),
        type: "system",
        text: `${hostName} created game ${code}.`
      }
    ]
  };
}

export function resolvePlayerIndex(game, { playerKey, name }) {
  if (playerKey) {
    const matchByKey = game.players.findIndex((player) => player && player.key === playerKey);
    if (matchByKey >= 0) {
      return matchByKey;
    }
  }

  if (!name) {
    return -1;
  }

  const normalizedName = name.trim().toLowerCase();
  return game.players.findIndex(
    (player) => player && player.name.trim().toLowerCase() === normalizedName
  );
}

export function joinExistingGame(game, { name, playerKey }) {
  const existingIndex = resolvePlayerIndex(game, { playerKey, name });

  if (existingIndex >= 0) {
    const existingPlayer = game.players[existingIndex];
    existingPlayer.lastSeenAt = nowIso();

    if (!existingPlayer.key && playerKey) {
      existingPlayer.key = playerKey;
    }

    markUpdated(game);

    return {
      playerIndex: existingIndex,
      playerKey: existingPlayer.key,
      createdSeat: false
    };
  }

  const openIndex = game.players.findIndex((player) => player === null);

  if (openIndex < 0) {
    throw new GameRuleError("This game already has two players.", 409);
  }

  const key = playerKey || createPlayerKey();
  const newPlayer = createPlayer(name, key);
  newPlayer.rack.push(...drawTiles(game.bag, RACK_SIZE));
  game.players[openIndex] = newPlayer;

  appendHistory(game, `${name} joined the game.`, "system");

  if (game.players.every((player) => Boolean(player)) && game.status === "waiting") {
    game.status = "active";
    appendHistory(game, "Both players are ready. The game has started.", "system");
  }

  markUpdated(game);

  return {
    playerIndex: openIndex,
    playerKey: key,
    createdSeat: true
  };
}

export function applyPlay(game, playerIndex, placementsInput) {
  ensureReadyTurn(game, playerIndex);

  const player = game.players[playerIndex];
  if (!player) {
    throw new GameRuleError("Player seat is not valid.", 400);
  }

  const placements = normalizePlacements(placementsInput);
  validateNoPlacementConflicts(game, placements);
  validatePlacementAdjacency(game, placements);

  const rackById = getRackById(player.rack);
  const usedTileIds = new Set();
  const newCells = new Map();

  for (const placement of placements) {
    if (usedTileIds.has(placement.tileId)) {
      throw new GameRuleError("A tile cannot be used twice in one move.");
    }

    const tile = rackById.get(placement.tileId);
    if (!tile) {
      throw new GameRuleError("One or more played tiles are not in your rack.");
    }

    let letter = tile.letter;
    if (tile.letter === BLANK_SYMBOL) {
      if (!placement.letter || !/^[A-Z]$/.test(placement.letter)) {
        throw new GameRuleError("Blank tiles require an assigned letter.");
      }
      letter = placement.letter;
    } else if (placement.letter && placement.letter !== tile.letter) {
      throw new GameRuleError("Assigned letters can only be used with blank tiles.");
    }

    const coordinate = `${placement.x},${placement.y}`;
    newCells.set(coordinate, {
      x: placement.x,
      y: placement.y,
      cell: {
        tileId: tile.id,
        letter,
        points: tile.points,
        isBlank: tile.letter === BLANK_SYMBOL,
        owner: playerIndex
      }
    });

    usedTileIds.add(tile.id);
  }

  const boardAfter = game.board.map((row) => row.slice());
  for (const placement of newCells.values()) {
    boardAfter[placement.y][placement.x] = placement.cell;
  }

  let moveScore = calculateFreestylePlacementScore([...newCells.values()]);

  if (placements.length === RACK_SIZE) {
    moveScore += 50;
  }

  game.board = boardAfter;
  player.rack = player.rack.filter((tile) => !usedTileIds.has(tile.id));
  player.rack.push(...drawTiles(game.bag, RACK_SIZE - player.rack.length));
  player.score += moveScore;
  player.lastSeenAt = nowIso();

  if (moveScore > 0) {
    game.consecutiveScorelessTurns = 0;
  } else {
    game.consecutiveScorelessTurns += 1;
  }

  const placedLetters = placements
    .map((placement) => newCells.get(`${placement.x},${placement.y}`)?.cell.letter ?? "")
    .join("");
  appendHistory(
    game,
    `${player.name} placed ${placements.length} tile(s) (${placedLetters}) for ${moveScore} points.`,
    "move"
  );

  const nextPlayer = otherPlayerIndex(playerIndex);

  if (game.bag.length === 0 && player.rack.length === 0) {
    finalizeGame(game, "went_out", playerIndex);
  } else if (game.consecutiveScorelessTurns >= 6) {
    finalizeGame(game, "scoreless");
  } else if (game.players[nextPlayer]) {
    game.turnIndex = nextPlayer;
  }

  markUpdated(game);
  return {
    moveScore,
    words: [placedLetters]
  };
}

export function applyPass(game, playerIndex) {
  ensureReadyTurn(game, playerIndex);
  const player = game.players[playerIndex];
  if (!player) {
    throw new GameRuleError("Player seat is not valid.");
  }

  appendHistory(game, `${player.name} passed.`, "move");
  game.consecutiveScorelessTurns += 1;

  if (game.consecutiveScorelessTurns >= 6) {
    finalizeGame(game, "scoreless");
  } else {
    const nextPlayer = otherPlayerIndex(playerIndex);
    if (game.players[nextPlayer]) {
      game.turnIndex = nextPlayer;
    }
  }

  markUpdated(game);
}

export function applyExchange(game, playerIndex, requestedTileIds) {
  ensureReadyTurn(game, playerIndex);
  const player = game.players[playerIndex];
  if (!player) {
    throw new GameRuleError("Player seat is not valid.");
  }

  if (!Array.isArray(requestedTileIds) || requestedTileIds.length === 0) {
    throw new GameRuleError("Select one or more tiles to exchange.");
  }

  const tileIds = [...new Set(requestedTileIds.map((id) => String(id)))];

  if (game.bag.length < tileIds.length) {
    throw new GameRuleError("Not enough tiles remain in the bag to exchange.");
  }

  const rackById = getRackById(player.rack);
  const exchangedTiles = tileIds.map((id) => {
    const tile = rackById.get(id);
    if (!tile) {
      throw new GameRuleError("One or more exchange tiles are not in your rack.");
    }
    return tile;
  });

  player.rack = player.rack.filter((tile) => !tileIds.includes(tile.id));
  game.bag.push(...exchangedTiles);
  shuffleInPlace(game.bag);
  player.rack.push(...drawTiles(game.bag, tileIds.length));

  appendHistory(game, `${player.name} exchanged ${tileIds.length} tile(s).`, "move");
  game.consecutiveScorelessTurns += 1;

  if (game.consecutiveScorelessTurns >= 6) {
    finalizeGame(game, "scoreless");
  } else {
    const nextPlayer = otherPlayerIndex(playerIndex);
    if (game.players[nextPlayer]) {
      game.turnIndex = nextPlayer;
    }
  }

  markUpdated(game);
}

function serializeBoard(board) {
  return board.map((row) =>
    row.map((cell) =>
      cell
        ? {
            letter: cell.letter,
            points: cell.points,
            isBlank: cell.isBlank,
            owner: cell.owner
          }
        : null
    )
  );
}

function serializeRack(rack) {
  return rack.map((tile) => ({
    id: tile.id,
    letter: tile.letter,
    points: tile.points
  }));
}

export function toPublicGameState(game, viewerIndex, presence = [0, 0]) {
  const viewer =
    Number.isInteger(viewerIndex) && game.players[viewerIndex] ? game.players[viewerIndex] : null;

  return {
    code: game.code,
    status: game.status,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    turnIndex: game.turnIndex,
    winnerIndex: game.winnerIndex,
    endedReason: game.endedReason,
    bagCount: game.bag.length,
    consecutiveScorelessTurns: game.consecutiveScorelessTurns,
    myIndex: viewerIndex,
    players: game.players.map((player, index) =>
      player
        ? {
            index,
            name: player.name,
            score: player.score,
            tileCount: player.rack.length,
            connected: (presence[index] ?? 0) > 0
          }
        : null
    ),
    myRack: viewer ? serializeRack(viewer.rack) : [],
    board: serializeBoard(game.board),
    history: game.history.slice(-20)
  };
}

export function validateGameShape(game) {
  if (!game || typeof game !== "object") {
    throw new GameRuleError("Game was not found.", 404);
  }

  if (!Array.isArray(game.players) || game.players.length !== 2) {
    throw new GameRuleError("Game data is invalid.", 500);
  }

  if (!Array.isArray(game.board) || game.board.length !== BOARD_SIZE) {
    throw new GameRuleError("Game board is invalid.", 500);
  }
}



