import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { UnifiedDeviceService } from '../../../src/services/unifiedDeviceService';

// Initialize the unified device service
const deviceService = new UnifiedDeviceService();

/**
 * GET /api/devices
 * 
 * This endpoint retrieves a list of smart devices from both Google Smart Device Management API
 * and local Honeywell Resideo thermostats. It provides a unified interface for all thermostat devices.
 * 
 * Authentication:
 * - Requires a valid session with an access token for Google devices
 * - Honeywell devices are discovered locally and don't require authentication
 * 
 * Key Parameters:
 * - session.accessToken: JWT token for Google API authentication
 * - process.env.GOOGLE_PROJECT_ID: Google Cloud project identifier
 * 
 * Returns:
 * - 200: JSON array of devices (both Google Nest and Honeywell)
 * - 401: Unauthorized (no valid session for Google devices)
 * - 500: Server error or API request failure
 * 
 * Common Issues:
 * - API not enabled in Google Cloud Console
 * - OAuth scopes not properly configured
 * - Nest account not linked to project
 * - No devices in the Nest account
 * - Honeywell devices not discoverable on local network
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
      scopes: session?.scope
    });
    
    // Initialize device service if not already done
    if (deviceService.honeywellService.discoveredDevices.size === 0) {
      console.log('Devices API - Initializing device service...');
      await deviceService.initialize();
    }
    
    const allDevices = [];
    let googleDevices = [];
    let honeywellDevices = [];
    
    // Get Google Nest devices if we have an access token
    if (session?.accessToken) {
      try {
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
            
            console.log('🚫 403 FORBIDDEN - Google SDM API Error:');
            console.log('  Error Message:', errorBody.error?.message);
            console.log('  Error Details:', errorBody.error?.details);
            console.log('  Error Status:', errorBody.error?.status);
            console.log('  Full Error:', JSON.stringify(errorBody, null, 2));
            console.log('\n💡 Possible causes:');
            console.log('  1. OAuth token expired - User needs to sign out and sign in again');
            console.log('  2. Device not registered in Google Device Access Console');
            console.log('  3. T6 Pro not linked to SDM project (it may only be in Google Home)');
            console.log('  4. Smart Device Management API not enabled in Google Cloud Console');
            console.log('  5. OAuth consent screen needs verification');
            console.log('\n🔗 Check: https://console.nest.google.com/device-access/project-list');
            console.log('Google devices unavailable due to permission issues');
          } else if (response.status === 401) {
            console.log('Google devices unavailable due to authentication issues');
          } else {
            console.log(`Google devices unavailable due to API error: ${response.status}`);
          }
        } else {
          const data = await response.json();
          console.log('Devices API - Google Response:', {
            hasDevices: !!data.devices,
            devicesLength: Array.isArray(data.devices) ? data.devices.length : 'not an array'
          });

          if (data.devices && Array.isArray(data.devices)) {
            googleDevices = data.devices
              .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
              .map(device => {
                const deviceId = device.name.split('/').pop();
                const traits = device.traits || {};
                const setpointTrait = traits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
                const mode = traits['sdm.devices.traits.ThermostatMode']?.mode || 'N/A';
                const hvacTrait = traits['sdm.devices.traits.ThermostatHvac'] || {};
                const ecoTrait = traits['sdm.devices.traits.ThermostatEco'] || {};
                
                // Extract setpoints - handle numbers, undefined, null
                // FIX: Previously HEATCOOL mode wasn't extracting setpoints correctly
                // CHANGE: Extract both heatCelsius and coolCelsius from setpoint trait
                // WHY: HEATCOOL mode requires both setpoints to be displayed and made adjustable
                const heatSetpoint = setpointTrait.heatCelsius;
                const coolSetpoint = setpointTrait.coolCelsius;
                
                // Determine device status from HVAC trait
                // FIX: Previously hardcoded status to 'ONLINE', causing incorrect status display
                // CHANGE: Extract actual status from ThermostatHvac trait, default to 'IDLE'
                // WHY: Status should reflect actual HVAC state (HEATING/COOLING/IDLE), not just connectivity
                const isEcoMode = ecoTrait.mode === 'MANUAL_ECO';
                let status = 'IDLE'; // Default to IDLE
                if (hvacTrait.status) {
                  // Map 'OFF' status to 'IDLE' for better UX
                  status = hvacTrait.status === 'OFF' ? 'IDLE' : hvacTrait.status;
                } else if (isEcoMode) {
                  status = 'IDLE'; // Default to IDLE when in ECO mode
                }
                
                // Debug logging for setpoint extraction
                console.log('Devices API - Extracting setpoints for device:', {
                  deviceId,
                  mode,
                  hasSetpointTrait: !!setpointTrait,
                  setpointTraitKeys: Object.keys(setpointTrait),
                  heatCelsius: heatSetpoint,
                  heatCelsiusType: typeof heatSetpoint,
                  coolCelsius: coolSetpoint,
                  coolCelsiusType: typeof coolSetpoint,
                  fullSetpointTrait: setpointTrait
                });
                
                // Get target temperature based on mode
                // FIX: Previously returned 'N/A' for HEATCOOL mode
                // CHANGE: Format targetTemp as range string "heat°C - cool°C" for HEATCOOL/AUTO modes
                // WHY: Users need to see both setpoints in HEATCOOL mode to understand the temperature range
                let targetTemp: number | string = 'N/A';
                
                if (mode === 'HEATCOOL' || mode === 'AUTO') {
                  // In HEATCOOL mode, return both if available, or format nicely
                  if (typeof heatSetpoint === 'number' && typeof coolSetpoint === 'number') {
                    targetTemp = `${heatSetpoint.toFixed(1)}°C - ${coolSetpoint.toFixed(1)}°C`;
                  } else if (typeof heatSetpoint === 'number') {
                    targetTemp = heatSetpoint;
                  } else if (typeof coolSetpoint === 'number') {
                    targetTemp = coolSetpoint;
                  }
                } else if (mode === 'HEAT') {
                  targetTemp = typeof heatSetpoint === 'number' ? heatSetpoint : 'N/A';
                } else if (mode === 'COOL') {
                  targetTemp = typeof coolSetpoint === 'number' ? coolSetpoint : 'N/A';
                } else {
                  // Try to get either setpoint as fallback
                  targetTemp = typeof heatSetpoint === 'number' ? heatSetpoint : 
                              (typeof coolSetpoint === 'number' ? coolSetpoint : 'N/A');
                }

                return {
                  id: deviceId,
                  name: device.name.split('/').pop(),
                  currentTemp: traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius || 'N/A',
                  targetTemp: targetTemp,
                  mode: mode,
                  humidity: traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 'N/A',
                  status: status, // Use actual HVAC status instead of hardcoded 'ONLINE'
                  type: 'google_nest',
                  lastUpdated: new Date().toISOString(),
                  // ADDED: Include raw setpoints for components that need them (e.g., TemperatureDial)
                  // WHY: Frontend components need individual heat/cool setpoint values for adjustment controls
                  //      The targetTemp string format is for display, but components need numeric values
                  heatSetpoint: typeof heatSetpoint === 'number' ? heatSetpoint : undefined,
                  coolSetpoint: typeof coolSetpoint === 'number' ? coolSetpoint : undefined,
                  // ADDED: Include full traits object for TemperatureDial component
                  // WHY: TemperatureDial component needs access to all traits for proper rendering
                  traits: traits
                };
              });
          }
        }
      } catch (error) {
        console.error('Devices API - Error fetching Google devices:', error);
      }
    } else {
      console.log('Devices API - No access token, skipping Google devices');
    }
    
    // Get Honeywell devices
    try {
      honeywellDevices = await deviceService.honeywellService.getAllDevices();
      console.log(`Devices API - Found ${honeywellDevices.length} Honeywell devices`);
    } catch (error) {
      console.error('Devices API - Error fetching Honeywell devices:', error);
    }
    
    // Combine all devices
    allDevices.push(...googleDevices, ...honeywellDevices);
    
    console.log(`Devices API - Total devices found: ${allDevices.length} (${googleDevices.length} Google, ${honeywellDevices.length} Honeywell)`);
    
    return NextResponse.json({
      devices: allDevices,
      status: 'success',
      summary: {
        total: allDevices.length,
        google: googleDevices.length,
        honeywell: honeywellDevices.length
      }
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