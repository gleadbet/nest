'use client';

import { useEffect, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { fetchDevices } from './utils/api';
import TemperatureGraph from './components/TemperatureGraph';
import TemperatureDial from './components/TemperatureDial';

// Define the structure of a Nest device and its traits
interface Device {
  name: string;  // Unique identifier for the device
  type: string;  // Device type (e.g., 'sdm.devices.types.THERMOSTAT')
  traits: {
    // Device information traits
    'sdm.devices.traits.Info'?: {
      customName: string;  // User-defined device name
    };
    // Temperature sensor traits
    'sdm.devices.traits.Temperature'?: {
      ambientTemperatureCelsius: number;  // Current temperature reading
    };
    // Humidity sensor traits
    'sdm.devices.traits.Humidity'?: {
      ambientHumidityPercent: number;  // Current humidity reading
    };
    // Thermostat control traits
    'sdm.devices.traits.ThermostatTemperatureSetpoint'?: {
      heatCelsius: number;  // Heat setpoint
      coolCelsius: number;  // Cool setpoint
    };
    // Thermostat mode traits
    'sdm.devices.traits.ThermostatMode'?: {
      mode: string;  // Current mode (HEAT, COOL, OFF, etc.)
    };
  };
}

// Utility function to convert Celsius to Fahrenheit
function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9/5) + 32;
}

export default function Home() {
  // Authentication state from NextAuth
  const { data: session, status } = useSession();
  
  // Local state for devices and UI
  const [devices, setDevices] = useState<Device[]>([]);  // List of Nest devices
  const [loading, setLoading] = useState(false);         // Loading state for API calls
  const [error, setError] = useState<string | null>(null); // Error state for API failures

  // Debug logging for session state changes
  useEffect(() => {
    console.log('Session status:', status);
    console.log('Session data:', session);
  }, [session, status]);

  // Function to fetch devices from the Nest API
  const loadDevices = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch devices using the API utility
      const data = await fetchDevices();
      console.log('Devices data:', JSON.stringify(data, null, 2));
      
      // Validate the response data
      if (!data || !Array.isArray(data.devices)) {
        console.error('Invalid devices data:', data);
        setDevices([]);
        return;
      }
      
      // Log the first device for debugging
      if (data.devices.length > 0) {
        console.log('First device:', JSON.stringify(data.devices[0], null, 2));
      }
      
      // Update the devices state with the fetched data
      setDevices(data.devices);
    } catch (err) {
      console.error('Error loading devices:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  // Load devices when the session is available
  useEffect(() => {
    if (session?.accessToken) {
      console.log('Loading devices with access token');
      loadDevices();
    }
  }, [session]);

  // Loading state UI
  if (status === 'loading') {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Devices</h1>
        <div className="text-gray-600">Loading authentication...</div>
      </div>
    );
  }

  // Unauthenticated state UI
  if (!session) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Devices</h1>
        <button
          onClick={() => signIn('google', { callbackUrl: '/' })}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  // Loading devices state UI
  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Devices</h1>
        <div className="text-gray-600">Loading devices...</div>
      </div>
    );
  }

  // Error state UI
  if (error) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Devices</h1>
        <div className="text-red-500 mb-4">Error: {error}</div>
        <button
          onClick={loadDevices}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Main UI - Device grid
  return (
    <div className="p-4">
      {/* Header with sign out button */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Nest Devices</h1>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Sign Out
        </button>
      </div>
      
      {/* Device grid - 1 column on mobile, 2 columns on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {devices.map((device) => (
          <div key={device.name} className="bg-white rounded-lg shadow">
            {/* Device header with name */}
            <h2 className="text-xl font-semibold p-4 border-b">
              {device.traits['sdm.devices.traits.Info']?.customName || 
               device.type.split('.').pop()?.replace(/([A-Z])/g, ' $1').trim()}
            </h2>
            
            <div>
              {/* Temperature dial component - always shown */}
              <TemperatureDial 
                deviceId={device.name.split('/').pop() || ''} 
                refreshInterval={30000} // 30 seconds refresh
              />
              
              {/* Temperature graph - only shown for devices with temperature traits */}
              {device.traits['sdm.devices.traits.Temperature'] && (
                <div className="border-t">
                  <TemperatureGraph 
                    deviceId={device.name.split('/').pop() || ''} 
                    refreshInterval={300000} // 5 minutes refresh
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Global refresh button */}
      <button
        onClick={loadDevices}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Refresh Devices
      </button>
    </div>
  );
} 