import { BOARD_LAYOUT, BOARD_SIZE, MULTIPLIER } from "/shared/Board.js";
import { BLANK_SYMBOL, tileDisplayLetter } from "/shared/Letters.js";

const lobbyCard = document.getElementById("lobbyCard");
const gameView = document.getElementById("gameView");
const nameInput = document.getElementById("nameInput");
const joinCodeInput = document.getElementById("joinCodeInput");
const hostBtn = document.getElementById("hostBtn");
const joinBtn = document.getElementById("joinBtn");
const lobbyError = document.getElementById("lobbyError");

const boardCanvas = document.getElementById("boardCanvas");
const ctx = boardCanvas.getContext("2d");
const playersList = document.getElementById("playersList");
const historyLog = document.getElementById("historyLog");
const statusLabel = document.getElementById("statusLabel");
const modeHint = document.getElementById("modeHint");
const gameCodeLabel = document.getElementById("gameCodeLabel");
const copyCodeBtn = document.getElementById("copyCodeBtn");

const submitMoveBtn = document.getElementById("submitMoveBtn");
const shuffleRackBtn = document.getElementById("shuffleRackBtn");
const exchangeRackBtn = document.getElementById("exchangeRackBtn");

const SESSION_STORAGE_KEY = "scrabble.sessions.v1";
const LAST_NAME_STORAGE_KEY = "scrabble.last-name";
const DEFAULT_PAGE_TITLE = document.title;
const TURN_ALERT_TITLE = "Your turn - Scrabble Clone";
const BOARD_ORIGIN_X = 10;
const BOARD_ORIGIN_Y = 10;
const BOARD_TILE_SIZE = 40;
const BOARD_PIXEL_SIZE = BOARD_TILE_SIZE * BOARD_SIZE;

const RACK_ORIGIN_X = 13;
const RACK_ORIGIN_Y = 620;
const RACK_SLOT_SIZE = 78;
const RACK_SLOT_GAP = 8;

const MULTIPLIER_COLORS = {
  [MULTIPLIER.NORMAL]: "#ead9bb",
  [MULTIPLIER.DOUBLE_LETTER]: "#8fc4f2",
  [MULTIPLIER.TRIPLE_LETTER]: "#4f89cb",
  [MULTIPLIER.DOUBLE_WORD]: "#f3adb5",
  [MULTIPLIER.TRIPLE_WORD]: "#df6657"
};

let playerName = "";
let playerKey = "";
let gameCode = "";
let gameState = null;
let ws;
let reconnectTimer;
let exchangeMode = false;
let selectedTileId = null;
let pendingPlacements = [];
const exchangeSelection = new Set();
let hoveredBoardCell = null;
let hoveredRackIndex = -1;
let rackOrder = [];
let titleFlashTimer = null;
let titleFlashState = false;
let notificationAudioContext = null;
let copyButtonResetTimer = null;
function normalizeName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

function normalizeCode(code) {
  return String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function getSessionMap() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function setSessionMap(value) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
}

function sessionLookupKey(code, name) {
  return `${normalizeCode(code)}:${normalizeName(name).toLowerCase()}`;
}

function savePlayerSession(code, name, key) {
  const map = getSessionMap();
  map[sessionLookupKey(code, name)] = key;
  setSessionMap(map);
}

function findSavedPlayerKey(code, name) {
  const map = getSessionMap();
  return map[sessionLookupKey(code, name)] ?? "";
}

function showLobbyError(message) {
  lobbyError.textContent = message;
}

function setStatus(message) {
  statusLabel.textContent = message;
}

function setHint(message) {
  if (!modeHint) {
    return;
  }

  modeHint.textContent = message;
}

function setCopyButtonFeedback(label) {
  if (!copyCodeBtn) {
    return;
  }

  copyCodeBtn.textContent = label;

  if (copyButtonResetTimer) {
    clearTimeout(copyButtonResetTimer);
  }

  copyButtonResetTimer = setTimeout(() => {
    copyCodeBtn.textContent = "Copy";
    copyButtonResetTimer = null;
  }, 1400);
}

