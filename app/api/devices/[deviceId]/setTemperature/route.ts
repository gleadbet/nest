import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { UnifiedDeviceService } from '../../../../../src/services/unifiedDeviceService';

// Initialize the unified device service
const deviceService = new UnifiedDeviceService();

export async function POST(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    const body = await request.json();
    const { type, temperature } = body;

    if (!type || temperature === undefined) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Check if this is a Honeywell device
    if (params.deviceId.startsWith('honeywell_')) {
      try {
        const mode = type === 'heat' ? 'HEAT' : 'COOL';
        const result = await deviceService.honeywellService.setTemperature(params.deviceId, temperature, mode);
        return NextResponse.json(result);
      } catch (error) {
        console.error('Set Temperature API - Honeywell Error:', error);
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to set Honeywell temperature' },
          { status: 500 }
        );
      }
    }

    // Handle Google Nest devices
    const session = await getServerSession(authOptions);
    
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.GOOGLE_PROJECT_ID) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const command = type === 'heat' 
      ? 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat'
      : 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';

    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${params.deviceId}:executeCommand`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command,
        params: {
          [type === 'heat' ? 'heatCelsius' : 'coolCelsius']: temperature
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Set Temperature API - Error:', {
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
    console.error('Set Temperature API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set temperature' },
      { status: 500 }
    );
  }
} 