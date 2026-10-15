/**
 * Tracks which users currently hold at least one live socket.
 *
 * A user may have several sockets open (two tabs, a phone and a laptop), so
 * online/offline transitions are reference-counted rather than boolean.
 */
class PresenceRegistry {
  private readonly sockets = new Map<string, Set<string>>();

  /** Returns true when this is the user's first socket (they just came online). */
  add(userId: string, socketId: string): boolean {
    const existing = this.sockets.get(userId);
    if (existing) {
      existing.add(socketId);
      return false;
    }
    this.sockets.set(userId, new Set([socketId]));
    return true;
  }

  /** Returns true when this was the user's last socket (they just went offline). */
  remove(userId: string, socketId: string): boolean {
    const existing = this.sockets.get(userId);
    if (!existing) return false;
    existing.delete(socketId);
    if (existing.size > 0) return false;
    this.sockets.delete(userId);
    return true;
  }

  isOnline(userId: string): boolean {
    return this.sockets.has(userId);
  }

  onlineAmong(userIds: readonly string[]): Set<string> {
    return new Set(userIds.filter((id) => this.sockets.has(id)));
  }

  reset(): void {
    this.sockets.clear();
  }
}

export const presence = new PresenceRegistry();