function fallbackCopyText(text) {
  if (typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";

  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }

  return copied;
}

async function copyGameUrlToClipboard(url) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(url);
    return true;
  }

  return fallbackCopyText(url);
}
function isMyActiveTurn(state) {
  return Boolean(state && state.status === "active" && state.turnIndex === state.myIndex);
}

function stopTurnTitleAlert() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }

  document.title = DEFAULT_PAGE_TITLE;
}

function startTurnTitleAlert() {
  if (!(document.hidden || !document.hasFocus())) {
    return;
  }

  if (titleFlashTimer) {
    return;
  }

  titleFlashState = false;
  titleFlashTimer = setInterval(() => {
    titleFlashState = !titleFlashState;
    document.title = titleFlashState ? TURN_ALERT_TITLE : DEFAULT_PAGE_TITLE;
  }, 900);
}

function ensureNotificationAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!notificationAudioContext) {
    notificationAudioContext = new AudioContextClass();
  }

  if (notificationAudioContext.state === "suspended") {
    notificationAudioContext.resume().catch(() => {});
  }

  return notificationAudioContext;
}

function playTurnBell() {
  const audioContext = ensureNotificationAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const now = audioContext.currentTime;
  const master = audioContext.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  master.connect(audioContext.destination);

  const toneA = audioContext.createOscillator();
  toneA.type = "sine";
  toneA.frequency.setValueAtTime(880, now);
  toneA.frequency.exponentialRampToValueAtTime(1100, now + 0.16);
  toneA.connect(master);
  toneA.start(now);
  toneA.stop(now + 0.17);

  const toneB = audioContext.createOscillator();
  toneB.type = "sine";
  toneB.frequency.setValueAtTime(1174, now + 0.18);
  toneB.frequency.exponentialRampToValueAtTime(1397, now + 0.37);
  toneB.connect(master);
  toneB.start(now + 0.18);
  toneB.stop(now + 0.4);
}

function maybeNotifyTurnStart(previousState, nextState) {
  if (!previousState || previousState.status !== "active") {
    return;
  }
  const wasMyTurn = isMyActiveTurn(previousState);
  const isMyTurnNow = isMyActiveTurn(nextState);

  if (wasMyTurn || !isMyTurnNow) {
    return;
  }

  playTurnBell();
  startTurnTitleAlert();
}

function setupTurnAlertListeners() {
  const clearTitleAlertIfFocused = () => {
    if (!document.hidden && document.hasFocus()) {
      stopTurnTitleAlert();
    }
  };

  document.addEventListener("visibilitychange", clearTitleAlertIfFocused);
  window.addEventListener("focus", clearTitleAlertIfFocused);

  const primeNotificationAudio = () => {
    ensureNotificationAudioContext();
  };

  window.addEventListener("pointerdown", primeNotificationAudio, { once: true });
  window.addEventListener("keydown", primeNotificationAudio, { once: true });
  window.addEventListener("touchstart", primeNotificationAudio, { once: true, passive: true });
}

function getMyRack() {
  return gameState?.myRack ?? [];
}
function syncRackOrder() {
  const rackIds = getMyRack().map((tile) => tile.id);

  if (rackIds.length === 0) {
    rackOrder = [];
    return;
  }

  if (rackOrder.length === 0) {
    rackOrder = [...rackIds];
    return;
  }

  const retained = rackOrder.filter((tileId) => rackIds.includes(tileId));
  const missing = rackIds.filter((tileId) => !retained.includes(tileId));
  rackOrder = [...retained, ...missing];
}

function getOrderedRack() {
  syncRackOrder();
  const byId = new Map(getMyRack().map((tile) => [tile.id, tile]));
  return rackOrder.map((tileId) => byId.get(tileId)).filter(Boolean);
}

