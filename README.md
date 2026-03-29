# Scrabs

Multiplayer  game built with:
- HTML/CSS/JavaScript canvas UI
- Node.js + Express + WebSocket backend
- MongoDB persistence

## Features in this initial version

- Name prompt on load (no account required)
- Host flow creates a game code
- Join flow uses the code to join/rejoin
- Two-player realtime updates over WebSockets
- Game state persisted in MongoDB
- Standard tile values and distribution in `shared/Letters.js`
- Standard 15x15 board multipliers in `shared/Board.js`
- 7-tile racks, tile bag, scoring multipliers, bingo bonus (+50)
- Move validation: turn order, contiguous placements, first move center, connection checks
- Pass and tile exchange actions
- Game end conditions:
  - Player goes out with empty bag
  - Six consecutive scoreless turns

## Docker run

Use Docker Compose to run app + MongoDB together:

```bash
docker compose up --build
```

Then open:
- http://localhost:3000

## Project structure

- `server/index.js` - API + WebSocket server + Mongo integration
- `server/gameEngine.js` - Scrabs rules and scoring logic
- `server/wordDictionary.js` - dictionary loading
- `shared/Letters.js` - tile values/distribution and bag helpers
- `shared/Board.js` - board multipliers and board helpers
- `public/index.html` - app shell
- `public/style.css` - styles
- `public/app.js` - canvas UI and client networking
