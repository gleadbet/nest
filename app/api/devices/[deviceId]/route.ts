import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { UnifiedDeviceService } from '../../../../src/services/unifiedDeviceService';

// Initialize the unified device service
const deviceService = new UnifiedDeviceService();

export async function GET(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    // Check if this is a Honeywell device
    if (params.deviceId.startsWith('honeywell_')) {
      try {
        const status = await deviceService.honeywellService.getDeviceStatus(params.deviceId);
        
        // Transform Honeywell device status to match Google Nest format with traits
        const traits = {
          'sdm.devices.traits.Temperature': {
            ambientTemperatureCelsius: typeof status.currentTemp === 'number' ? status.currentTemp : undefined
          },
          'sdm.devices.traits.Humidity': {
            ambientHumidityPercent: typeof status.humidity === 'number' ? status.humidity : undefined
          },
          'sdm.devices.traits.ThermostatTemperatureSetpoint': {
            heatCelsius: status.mode === 'HEAT' || status.mode === 'AUTO' ? 
              (typeof status.targetTemp === 'number' ? status.targetTemp : undefined) : undefined,
            coolCelsius: status.mode === 'COOL' || status.mode === 'AUTO' ? 
              (typeof status.targetTemp === 'number' ? status.targetTemp : undefined) : undefined
          },
          'sdm.devices.traits.ThermostatMode': {
            mode: status.mode || 'OFF'
          },
          'sdm.devices.traits.Info': {
            customName: status.name
          }
        };

        return NextResponse.json({
          name: `devices/${params.deviceId}`,
          type: 'sdm.devices.types.THERMOSTAT',
          traits: traits
        });
      } catch (error) {
        console.error('Device API - Honeywell Error:', error);
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to fetch Honeywell device' },
          { status: 500 }
        );
      }
    }

    // Handle Google Nest devices
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.GOOGLE_PROJECT_ID) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${params.deviceId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Device API - Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      return NextResponse.json(
        { error: `API request failed: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Device API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch device' },
      { status: 500 }
    );
  }
} 