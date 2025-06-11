import { Server as SocketIOServer } from 'socket.io';
import { NextResponse } from 'next/server';

let io: SocketIOServer;

export async function GET(request: Request) {
  if (!io) {
    console.log('Initializing Socket.IO server...');
    
    // Initialize Socket.IO with proper configuration
    io = new SocketIOServer({
      path: '/socket.io',
      addTrailingSlash: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true
      },
      allowEIO3: true,
      transports: ['websocket', 'polling']
    });

    io.on('connection', socket => {
      console.log('Client connected:', socket.id);

      // Handle device-specific subscriptions
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
        // Handle device data request
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

export async function POST() {
  return NextResponse.json({ success: true });
} 