function shuffleRackOrder() {
  syncRackOrder();

  for (let i = rackOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rackOrder[i], rackOrder[j]] = [rackOrder[j], rackOrder[i]];
  }
}

function canAct() {
  return Boolean(
    gameState && gameState.status === "active" && gameState.turnIndex === gameState.myIndex
  );
}

function getOpenSocket() {
  return ws && ws.readyState === WebSocket.OPEN ? ws : null;
}

function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Request failed");
    }
    return body;
  });
}

function getJson(url) {
  return fetch(url).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Request failed");
    }
    return body;
  });
}

function buildGameUrl(code) {
  const normalizedCode = normalizeCode(code);
  const shareUrl = new URL(window.location.href);
  shareUrl.search = "";
  shareUrl.hash = "";
  shareUrl.searchParams.set("game", normalizedCode);
  return shareUrl.toString();
}
async function hostGame() {
  const name = normalizeName(nameInput.value);
  if (!name) {
    showLobbyError("Please enter your name.");
    return;
  }

  showLobbyError("");
  hostBtn.disabled = true;
  joinBtn.disabled = true;

  try {
    const response = await postJson("/api/host", { name });
    enterGame(response, name);
  } catch (error) {
    showLobbyError(error.message || "Could not host game.");
  } finally {
    hostBtn.disabled = false;
    joinBtn.disabled = false;
  }
}

async function joinGame() {
  const name = normalizeName(nameInput.value);
  const code = normalizeCode(joinCodeInput.value);

  if (!name) {
    showLobbyError("Please enter your name.");
    return;
  }

  if (code.length !== 6) {
    showLobbyError("Enter a valid 6-character game code.");
    return;
  }

  showLobbyError("");
  hostBtn.disabled = true;
  joinBtn.disabled = true;

  try {
    const savedKey = findSavedPlayerKey(code, name);
    const response = await postJson("/api/join", {
      name,
      code,
      playerKey: savedKey
    });
    enterGame(response, name);
  } catch (error) {
    showLobbyError(error.message || "Could not join game.");
  } finally {
    hostBtn.disabled = false;
    joinBtn.disabled = false;
  }
}

async function applyGameCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedCode = params.get("game");
  if (requestedCode == null) {
    return;
  }

  const code = normalizeCode(requestedCode);
  joinCodeInput.value = code;

  if (code.length !== 6) {
    showLobbyError(`Invalid game id: ${requestedCode}`);
    return;
  }

  hostBtn.disabled = true;
  joinBtn.disabled = true;

  try {
    await getJson(`/api/game/${encodeURIComponent(code)}`);
  } catch {
    showLobbyError(`Invalid game id: ${code}`);
    return;
  } finally {
    hostBtn.disabled = false;
    joinBtn.disabled = false;
  }

  const hasName = Boolean(normalizeName(nameInput.value));
  if (hasName) {
    await joinGame();
  } else {
    showLobbyError(`Game ${code} found. Enter your name, then click Join.`);
  }
}
function enterGame(response, name) {
  playerName = name;
  playerKey = response.playerKey;
  gameCode = response.code;
  gameState = response.state;

  localStorage.setItem(LAST_NAME_STORAGE_KEY, playerName);
  savePlayerSession(gameCode, playerName, playerKey);

  exchangeMode = false;
  selectedTileId = null;
  pendingPlacements = [];
  exchangeSelection.clear();

  gameCodeLabel.textContent = gameCode;
  window.history.replaceState({}, "", buildGameUrl(gameCode));
  lobbyCard.classList.add("hidden");
  gameView.classList.remove("hidden");

  renderAll();
  connectSocket();
}

