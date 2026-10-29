// Live updates over Socket.IO. Every connection signs in with the same token as the REST API.
// Rooms: "user:<userId>" (each person's phones) and "ride:<rideId>" (everyone following a ride).
import { Server } from "socket.io";
import { config } from "../config.js";
import { log } from "../lib/log.js";
import { userFromToken } from "../middleware/auth.js";

let io = null;
const handlers = []; // (socket, user) => void, registered by other services

export function onConnection(fn) {
  handlers.push(fn);
}

export function initRealtime(httpServer) {
  const any = config.corsOrigins.includes("*");
  io = new Server(httpServer, {
    cors: { origin: any ? "*" : config.corsOrigins },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token);
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err);
    }
  });
  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user._id}`);
    for (const fn of handlers) {
      try { fn(socket, user); } catch (err) { log.error("socket handler failed", { err: err.message }); }
    }
  });
  return io;
}

/** Sends to one or more rooms; a phone in several of them gets the event once. */
export function emitTo(rooms, event, payload) {
  io?.to(rooms).emit(event, payload);
}
export const userRoom = (userId) => `user:${userId}`;
export const rideRoom = (rideId) => `ride:${rideId}`;

/** How many live connections a person has right now. */
export async function connectionCount(userId) {
  if (!io) return 0;
  return (await io.in(userRoom(userId)).fetchSockets()).length;
}
