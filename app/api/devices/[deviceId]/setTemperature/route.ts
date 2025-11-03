/**
 * Next.js API Route: Set Temperature Endpoint
 * 
 * Handles temperature setpoint adjustments for Google Nest and Honeywell thermostats.
 * 
 * Recent Updates (v4.0):
 * - HEATCOOL Mode Support: Now uses SetRange command as required by Google Nest API
 *   - Previously used individual SetHeat/SetCool commands which were rejected in HEATCOOL mode
 *   - SetRange command sets both heatCelsius and coolCelsius simultaneously
 * - Response Format: Returns formatted device data with heatSetpoint and coolSetpoint
 *   - Enables frontend to immediately update UI state after successful adjustments
 *   - Prevents buttons from being disabled due to missing setpoint data
 * 
 * API Endpoint: POST /api/devices/[deviceId]/setTemperature
 * 
 * Request Body:
 *   - type: 'heat' | 'cool' (required)
 *   - temperature: number (required, 9-32°C)
 * 
 * Response:
 *   - success: boolean
 *   - device: { id, mode, heatSetpoint, coolSetpoint, traits }
 * 
 * @version 4.0
 * @date 2025-11-03
 */

/**
 * Set Temperature API Route
 * 
 * Handles temperature setpoint adjustments for Google Nest and Honeywell thermostats.
 * 
 * Key Features:
 * - Supports HEAT, COOL, and HEATCOOL modes
 * - Uses SetRange command for HEATCOOL mode (required by Google Nest API)
 * - Validates minimum gap between heat and cool setpoints (1.7°C / 3°F)
 * - Returns formatted device data with setpoints for frontend state management
 * 
 * Version 4.0.1 Changes:
 * - Fixed SetRange command usage for HEATCOOL mode (Google API requirement)
 * - Added formatted response with heatSetpoint/coolSetpoint for frontend
 * - Improved error handling and validation
 */

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

    // Validate temperature range (Nest thermostats typically support 9-32°C)
    if (temperature < 9 || temperature > 32) {
      return NextResponse.json({ 
        error: 'Temperature out of range',
        details: 'Temperature must be between 9°C and 32°C (48°F and 90°F)'
      }, { status: 400 });
    }

    // For HEATCOOL mode, validate that heat < cool
    // Get current device state to check mode and current setpoints
    // FIX: mode and setpoints need to be in function scope for command selection
    // CHANGE: Declare at function scope so they're accessible for SetRange command logic
    // WHY: Need mode and setpoints both for validation and for building SetRange params
    let mode: string | undefined;
    let setpoints: any = {};
    
    try {
      const deviceResponse = await fetch(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${params.deviceId}`,
        {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
          }
        }
      );

      if (deviceResponse.ok) {
        const deviceData = await deviceResponse.json();
        mode = deviceData.traits?.['sdm.devices.traits.ThermostatMode']?.mode;
        setpoints = deviceData.traits?.['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
        
        // In HEATCOOL mode, validate setpoint relationships
        // FIX: Google API requires heat setpoint < cool setpoint with a minimum gap
        // CHANGE: Add stricter validation to ensure setpoints maintain proper relationship
        // WHY: Google Nest API rejects requests that violate the heat < cool constraint
        if (mode === 'HEATCOOL' || mode === 'AUTO') {
          const currentHeat = setpoints.heatCelsius;
          const currentCool = setpoints.coolCelsius;
          
          // Minimum gap between heat and cool setpoints
          // Google Nest API typically requires 2-3°F gap (1.1-1.7°C)
          // Using 1.7°C (3°F) to be safe and account for rounding
          const MIN_GAP = 1.7; // 1.7°C (3°F) minimum gap to be safe
          
          if (type === 'heat') {
            if (typeof currentCool === 'number') {
              // Heat setpoint must be at least MIN_GAP below cool setpoint
              const maxHeat = currentCool - MIN_GAP;
              if (temperature >= maxHeat) {
                return NextResponse.json({ 
                  error: 'Invalid setpoint',
                  details: `Heat setpoint (${temperature.toFixed(1)}°C) must be at least ${MIN_GAP.toFixed(1)}°C below cool setpoint (${currentCool.toFixed(1)}°C). Maximum: ${maxHeat.toFixed(1)}°C`
                }, { status: 400 });
              }
            }
          }
          
          if (type === 'cool') {
            if (typeof currentHeat === 'number') {
              // Cool setpoint must be at least MIN_GAP above heat setpoint
              const minCool = currentHeat + MIN_GAP;
              if (temperature <= minCool) {
                return NextResponse.json({ 
                  error: 'Invalid setpoint',
                  details: `Cool setpoint (${temperature.toFixed(1)}°C) must be at least ${MIN_GAP.toFixed(1)}°C above heat setpoint (${currentHeat.toFixed(1)}°C). Minimum: ${minCool.toFixed(1)}°C`
                }, { status: 400 });
              }
            }
          }
        }
      }
    } catch (error) {
      // If we can't fetch device state, continue anyway - the API will validate
      console.warn('Could not fetch device state for validation:', error);
    }

    // FIX: Google Nest API requires SetRange command in HEATCOOL mode, not SetHeat/SetCool
    // CHANGE: Use SetRange with both setpoints for HEATCOOL mode
    // WHY: Google API does not allow individual SetHeat/SetCool commands in HEATCOOL mode
    let command: string;
    let commandParams: any;
    
    if (mode === 'HEATCOOL' || mode === 'AUTO') {
      // Use SetRange command with both setpoints
      command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange';
      const currentHeat = setpoints.heatCelsius;
      const currentCool = setpoints.coolCelsius;
      
      if (type === 'heat') {
        commandParams = {
          heatCelsius: temperature,
          coolCelsius: typeof currentCool === 'number' ? currentCool : (temperature + 1.7)
        };
      } else {
        commandParams = {
          heatCelsius: typeof currentHeat === 'number' ? currentHeat : (temperature - 1.7),
          coolCelsius: temperature
        };
      }
    } else {
      // For HEAT/COOL modes, use individual commands
      command = type === 'heat' 
        ? 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat'
        : 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';
      commandParams = {
        [type === 'heat' ? 'heatCelsius' : 'coolCelsius']: temperature
      };
    }

    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${params.deviceId}:executeCommand`;
    
    console.log('Set Temperature API - Executing command:', {
      deviceId: params.deviceId,
      type,
      temperature,
      command,
      params: commandParams,
      mode
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command,
        params: commandParams
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      
      console.error('Set Temperature API - Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorData,
        deviceId: params.deviceId,
        type,
        temperature,
        errorText: errorText
      });
      
      // Extract more detailed error message from Google API response
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      let errorDetails = errorText;
      
      if (errorData?.error) {
        errorMessage = errorData.error.message || errorMessage;
        errorDetails = errorData.error.details || errorData.error.message || errorDetails;
      } else if (errorData?.message) {
        errorMessage = errorData.message;
        errorDetails = errorData.message;
      }
      
      return NextResponse.json(
        { 
          error: errorMessage,
          details: errorDetails
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // FIX: Return formatted device data with setpoints for frontend use
    // CHANGE: Fetch updated device state and return formatted response
    // WHY: Frontend needs heatSetpoint and coolSetpoint to enable/disable buttons
    try {
      const updatedDeviceResponse = await fetch(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${params.deviceId}`,
        {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
          }
        }
      );
      
      if (updatedDeviceResponse.ok) {
        const updatedDevice = await updatedDeviceResponse.json();
        const updatedTraits = updatedDevice.traits || {};
        const updatedSetpoints = updatedTraits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
        const updatedMode = updatedTraits['sdm.devices.traits.ThermostatMode']?.mode;
        
        // Return formatted response with setpoints
        return NextResponse.json({
          success: true,
          device: {
            id: params.deviceId,
            mode: updatedMode,
            heatSetpoint: typeof updatedSetpoints.heatCelsius === 'number' 
              ? Number(updatedSetpoints.heatCelsius.toFixed(1)) 
              : undefined,
            coolSetpoint: typeof updatedSetpoints.coolCelsius === 'number' 
              ? Number(updatedSetpoints.coolCelsius.toFixed(1)) 
              : undefined,
            traits: updatedTraits // Include full traits for frontend parsing
          }
        });
      }
    } catch (error) {
      console.warn('Could not fetch updated device state, returning basic response:', error);
    }
    
    // Fallback to basic response if we can't fetch updated state
    return NextResponse.json({ success: true, data });
    
  } catch (error) {
    console.error('Set Temperature API - Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set temperature' },
      { status: 500 }
    );
  }
} 