function connectSocket() {
  clearTimeout(reconnectTimer);

  if (!gameCode || !playerKey) {
    return;
  }

  if (ws && ws.readyState <= WebSocket.OPEN) {
    ws.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({
    code: gameCode,
    name: playerName,
    key: playerKey
  });

  ws = new WebSocket(`${protocol}://${window.location.host}/ws?${query.toString()}`);
  setStatus("Connecting...");

  ws.addEventListener("open", () => {
    updateStatusFromState();
    updateControlStates();
  });

  ws.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "state") {
      const previousState = gameState;
      gameState = payload.state;
      maybeNotifyTurnStart(previousState, gameState);
      reconcileLocalSelections();
      renderAll();
    } else if (payload.type === "error") {
      setHint(payload.error);
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected. Reconnecting...");
    updateControlStates();
    reconnectTimer = setTimeout(() => {
      connectSocket();
    }, 1500);
  });
}

function sendAction(payload) {
  const socket = getOpenSocket();
  if (!socket) {
    setHint("Connection lost. Reconnecting...");
    return;
  }

  socket.send(JSON.stringify(payload));
}

function reconcileLocalSelections() {
  const rackIds = new Set(getMyRack().map((tile) => tile.id));

  pendingPlacements = pendingPlacements.filter(
    (placement) => rackIds.has(placement.tileId) && !gameState.board[placement.y][placement.x]
  );

  if (selectedTileId && !rackIds.has(selectedTileId)) {
    selectedTileId = null;
  }

  for (const tileId of [...exchangeSelection]) {
    if (!rackIds.has(tileId)) {
      exchangeSelection.delete(tileId);
    }
  }

  if (!canAct() || gameState.status !== "active") {
    exchangeMode = false;
    selectedTileId = null;
    pendingPlacements = [];
    exchangeSelection.clear();
  }

  syncRackOrder();
}

function getCanvasPoint(event) {
  const rect = boardCanvas.getBoundingClientRect();
  const scaleX = boardCanvas.width / rect.width;
  const scaleY = boardCanvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function findBoardCell(pointX, pointY) {
  const localX = pointX - BOARD_ORIGIN_X;
  const localY = pointY - BOARD_ORIGIN_Y;

  if (localX < 0 || localY < 0 || localX >= BOARD_PIXEL_SIZE || localY >= BOARD_PIXEL_SIZE) {
    return null;
  }

  return {
    x: Math.floor(localX / BOARD_TILE_SIZE),
    y: Math.floor(localY / BOARD_TILE_SIZE)
  };
}

function findRackIndex(pointX, pointY) {
  const rackYStart = RACK_ORIGIN_Y;
  const rackYEnd = rackYStart + RACK_SLOT_SIZE;

  if (pointY < rackYStart || pointY > rackYEnd) {
    return -1;
  }

  for (let index = 0; index < 7; index += 1) {
    const x = RACK_ORIGIN_X + index * (RACK_SLOT_SIZE + RACK_SLOT_GAP);
    if (pointX >= x && pointX <= x + RACK_SLOT_SIZE) {
      return index;
    }
  }

  return -1;
}

function findPlacementIndexAt(x, y) {
  return pendingPlacements.findIndex((placement) => placement.x === x && placement.y === y);
}

function isTilePending(tileId) {
  return pendingPlacements.some((placement) => placement.tileId === tileId);
}

function drawHoverGlowRect(x, y, width, height, radius = 0) {
  ctx.save();
  ctx.shadowColor = "rgba(255, 235, 170, 0.85)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(255, 235, 170, 0.95)";
  ctx.lineWidth = 2;

  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, width, height);
  }

  ctx.restore();
}

function handleRackClick(rackIndex) {
  const rack = getOrderedRack();
  const tile = rack[rackIndex];
  if (!tile) {
    return;
  }

  if (!canAct()) {
    return;
  }

  if (exchangeMode) {
    if (exchangeSelection.has(tile.id)) {
      exchangeSelection.delete(tile.id);
    } else {
      exchangeSelection.add(tile.id);
    }
    return;
  }

  const pendingIndex = pendingPlacements.findIndex((placement) => placement.tileId === tile.id);
  if (pendingIndex >= 0) {
    pendingPlacements.splice(pendingIndex, 1);
    if (selectedTileId === tile.id) {
      selectedTileId = null;
    }
    return;
  }

  selectedTileId = selectedTileId === tile.id ? null : tile.id;
}

