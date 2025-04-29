import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    console.log('Devices API - Session:', {
      hasToken: !!session?.accessToken,
      tokenPreview: session?.accessToken?.substring(0, 10) + '...',
      hasUser: !!session?.user,
      userEmail: session?.user?.email,
      expires: session?.expires
    });
    
    if (!session?.accessToken) {
      console.error('Devices API - No access token in session');
      return NextResponse.json({ error: 'Unauthorized - No access token' }, { status: 401 });
    }

    if (!process.env.GOOGLE_PROJECT_ID) {
      console.error('Devices API - No project ID configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`;
    console.log('Devices API - Making request to:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Devices API - Error response:', {
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
    console.log('Devices API - Response structure:', {
      hasDevices: !!data.devices,
      devicesType: typeof data.devices,
      devicesLength: Array.isArray(data.devices) ? data.devices.length : 'not an array',
      responseKeys: Object.keys(data)
    });

    // Ensure we return an array of devices
    if (!Array.isArray(data.devices)) {
      console.error('Devices API - Response does not contain devices array');
      return NextResponse.json({ devices: [] });
    }

    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Devices API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch devices' },
      { status: 500 }
    );
  }
} 