import { NextResponse } from 'next/server';
import { UnifiedDeviceService } from '../../../../src/services/unifiedDeviceService';

// Initialize the unified device service
const deviceService = new UnifiedDeviceService();

export async function GET() {
  try {
    console.log('Honeywell devices API - GET request');
    
    // Get all Honeywell devices
    const devices = await deviceService.honeywellService.getAllDevices();
    
    console.log(`Honeywell devices API - Found ${devices.length} devices`);
    
    return NextResponse.json(devices);
  } catch (error) {
    console.error('Honeywell devices API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Honeywell devices' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, ip, name } = body;
    
    console.log('Honeywell devices API - POST request:', { action, ip, name });
    
    switch (action) {
      case 'discover':
        // Run device discovery
        const discoveryResult = await deviceService.runDiscovery();
        console.log('Discovery result:', discoveryResult);
        return NextResponse.json(discoveryResult);
        
      case 'add':
        // Add a device manually
        if (!ip) {
          return NextResponse.json(
            { error: 'IP address is required for adding a device' },
            { status: 400 }
          );
        }
        const device = deviceService.addHoneywellDevice(ip, name);
        console.log('Added device:', device);
        return NextResponse.json(device);
        
      case 'initialize':
        // Initialize the service
        const initResult = await deviceService.initialize();
        console.log('Initialization result:', initResult);
        return NextResponse.json(initResult);
        
      default:
        return NextResponse.json(
          { error: 'Invalid action. Supported actions: discover, add, initialize' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Honeywell devices API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
} 