function handleBoardClick(cellX, cellY) {
  if (!canAct() || exchangeMode) {
    return;
  }

  if (gameState.board[cellY][cellX]) {
    return;
  }

  const existingPlacementIndex = findPlacementIndexAt(cellX, cellY);
  if (existingPlacementIndex >= 0) {
    pendingPlacements.splice(existingPlacementIndex, 1);
    return;
  }

  if (!selectedTileId) {
    return;
  }

  const tile = getMyRack().find((entry) => entry.id === selectedTileId);
  if (!tile || isTilePending(tile.id)) {
    return;
  }

  let assignedLetter = "";
  if (tile.letter === BLANK_SYMBOL) {
    const answer = window.prompt("Choose a letter for blank tile (A-Z):", "E") ?? "";
    const normalized = answer.trim().toUpperCase();
    if (!/^[A-Z]$/.test(normalized)) {
      setHint("Blank tiles require a single A-Z letter.");
      return;
    }
    assignedLetter = normalized;
  }

  pendingPlacements.push({
    x: cellX,
    y: cellY,
    tileId: tile.id,
    letter: assignedLetter
  });

  selectedTileId = null;
}

function drawTile(x, y, size, tile, options = {}) {
  const {
    selected = false,
    muted = false,
    accent = false,
    tint = "#f6dca9",
    letterFontSize = 22,
    pointsFontSize = 9
  } = options;

  ctx.save();
  if (muted) {
    ctx.globalAlpha = 0.45;
  }

  ctx.fillStyle = tint;
  ctx.strokeStyle = selected ? "#1f6f42" : accent ? "#8a5a0b" : "#8a7556";
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#2e261c";
  ctx.font = "bold " + letterFontSize + "px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const displayLetter = tile.letter === BLANK_SYMBOL ? "_" : tile.letter;
  ctx.fillText(displayLetter, x + size / 2, y + size / 2);

  ctx.font = "bold " + pointsFontSize + "px Trebuchet MS";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(String(tile.points ?? 0), x + size - 4, y + size - 3);
  ctx.restore();
}

