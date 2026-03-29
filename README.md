# Scrabs

Multiplayer game built with:
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

```text
scrabs/
│
├── public/                              # browser-facing frontend files
│   ├── index.html                       # main app shell (lobby + game view containers)
│   ├── app.js                           # client game logic, canvas rendering, networking
│   └── style.css                        # frontend styles for layout and game UI
│
├── server/                              # backend service code (Node + Express + WS)
│   ├── index.js                         # HTTP API, static hosting, WebSocket server, Mongo wiring
│   ├── gameEngine.js                    # core Scrabs rules, turn flow, validation, scoring
│   └── wordDictionary.js                # dictionary loading and word validation helpers
│
├── shared/                              # code shared between frontend and backend
│   ├── Board.js                         # board size/layout/multiplier definitions
│   └── Letters.js                       # tile distribution, values, and letter helpers
│
├── Dockerfile                           # container image build for the app service
├── docker-compose.yml                   # local multi-container setup (app + MongoDB)
├── package.json                         # project metadata, scripts, and npm dependencies
├── package-lock.json                    # exact dependency lockfile for reproducible installs
│
├── test.html                            # standalone visual/test page for board/UI experimentation
├── .dockerignore                        # files excluded from Docker build context
├── .gitignore                           # files/folders excluded from Git tracking
└── README.md                            # project overview, run instructions, and architecture notes
```