import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';

export async function GET(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.GOOGLE_PROJECT_ID) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get the last 24 hours of temperature data
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${params.deviceId}/states`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Temperature History API - Error:', {
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
    
    // Transform the data into the format expected by the graph
    const temperatureHistory = data.states
      .filter((state: any) => state.traits['sdm.devices.traits.Temperature'])
      .map((state: any) => ({
        timestamp: state.reportTime,
        temperature: state.traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius,
        humidity: state.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 0
      }))
      .filter((reading: any) => new Date(reading.timestamp) > oneDayAgo);

    return NextResponse.json(temperatureHistory);
    
  } catch (error) {
    console.error('Temperature History API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch temperature history' },
      { status: 500 }
    );
  }
} 