function drawBoard() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cellX = BOARD_ORIGIN_X + x * BOARD_TILE_SIZE;
      const cellY = BOARD_ORIGIN_Y + y * BOARD_TILE_SIZE;
      const multiplier = BOARD_LAYOUT[y][x];

      ctx.fillStyle = MULTIPLIER_COLORS[multiplier] ?? MULTIPLIER_COLORS[MULTIPLIER.NORMAL];
      ctx.fillRect(cellX, cellY, BOARD_TILE_SIZE, BOARD_TILE_SIZE);
      ctx.strokeStyle = "#a48d6f";
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, cellY, BOARD_TILE_SIZE, BOARD_TILE_SIZE);

      if (x === 7 && y === 7) {
        ctx.fillStyle = "#724d16";
        ctx.font = "bold 18px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("*", cellX + BOARD_TILE_SIZE / 2, cellY + BOARD_TILE_SIZE / 2 + 1);
      } else if (multiplier !== MULTIPLIER.NORMAL) {
        ctx.fillStyle = "#2b2b2b";
        ctx.font = "bold 10px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(multiplier, cellX + BOARD_TILE_SIZE / 2, cellY + BOARD_TILE_SIZE / 2);
      }
    }
  }

  if (gameState) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cell = gameState.board[y][x];
        if (!cell) {
          continue;
        }

        drawTile(
          BOARD_ORIGIN_X + x * BOARD_TILE_SIZE + 2,
          BOARD_ORIGIN_Y + y * BOARD_TILE_SIZE + 2,
          BOARD_TILE_SIZE - 4,
          {
            letter: cell.letter,
            points: cell.points
          },
          {
            tint: "#efd19b"
          }
        );
      }
    }

    for (const placement of pendingPlacements) {
      const sourceTile = getMyRack().find((tile) => tile.id === placement.tileId);
      if (!sourceTile) {
        continue;
      }

      const cellX = BOARD_ORIGIN_X + placement.x * BOARD_TILE_SIZE + 2;
      const cellY = BOARD_ORIGIN_Y + placement.y * BOARD_TILE_SIZE + 2;
      const letter = sourceTile.letter === BLANK_SYMBOL ? placement.letter : sourceTile.letter;

      drawTile(
        cellX,
        cellY,
        BOARD_TILE_SIZE - 4,
        {
          letter,
          points: sourceTile.points
        },
        {
          selected: true,
          accent: true,
          tint: "#f8e7ba"
        }
      );
    }
  }

  if (hoveredBoardCell) {
    const hoverX = hoveredBoardCell.x;
    const hoverY = hoveredBoardCell.y;
    const hasPlacedTile = Boolean(gameState?.board[hoverY]?.[hoverX]);
    const hasPendingTile = findPlacementIndexAt(hoverX, hoverY) >= 0;

    if (hasPlacedTile || hasPendingTile) {
      drawHoverGlowRect(
        BOARD_ORIGIN_X + hoverX * BOARD_TILE_SIZE + 2,
        BOARD_ORIGIN_Y + hoverY * BOARD_TILE_SIZE + 2,
        BOARD_TILE_SIZE - 4,
        BOARD_TILE_SIZE - 4,
        3
      );
    } else {
      drawHoverGlowRect(
        BOARD_ORIGIN_X + hoverX * BOARD_TILE_SIZE + 1,
        BOARD_ORIGIN_Y + hoverY * BOARD_TILE_SIZE + 1,
        BOARD_TILE_SIZE - 2,
        BOARD_TILE_SIZE - 2,
        2
      );
    }
  }

  drawRack();
}

function drawRack() {
  if (!gameState) {
    return;
  }

  const rack = getOrderedRack();

  for (let index = 0; index < 7; index += 1) {
    const x = RACK_ORIGIN_X + index * (RACK_SLOT_SIZE + RACK_SLOT_GAP);
    const y = RACK_ORIGIN_Y;

    ctx.fillStyle = "#f9f4ea";
    ctx.strokeStyle = "#9e8b70";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, RACK_SLOT_SIZE, RACK_SLOT_SIZE, 8);
    ctx.fill();
    ctx.stroke();

    const tile = rack[index];
    if (tile) {
      drawTile(
        x + 4,
        y + 4,
        RACK_SLOT_SIZE - 8,
        {
          letter: tileDisplayLetter(tile),
          points: tile.points
        },
        {
          selected: selectedTileId === tile.id,
          muted: isTilePending(tile.id),
          accent: exchangeSelection.has(tile.id),
          tint: exchangeSelection.has(tile.id) ? "#f4d4d0" : "#f9e2b8",
          letterFontSize: 32,
          pointsFontSize: 14
        }
      );
    }

    if (hoveredRackIndex === index) {
      if (tile) {
        drawHoverGlowRect(x + 4, y + 4, RACK_SLOT_SIZE - 8, RACK_SLOT_SIZE - 8, 3);
      } else {
        drawHoverGlowRect(x + 1, y + 1, RACK_SLOT_SIZE - 2, RACK_SLOT_SIZE - 2, 8);
      }
    }
  }
}

function updateStatusFromState() {
  if (!gameState) {
    setStatus("Waiting...");
    return;
  }

  if (gameState.status === "waiting") {
    setStatus(`Waiting for opponent. Bag: ${gameState.bagCount}`);
    return;
  }

  if (gameState.status === "finished") {
    if (gameState.winnerIndex == null) {
      setStatus("Game finished: tie");
    } else {
      const winner = gameState.players[gameState.winnerIndex];
      setStatus(`Game finished: ${winner?.name ?? "Unknown"} won`);
    }
    return;
  }

  if (gameState.turnIndex === gameState.myIndex) {
    setStatus(`Your turn. Bag: ${gameState.bagCount}`);
  } else {
    const other = gameState.players[gameState.turnIndex];
    setStatus(`${other?.name ?? "Opponent"}'s turn. Bag: ${gameState.bagCount}`);
  }
}

