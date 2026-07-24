import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server | null = null;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all for now (desktop apps)
      methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);
    socket.join('ALL');
    
    // Clients (desktop local servers) can join their branch room
    socket.on('join_branch', (branchId: string) => {
      socket.join(branchId);
      console.log(`[Socket.io] Client ${socket.id} joined branch room: ${branchId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.io is not initialized');
  }
  return io;
};

export const notifyBranchUpdate = (branchId: string, action: string, data?: any) => {
  if (io) {
    console.log(`[Socket.io] Emitting cloud_update to branch ${branchId}: ${action}`);
    io.to(branchId).emit('cloud_update', { action, data });
  }
};
