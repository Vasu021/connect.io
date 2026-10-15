import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';
import { useAuth } from './auth';

type SocketState = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketState>({ socket: null, connected: false });

/**
 * One socket for the whole app. The dashboard needs it for invites and presence,
 * the game room needs it for rounds — opening a second connection would make
 * the server see the same player twice.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setSocket(null);
      setConnected(false);
      return;
    }

    // Credentials are sent automatically: auth rides on the session cookie.
    const instance = io(API_BASE || undefined, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
    });

    instance.on('connect', () => setConnected(true));
    instance.on('disconnect', () => setConnected(false));

    setSocket(instance);

    return () => {
      instance.removeAllListeners();
      instance.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [userId]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): SocketState {
  return useContext(SocketContext);
}

/**
 * Subscribes to a socket event for the lifetime of the component. The handler
 * is kept in a ref so callers do not have to memoise it to avoid resubscribing.
 */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;

    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);

    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