function renderPlayers() {
  playersList.innerHTML = "";

  if (!gameState) {
    return;
  }

  for (let index = 0; index < gameState.players.length; index += 1) {
    const player = gameState.players[index];
    const card = document.createElement("div");
    card.className = "player-card";

    if (index === gameState.myIndex) {
      card.classList.add("me");
    }

    if (gameState.turnIndex === index && gameState.status === "active") {
      card.classList.add("turn");
    }

    const nameLine = document.createElement("div");
    nameLine.className = "player-name";
    nameLine.textContent = player?.name ?? "Open Seat";

    const scoreLine = document.createElement("div");
    scoreLine.className = "player-score";
    scoreLine.textContent = player ? String(player.score) : "-";

    const tilesLine = document.createElement("div");
    tilesLine.className = "player-tiles";
    tilesLine.textContent = player ? `${player.tileCount} tiles` : "No player";

    const presenceLine = document.createElement("div");
    const isConnected = Boolean(player?.connected);
    presenceLine.className = `player-presence ${isConnected ? "online" : "offline"}`;
    presenceLine.textContent = isConnected ? "Online" : "Offline";

    card.append(nameLine, scoreLine, tilesLine, presenceLine);
    playersList.append(card);
  }
}

function renderHistory() {
  historyLog.innerHTML = "";

  if (!gameState) {
    return;
  }

  for (const item of gameState.history) {
    const line = document.createElement("div");
    line.textContent = item.text;
    historyLog.append(line);
  }

  historyLog.scrollTop = historyLog.scrollHeight;
}

function updateControlStates() {
  const myTurn = canAct();
  const waitingOnOpponent = Boolean(
    gameState && gameState.status === "active" && gameState.turnIndex !== gameState.myIndex
  );
  const waitingForOpponent = Boolean(gameState && gameState.status === "waiting");
  const socketConnected = Boolean(getOpenSocket());
  const disconnected = Boolean(gameState) && !socketConnected;
  const hasPendingPlacements = pendingPlacements.length > 0;
  const waitingForPlacement = myTurn && !exchangeMode && !hasPendingPlacements;
  const canConfirmExchange = myTurn && exchangeMode && exchangeSelection.size > 0;

  if (waitingForOpponent || disconnected) {
    submitMoveBtn.textContent = "Waiting for opponent...";
  } else if (waitingOnOpponent) {
    submitMoveBtn.textContent = "Waiting for Opponent";
  } else if (canConfirmExchange) {
    submitMoveBtn.textContent = "Confirm Exchange";
  } else if (exchangeMode) {
    submitMoveBtn.textContent = "Select letters for exchange";
  } else if (waitingForPlacement) {
    submitMoveBtn.textContent = "Your turn, place tiles";
  } else {
    submitMoveBtn.textContent = "Submit Word";
  }

  submitMoveBtn.disabled = !myTurn || disconnected;

  if (shuffleRackBtn) {
    shuffleRackBtn.disabled = exchangeMode || getMyRack().length < 2;
  }

  if (exchangeRackBtn) {
    exchangeRackBtn.disabled = !myTurn || disconnected || getMyRack().length === 0;
    exchangeRackBtn.classList.toggle("active", exchangeMode);
  }

  if (!gameState) {
    setHint("Connect to a game to start.");
    return;
  }

  if (gameState.status === "waiting") {
    setHint("Share your game code so the second player can join.");
    return;
  }

  if (gameState.status === "finished") {
    setHint("Game complete. You can rejoin this code any time to view the final board.");
    return;
  }

  if (exchangeMode) {
    setHint("Exchange mode: select rack tiles and click Confirm Exchange.");
  } else if (myTurn) {
    setHint("Your turn: place tiles on the board and submit your move.");
  } else {
    setHint("Waiting for the other player's move.");
  }
}

