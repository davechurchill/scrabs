import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { MongoClient } from "mongodb";
import { WebSocketServer, WebSocket } from "ws";

import {
  GameRuleError,
  applyExchange,
  applyPass,
  applyPlay,
  createNewGame,
  createPlayerKey,
  generateGameCode,
  joinExistingGame,
  resolvePlayerIndex,
  toPublicGameState,
  validateGameShape
} from "./gameEngine.js";

const PORT = Number(process.env.PORT ?? 3000);
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/scrabble";
const MONGODB_DB = process.env.MONGODB_DB ?? "scrabble";
const GAME_COLLECTION = "games";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/shared", express.static(path.join(rootDir, "shared")));
app.use(express.static(path.join(rootDir, "public")));

const mongoClient = new MongoClient(MONGODB_URI);
let gamesCollection;

const roomSockets = new Map();
const roomPresence = new Map();
const gameLocks = new Map();

function sanitizeName(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 24) {
    throw new GameRuleError("Name must be between 1 and 24 characters.", 400);
  }
  return normalized;
}

function sanitizeCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    throw new GameRuleError("Game code must be 6 letters/numbers.", 400);
  }
  return normalized;
}

function sanitizeOptionalKey(value) {
  const key = value == null ? "" : String(value).trim();
  if (!key) {
    return "";
  }

  if (!/^[a-f0-9]{32}$/i.test(key)) {
    throw new GameRuleError("Invalid player key format.", 400);
  }

  return key.toLowerCase();
}

function getPresence(code) {
  return roomPresence.get(code) ?? [0, 0];
}

function incrementPresence(code, playerIndex) {
  const counts = [...getPresence(code)];
  counts[playerIndex] = (counts[playerIndex] ?? 0) + 1;
  roomPresence.set(code, counts);
}

function decrementPresence(code, playerIndex) {
  const counts = [...getPresence(code)];
  counts[playerIndex] = Math.max((counts[playerIndex] ?? 1) - 1, 0);

  if ((counts[0] ?? 0) === 0 && (counts[1] ?? 0) === 0) {
    roomPresence.delete(code);
  } else {
    roomPresence.set(code, counts);
  }
}

function withGameLock(code, task) {
  const previous = gameLocks.get(code) ?? Promise.resolve();

  const next = previous
    .catch(() => undefined)
    .then(() => task());

  gameLocks.set(
    code,
    next.finally(() => {
      if (gameLocks.get(code) === next) {
        gameLocks.delete(code);
      }
    })
  );

  return next;
}

async function findGameByCode(code) {
  return gamesCollection.findOne({ code });
}

async function saveGame(game) {
  const { _id, ...doc } = game;
  await gamesCollection.updateOne({ code: game.code }, { $set: doc });
}

async function createGameWithUniqueCode(hostName) {
  const hostKey = createPlayerKey();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = generateGameCode();
    const game = createNewGame({
      code,
      hostName,
      hostKey
    });

    try {
      await gamesCollection.insertOne(game);
      return {
        game,
        playerKey: hostKey,
        playerIndex: 0
      };
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  throw new GameRuleError("Could not generate a unique game code. Try again.", 500);
}

function respondWithError(res, error) {
  if (error instanceof GameRuleError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Unexpected server error." });
}

function sendWsError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", error: message }));
  }
}

async function broadcastGameState(code) {
  const sockets = roomSockets.get(code);
  if (!sockets || sockets.size === 0) {
    return;
  }

  const game = await findGameByCode(code);
  if (!game) {
    return;
  }

  validateGameShape(game);
  const presence = getPresence(code);

  for (const ws of sockets) {
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }

    const view = toPublicGameState(game, ws.playerIndex, presence);
    ws.send(JSON.stringify({ type: "state", state: view }));
  }
}

