# connect.io — TypeScript MVP

A working TypeScript MVP of **connect.io** with:

- React + Vite + TypeScript frontend
- Node.js + Express + Socket.IO + TypeScript backend
- Local JSON persistence for users, friends, requests, and completed games

## Features

- Register
- Login
- Search users by username
- Send friend requests
- Accept friend requests
- Friends list
- Create a 2-player game with a friend
- Realtime 15-second rounds
- Reveal on both submit or timeout
- End game on exact normalized match
- Save completed games
- Leaderboard

## Run locally

### Install

```bash
npm install
npm install --workspace server
npm install --workspace client
```

### Start

```bash
npm run dev
```

### Open

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

## Build

```bash
npm run build
```

## Notes

- Persistence is in `server/data/db.json`
- Active games are kept in server memory
- This is ideal for local MVP development
- For production, next step is PostgreSQL + Prisma + Redis
