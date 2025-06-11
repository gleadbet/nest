import { Server as NetServer } from 'http';
import { NextApiRequest } from 'next';
import { Server as ServerIO } from 'socket.io';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let io: ServerIO;

export async function GET(req: Request) {
  if (!io) {
    console.log('Initializing Socket.IO server...');
    
    // Create HTTP server
    const httpServer = new NetServer();
    
    // Initialize Socket.IO
    io = new ServerIO(httpServer, {
      path: '/api/socketio',
      addTrailingSlash: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    // Set up socket event handlers
    io.on('connection', socket => {
      console.log('Client connected:', socket.id);

      socket.on('subscribe', (deviceId: string) => {
        socket.join(`device-${deviceId}`);
        console.log(`Client ${socket.id} subscribed to device: ${deviceId}`);
      });

      socket.on('unsubscribe', (deviceId: string) => {
        socket.leave(`device-${deviceId}`);
        console.log(`Client ${socket.id} unsubscribed from device: ${deviceId}`);
      });

      socket.on('get-device-data', (deviceId: string) => {
        console.log(`Client ${socket.id} requested data for device: ${deviceId}`);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    // Store the io instance globally
    (global as any).io = io;
  }

  return NextResponse.json({ success: true });
}

export async function POST(req: Request) {
  return NextResponse.json({ success: true });
} 