function renderAll() {
  drawBoard();
  renderPlayers();
  renderHistory();
  updateStatusFromState();
  updateControlStates();
}

boardCanvas.addEventListener("click", (event) => {
  if (!gameState) {
    return;
  }

  const point = getCanvasPoint(event);
  const rackIndex = findRackIndex(point.x, point.y);
  if (rackIndex >= 0) {
    handleRackClick(rackIndex);
    renderAll();
    return;
  }

  const boardCell = findBoardCell(point.x, point.y);
  if (boardCell) {
    handleBoardClick(boardCell.x, boardCell.y);
    renderAll();
  }
});

boardCanvas.addEventListener("mousemove", (event) => {
  const point = getCanvasPoint(event);
  const nextRackIndex = findRackIndex(point.x, point.y);
  const nextBoardCell = nextRackIndex >= 0 ? null : findBoardCell(point.x, point.y);

  const rackChanged = nextRackIndex !== hoveredRackIndex;
  const boardChanged =
    (nextBoardCell?.x ?? -1) !== (hoveredBoardCell?.x ?? -1) ||
    (nextBoardCell?.y ?? -1) !== (hoveredBoardCell?.y ?? -1);

  if (!rackChanged && !boardChanged) {
    return;
  }

  hoveredRackIndex = nextRackIndex;
  hoveredBoardCell = nextBoardCell;
  renderAll();
});

boardCanvas.addEventListener("mouseleave", () => {
  if (hoveredRackIndex === -1 && !hoveredBoardCell) {
    return;
  }

  hoveredRackIndex = -1;
  hoveredBoardCell = null;
  renderAll();
});

hostBtn.addEventListener("click", () => {
  hostGame();
});

joinBtn.addEventListener("click", () => {
  joinGame();
});

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = normalizeCode(joinCodeInput.value);
});

copyCodeBtn.addEventListener("click", async () => {
  if (!gameCode) {
    setCopyButtonFeedback("No code");
    return;
  }

  const gameUrl = buildGameUrl(gameCode);

  try {
    const copied = await copyGameUrlToClipboard(gameUrl);
    setCopyButtonFeedback(copied ? "Copied" : "Copy failed");
  } catch {
    setCopyButtonFeedback("Copy failed");
  }
});

if (shuffleRackBtn) {
  shuffleRackBtn.addEventListener("click", () => {
    if (!gameState || exchangeMode || getMyRack().length < 2) {
      return;
    }

    shuffleRackOrder();
    renderAll();
  });
}

if (exchangeRackBtn) {
  exchangeRackBtn.addEventListener("click", () => {
    if (!canAct()) {
      return;
    }

    exchangeMode = !exchangeMode;
    selectedTileId = null;
    pendingPlacements = [];

    if (!exchangeMode) {
      exchangeSelection.clear();
    }

    renderAll();
  });
}

submitMoveBtn.addEventListener("click", () => {
  if (!canAct()) {
    return;
  }

  if (exchangeMode) {
    if (exchangeSelection.size === 0) {
      return;
    }

    sendAction({
      type: "exchange",
      tileIds: [...exchangeSelection]
    });

    exchangeMode = false;
    exchangeSelection.clear();
    selectedTileId = null;
    pendingPlacements = [];
    renderAll();
    return;
  }

  if (pendingPlacements.length === 0) {
    return;
  }

  sendAction({
    type: "play",
    placements: pendingPlacements
  });

  pendingPlacements = [];
  selectedTileId = null;
  renderAll();
});

setupTurnAlertListeners();

nameInput.value = localStorage.getItem(LAST_NAME_STORAGE_KEY) ?? "";
renderAll();
applyGameCodeFromUrl().catch(() => {
  showLobbyError("Could not process game link.");
});