async function handleAction(ws, payload) {
  const code = ws.gameCode;

  await withGameLock(code, async () => {
    const game = await findGameByCode(code);
    if (!game) {
      throw new GameRuleError("Game was not found.", 404);
    }

    validateGameShape(game);

    const resolvedIndex = resolvePlayerIndex(game, {
      playerKey: ws.playerKey,
      name: ws.playerName
    });

    if (resolvedIndex !== ws.playerIndex) {
      throw new GameRuleError("Your player session is no longer valid.", 401);
    }

    if (payload.type === "play") {
      applyPlay(game, ws.playerIndex, payload.placements);
    } else if (payload.type === "pass") {
      applyPass(game, ws.playerIndex);
    } else if (payload.type === "exchange") {
      applyExchange(game, ws.playerIndex, payload.tileIds);
    } else {
      throw new GameRuleError("Unknown action type.", 400);
    }

    await saveGame(game);
  });

  await broadcastGameState(code);
}

app.post("/api/host", async (req, res) => {
  try {
    const name = sanitizeName(req.body?.name);
    const { game, playerKey, playerIndex } = await createGameWithUniqueCode(name);
    const state = toPublicGameState(game, playerIndex, getPresence(game.code));

    res.json({
      code: game.code,
      playerKey,
      state
    });
  } catch (error) {
    respondWithError(res, error);
  }
});

app.post("/api/join", async (req, res) => {
  try {
    const name = sanitizeName(req.body?.name);
    const code = sanitizeCode(req.body?.code);
    const requestedKey = sanitizeOptionalKey(req.body?.playerKey);

    const result = await withGameLock(code, async () => {
      const game = await findGameByCode(code);
      if (!game) {
        throw new GameRuleError("Game code not found.", 404);
      }

      validateGameShape(game);
      const joinResult = joinExistingGame(game, {
        name,
        playerKey: requestedKey
      });

      await saveGame(game);
      return {
        game,
        joinResult
      };
    });

    const state = toPublicGameState(
      result.game,
      result.joinResult.playerIndex,
      getPresence(code)
    );

    res.json({
      code,
      playerKey: result.joinResult.playerKey,
      state
    });

    await broadcastGameState(code);
  } catch (error) {
    respondWithError(res, error);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request, socket, head) => {
  try {
    const requestUrl = new URL(request.url ?? "", `http://${request.headers.host}`);

    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const code = sanitizeCode(requestUrl.searchParams.get("code"));
    const key = sanitizeOptionalKey(requestUrl.searchParams.get("key"));
    const nameParam = requestUrl.searchParams.get("name");
    const name = nameParam ? sanitizeName(nameParam) : "";

    const game = await findGameByCode(code);
    if (!game) {
      throw new GameRuleError("Game code not found.", 404);
    }

    validateGameShape(game);

    const playerIndex = resolvePlayerIndex(game, {
      playerKey: key,
      name
    });

    if (playerIndex < 0) {
      throw new GameRuleError("Player identity could not be verified.", 401);
    }

    const player = game.players[playerIndex];
    if (!player?.key) {
      throw new GameRuleError("Player key is missing from game record.", 401);
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.gameCode = code;
      ws.playerIndex = playerIndex;
      ws.playerName = player.name;
      ws.playerKey = player.key;
      wss.emit("connection", ws, request);
    });
  } catch (error) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  const code = ws.gameCode;

  if (!roomSockets.has(code)) {
    roomSockets.set(code, new Set());
  }

  roomSockets.get(code).add(ws);
  incrementPresence(code, ws.playerIndex);

  ws.on("message", async (data) => {
    try {
      const payload = JSON.parse(String(data));
      if (payload?.type === "ping") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
        return;
      }

      await handleAction(ws, payload);
    } catch (error) {
      const message = error instanceof GameRuleError ? error.message : "Unexpected action error.";
      sendWsError(ws, message);
    }
  });

  ws.on("close", async () => {
    const sockets = roomSockets.get(code);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        roomSockets.delete(code);
      }
    }

    decrementPresence(code, ws.playerIndex);
    await broadcastGameState(code);
  });

  ws.on("error", () => {
    // handled by close event
  });

  broadcastGameState(code).catch((error) => {
    console.error("Initial state broadcast failed", error);
  });
});

async function start() {
  await mongoClient.connect();
  gamesCollection = mongoClient.db(MONGODB_DB).collection(GAME_COLLECTION);
  await gamesCollection.createIndex({ code: 1 }, { unique: true });

  server.listen(PORT, () => {
    console.log(`Scrabble server listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});



