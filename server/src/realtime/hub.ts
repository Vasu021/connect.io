import type { Server } from 'socket.io';

/**
 * Holds the Socket.IO server so modules can push events without importing the
 * HTTP bootstrap (which would create an import cycle).
 */
let server: Server | null = null;

export function setIo(instance: Server): void {
  server = instance;
}

export function getIo(): Server {
  if (!server) throw new Error('Socket.IO server not initialised');
  return server;
}

export function hasIo(): boolean {
  return server !== null;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const gameRoom = (gameId: string) => `game:${gameId}`;

export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!server) return;
  server.to(userRoom(userId)).emit(event, payload);
}

export function emitToGame(gameId: string, event: string, payload: unknown): void {
  if (!server) return;
  server.to(gameRoom(gameId)).emit(event, payload);
}
