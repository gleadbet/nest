'use client';

import { useEffect, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { fetchDevices } from './utils/api';

interface Device {
  name: string;
  type: string;
  traits: {
    'sdm.devices.traits.Info'?: {
      customName: string;
    };
    'sdm.devices.traits.Temperature'?: {
      ambientTemperatureCelsius: number;
    };
    'sdm.devices.traits.Humidity'?: {
      ambientHumidityPercent: number;
    };
    'sdm.devices.traits.ThermostatTemperatureSetpoint'?: {
      heatCelsius: number;
      coolCelsius: number;
    };
    'sdm.devices.traits.ThermostatMode'?: {
      mode: string;
    };
  };
}

// Add this helper function before the Home component
function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9/5) + 32;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('Session status:', status);
    console.log('Session data:', session);
  }, [session, status]);

  const loadDevices = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDevices();
      console.log('Devices data:', JSON.stringify(data, null, 2));
      
      if (!data || !Array.isArray(data.devices)) {
        console.error('Invalid devices data:', data);
        setDevices([]);
        return;
      }
      
      // Log the first device to see its structure
      if (data.devices.length > 0) {
        console.log('First device:', JSON.stringify(data.devices[0], null, 2));
      }
      
      setDevices(data.devices);
    } catch (err) {
      console.error('Error loading devices:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.accessToken) {
      console.log('Loading devices with access token');
      loadDevices();
    }
  }, [session]);

  if (status === 'loading') {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Devices</h1>
        <div className="text-gray-600">Loading authentication...</div>
      </div>
    );
  }

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

  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Devices</h1>
        <div className="text-gray-600">Loading devices...</div>
      </div>
    );
  }

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

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Nest Devices</h1>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Sign Out
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-2 border">Name</th>
              <th className="px-4 py-2 border">Type</th>
              <th className="px-4 py-2 border">Temperature</th>
              <th className="px-4 py-2 border">Humidity</th>
              <th className="px-4 py-2 border">Heat Setpoint</th>
              <th className="px-4 py-2 border">Cool Setpoint</th>
              <th className="px-4 py-2 border">Mode</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.name} className="hover:bg-gray-50">
                <td className="px-4 py-2 border">
                  {(() => {
                    // Extract the device type from the full type string
                    const deviceType = device.type
                      .split('sdm.devices.')
                      .pop()
                      ?.split('.')
                      .pop()
                      ?.replace(/([A-Z])/g, ' $1')
                      .trim();
                    
                    // Add a number if there are multiple devices of the same type
                    const deviceNumber = devices
                      .filter(d => d.type === device.type)
                      .findIndex(d => d.name === device.name) + 1;
                    
                    const displayName = deviceType + (deviceNumber > 1 ? ` ${deviceNumber}` : '');
                    
                    return displayName || 'Unknown Device';
                  })()}
                </td>
                <td className="px-4 py-2 border">{device.type}</td>
                <td className="px-4 py-2 border">
                  {device.traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius !== undefined ? (
                    <>
                      {device.traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius.toFixed(1)}°C
                      {' / '}
                      {celsiusToFahrenheit(device.traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius).toFixed(1)}°F
                    </>
                  ) : 'N/A'}
                </td>
                <td className="px-4 py-2 border">
                  {device.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent ?? 'N/A'}%
                </td>
                <td className="px-4 py-2 border">
                  {device.traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius !== undefined ? (
                    <>
                      {device.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'].heatCelsius.toFixed(1)}°C
                      {' / '}
                      {celsiusToFahrenheit(device.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'].heatCelsius).toFixed(1)}°F
                    </>
                  ) : 'N/A'}
                </td>
                <td className="px-4 py-2 border">
                  {device.traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius !== undefined ? (
                    <>
                      {device.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'].coolCelsius.toFixed(1)}°C
                      {' / '}
                      {celsiusToFahrenheit(device.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'].coolCelsius).toFixed(1)}°F
                    </>
                  ) : 'N/A'}
                </td>
                <td className="px-4 py-2 border">
                  {device.traits['sdm.devices.traits.ThermostatMode']?.mode ?? 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={loadDevices}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Refresh Devices
      </button>
    </div>
  );
} 