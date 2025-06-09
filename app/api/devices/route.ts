import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';

/**
 * GET /api/devices
 * 
 * This endpoint retrieves a list of smart devices from the Google Smart Device Management API.
 * It is called when the frontend needs to fetch the list of available devices.
 * 
 * Authentication:
 * - Requires a valid session with an access token
 * - Uses NextAuth.js for session management
 * 
 * Key Parameters:
 * - session.accessToken: JWT token for Google API authentication
 * - process.env.GOOGLE_PROJECT_ID: Google Cloud project identifier
 * 
 * Returns:
 * - 200: JSON array of devices
 * - 401: Unauthorized (no valid session)
 * - 500: Server error or API request failure
 * 
 * Common Issues:
 * - API not enabled in Google Cloud Console
 * - OAuth scopes not properly configured
 * - Nest account not linked to project
 * - No devices in the Nest account
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    console.log('Devices API - Session:', {
      hasToken: !!session?.accessToken,
      tokenPreview: session?.accessToken?.substring(0, 10) + '...',
      hasUser: !!session?.user,
      userEmail: session?.user?.email,
      expires: session?.expires,
      scopes: session?.scope // Log available scopes
    });
    
    if (!session?.accessToken) {
      console.error('Devices API - No access token in session');
      return NextResponse.json({ 
        error: 'Unauthorized - No access token',
        details: 'Please sign in again to refresh your session'
      }, { status: 401 });
    }

    if (!process.env.GOOGLE_PROJECT_ID) {
      console.error('Devices API - No project ID configured');
      return NextResponse.json({ 
        error: 'Server configuration error',
        details: 'GOOGLE_PROJECT_ID environment variable is not set'
      }, { status: 500 });
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
        body: errorText,
        headers: Object.fromEntries(response.headers.entries())
      });

      // Handle specific error cases
      if (response.status === 403) {
        const errorBody = JSON.parse(errorText);
        const isConsentRequired = errorBody.error?.message?.includes('consent') || 
                                errorBody.error?.message?.includes('permission');
        
        return NextResponse.json({
          error: 'Permission denied',
          details: isConsentRequired 
            ? 'Device access permission has expired. Please sign out and sign in again to grant access to your devices.'
            : 'The Smart Device Management API may not be enabled or the project may not have access to Nest devices',
          status: 'error',
          devices: [],
          requiresReauth: isConsentRequired
        }, { status: 403 });
      }

      if (response.status === 401) {
        return NextResponse.json({
          error: 'Authentication required',
          details: 'Your session has expired. Please sign in again to continue accessing your devices.',
          status: 'error',
          devices: [],
          requiresReauth: true
        }, { status: 401 });
      }

      if (response.status === 404) {
        return NextResponse.json({
          error: 'Project not found',
          details: 'The Google Cloud Project ID may be incorrect or the API may not be properly initialized',
          status: 'error',
          devices: []
        }, { status: 404 });
      }

      return NextResponse.json(
        { 
          error: `API request failed: ${response.status} ${response.statusText}`,
          details: errorText,
          status: 'error',
          devices: []
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Devices API - Full Response:', {
      data,
      responseStatus: response.status,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      projectId: process.env.GOOGLE_PROJECT_ID,
      url
    });

    console.log('Devices API - Response structure:', {
      hasDevices: !!data.devices,
      devicesType: typeof data.devices,
      devicesLength: Array.isArray(data.devices) ? data.devices.length : 'not an array',
      responseKeys: Object.keys(data),
      firstLevelData: Object.entries(data).map(([key, value]) => ({
        key,
        type: typeof value,
        isArray: Array.isArray(value),
        length: Array.isArray(value) ? value.length : 'N/A'
      }))
    });

    // Handle cases where devices data is missing or malformed
    if (!data.devices) {
      console.error('Devices API - No devices property in response');
      return NextResponse.json({ 
        devices: [],
        error: 'No devices data available',
        details: 'The response does not contain a devices property. This may indicate that the API is not properly initialized or no devices are available.',
        status: 'empty'
      });
    }

    // Ensure we return an array of devices
    if (!Array.isArray(data.devices)) {
      console.error('Devices API - Response does not contain devices array');
      return NextResponse.json({ 
        devices: [],
        error: 'Invalid devices data format',
        details: 'The devices property is not an array as expected',
        status: 'error'
      });
    }

    return NextResponse.json({
      devices: data.devices,
      status: 'success'
    });
    
  } catch (error) {
    console.error('Devices API - Error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to fetch devices',
        details: 'An unexpected error occurred while fetching devices',
        status: 'error',
        devices: []
      },
      { status: 500 }
    );
  }
} 