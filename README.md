# Scrabs

Multiplayer  game built with:
- HTML/CSS/JavaScript canvas UI
- Node.js + Express + WebSocket backend
- MongoDB persistence

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
