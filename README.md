# Mockopoly 3D

A 3D (react-three-fiber) client for the server-authoritative Mockopoly engine.
The bright low-poly "living toy city". See `docs/` for the design spec and the
architecture reference. Product/visual direction: `PRODUCT.md`, `DESIGN.md`.

## Run

Requires the Mockopoly server running (default `http://localhost:3001`).

    npm install
    cp .env.example .env      # optionally point VITE_SERVER_URL elsewhere
    npm run dev               # http://localhost:5174

## Test

    npm test

## Wire contract

`src/types/GameState.ts` and `src/types/SocketEvents.ts` are vendored copies of
the server's types. **The server is the source of truth.** After the server's
contract changes, re-sync (requires `mockopoly-server` checked out as a sibling
directory):

    npm run sync-contract

## Architecture

Server owns all game state. This client is a read-only mirror: `SocketManager`
receives events, `GameStateSync` writes durable state into the `gameStore`
(zustand) and relays transient animation events onto `gameBus` (eventemitter3).
React + R3F render the store; no game logic lives here.

## Git

Org `mockopoly-js`. Personal SSH remote (`git@personal:`). No direct pushes to
`main`/`staging`/`dev` — integrate via PRs only.
