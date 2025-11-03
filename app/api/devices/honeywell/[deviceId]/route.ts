import { NextResponse } from 'next/server';
import { UnifiedDeviceService } from '../../../../../src/services/unifiedDeviceService';

// Initialize the unified device service
const deviceService = new UnifiedDeviceService();

export async function GET(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    console.log(`Honeywell device API - GET request for device: ${params.deviceId}`);
    
    // Get device status
    const status = await deviceService.honeywellService.getDeviceStatus(params.deviceId);
    
    console.log('Device status:', status);
    
    return NextResponse.json(status);
  } catch (error) {
    console.error(`Honeywell device API - Error for device ${params.deviceId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch device status' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    const body = await request.json();
    const { action, temperature, mode } = body;
    
    console.log(`Honeywell device API - POST request for device ${params.deviceId}:`, { action, temperature, mode });
    
    switch (action) {
      case 'setTemperature':
        if (temperature === undefined || temperature === null) {
          return NextResponse.json(
            { error: 'Temperature is required' },
            { status: 400 }
          );
        }
        
        const tempValue = parseFloat(temperature);
        if (isNaN(tempValue)) {
          return NextResponse.json(
            { error: 'Invalid temperature value' },
            { status: 400 }
          );
        }
        
        // Validate temperature range (Honeywell thermostats typically support 40-90°F)
        const tempFahrenheit = (tempValue * 9/5) + 32;
        if (tempFahrenheit < 40 || tempFahrenheit > 90) {
          return NextResponse.json(
            { error: 'Temperature out of range', details: 'Temperature must be between 4.4°C and 32.2°C (40°F and 90°F)' },
            { status: 400 }
          );
        }
        
        const tempResult = await deviceService.honeywellService.setTemperature(params.deviceId, tempValue, mode || 'HEAT');
        console.log('Temperature set result:', tempResult);
        return NextResponse.json(tempResult);
        
      case 'setMode':
        if (!mode) {
          return NextResponse.json(
            { error: 'Mode is required' },
            { status: 400 }
          );
        }
        
        const validModes = ['HEAT', 'COOL', 'AUTO', 'OFF'];
        if (!validModes.includes(mode.toUpperCase())) {
          return NextResponse.json(
            { error: 'Invalid mode', details: `Mode must be one of: ${validModes.join(', ')}` },
            { status: 400 }
          );
        }
        
        const modeResult = await deviceService.honeywellService.setMode(params.deviceId, mode);
        console.log('Mode set result:', modeResult);
        return NextResponse.json(modeResult);
        
      default:
        return NextResponse.json(
          { error: 'Invalid action. Supported actions: setTemperature, setMode' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error(`Honeywell device API - Error for device ${params.deviceId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    console.log(`Honeywell device API - DELETE request for device: ${params.deviceId}`);
    
    // Remove device from service
    const removed = deviceService.honeywellService.removeDevice(params.deviceId);
    
    if (removed) {
      console.log(`Device ${params.deviceId} removed successfully`);
      return NextResponse.json({ success: true, message: 'Device removed successfully' });
    } else {
      console.log(`Device ${params.deviceId} not found`);
      return NextResponse.json(
        { error: 'Device not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error(`Honeywell device API - Error for device ${params.deviceId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove device' },
      { status: 500 }
    );
  }
} 