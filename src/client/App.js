import React, { useState, useEffect } from 'react';
import TemperatureGraph from '../components/TemperatureGraph';

function App() {
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [useFahrenheit, setUseFahrenheit] = useState(true);
  const [pollInterval, setPollInterval] = useState(30);
  const [tempIncrement, setTempIncrement] = useState(0.5);
  const [pollError, setPollError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isPolling, setIsPolling] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [newName, setNewName] = useState('');
  const BASE_INTERVAL = 60000;

  // Check authentication status
  const checkAuth = async () => {
    try {
      console.log('Checking authentication status...');
      const response = await fetch('/api/auth/status', {
        credentials: 'include'
      });
      const data = await response.json();
      console.log('Auth status response:', data);
      
      if (!response.ok || !data.authenticated) {
        console.log('Not authenticated, redirecting to login...');
        window.location.href = '/auth/login';
        return false;
      }
      
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      console.error('Error checking auth status:', error);
      window.location.href = '/auth/login';
      return false;
    }
  };

  const fetchDevices = async () => {
    try {
      // Check authentication first
      const isAuth = await checkAuth();
      if (!isAuth) return;

      console.log('Fetching devices...');
      const response = await fetch('/api/devices', {
        credentials: 'include'
      });
      
      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Raw response data:', data);
      
      if (!response.ok) {
        if (data.authenticated === false) {
          setError('Session expired. Please login again.');
          setLoading(false);
          window.location.href = '/auth/login';
          return;
        }
        if (response.status === 429) {
          const newRetryCount = retryCount + 1;
          setRetryCount(newRetryCount);
          const backoffTime = Math.min(BASE_INTERVAL * Math.pow(2, newRetryCount), 300000);
          setPollError(`Rate limited. Next update in ${Math.round(backoffTime/1000)} seconds...`);
          setIsPolling(false);
          setTimeout(() => {
            setIsPolling(true);
            setRetryCount(0);
          }, backoffTime);
          return;
        }
        throw new Error(data.details || data.error || 'Failed to fetch devices');
      }

      // Reset retry count on successful fetch
      setRetryCount(0);
      setPollError(null);
      setIsPolling(true);
      setLoading(false);

      if (!Array.isArray(data)) {
        console.error('Invalid response format:', data);
        return;
      }

      console.log('Processing device data...');
      const processedData = data.map(device => {
        console.log('Processing device:', device);
        const processed = {
          ...device,
          currentTemp: typeof device.currentTemp === 'number' ? device.currentTemp : 
            device.currentTemp === 'N/A' ? 'N/A' : parseFloat(device.currentTemp),
          targetTemp: typeof device.targetTemp === 'number' ? device.targetTemp : 
            device.targetTemp === 'N/A' ? 'N/A' : parseFloat(device.targetTemp),
          timestamp: new Date().toISOString() // Add timestamp for graph updates
        };
        console.log('Processed device:', processed);
        return processed;
      });

      console.log('Setting devices with processed data:', processedData);
      setDevices(processedData);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching devices:', error);
      setError(error.message);
      setLoading(false);
    }
  };

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Set up polling with the configured interval
  useEffect(() => {
    if (!isAuthenticated) return;

    console.log('Setting up polling with interval:', pollInterval);
    fetchDevices(); // Initial fetch
    
    let intervalId;
    const setupPolling = () => {
      if (!isPolling || !isAuthenticated) return;
      
      const currentInterval = retryCount > 0 
        ? Math.min(BASE_INTERVAL * Math.pow(2, retryCount), 300000)
        : pollInterval * 1000;

      intervalId = setInterval(fetchDevices, currentInterval);
    };

    setupPolling();
    
    return () => {
      console.log('Cleaning up polling interval');
      clearInterval(intervalId);
    };
  }, [pollInterval, retryCount, isPolling, isAuthenticated]);

  // Convert Celsius to Fahrenheit
  const toFahrenheit = (celsius) => {
    if (typeof celsius !== 'number' || isNaN(celsius)) {
      return 'N/A';
    }
    return (celsius * 9/5) + 32;
  };
  
  // Format temperature based on selected unit
  const formatTemp = (celsius, useFahrenheit) => {
    if (celsius === undefined || celsius === null || celsius === 'N/A') {
      return 'N/A';
    }
    const temp = parseFloat(celsius);
    if (isNaN(temp)) {
      return 'N/A';
    }
    if (useFahrenheit) {
      const fahrenheit = toFahrenheit(temp);
      return fahrenheit === 'N/A' ? 'N/A' : `${fahrenheit.toFixed(1)}°F`;
    }
    return `${temp.toFixed(1)}°C`;
  };

  // Get temperature from device traits
  const getCurrentTemp = (device) => {
    const temp = device?.currentTemp;
    return temp === undefined || temp === null ? 'N/A' : parseFloat(temp);
  };

  // Get target temperature from device traits
  const getTargetTemp = (device) => {
    const temp = device?.targetTemp;
    return temp === undefined || temp === null ? 'N/A' : parseFloat(temp);
  };

  // Get mode from device traits
  const getMode = (device) => {
    return device?.mode || 'Unknown';
  };

  // Get humidity from device traits
  const getHumidity = (device) => {
    const humidity = device?.humidity;
    return humidity === undefined || humidity === null ? 'N/A' : humidity;
  };

  // Get display name for device
  const getDisplayName = (device) => {
    if (!device?.name) return 'Unknown Device';
    // If the name is a full path, extract just the last part
    const parts = device.name.split('/');
    return parts[parts.length - 1];
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleTimeString();
  };

  const handleTempChange = async (device, newTemp) => {
    try {
      // Check if device is in ECO mode
      if (device.mode === 'ECO') {
        alert('Cannot set temperature while in ECO mode. Please change the thermostat mode to HEAT or COOL first.');
        return;
      }

      // Convert to Celsius if using Fahrenheit
      const tempToSend = useFahrenheit ? (newTemp - 32) * 5/9 : newTemp;
      
      console.log('Sending temperature update:', {
        deviceId: device.id,
        newTemp,
        tempToSend,
        useFahrenheit,
        mode: device.mode
      });

      const response = await fetch(`/api/devices/${device.id}/temperature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          temperature: tempToSend,
          useFahrenheit
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to update temperature');
      }

      const updatedDevices = await response.json();
      setDevices(updatedDevices);
    } catch (error) {
      console.error('Error updating temperature:', error);
      alert(`Failed to update temperature: ${error.message}`);
    }
  };

  const handleIncrement = async (device, increment) => {
    try {
      // Convert current temperature to Celsius if needed
      const currentTemp = typeof device.targetTemp === 'number' ? device.targetTemp : 
        useFahrenheit ? (parseFloat(device.targetTemp) - 32) * 5/9 : parseFloat(device.targetTemp);
      
      if (isNaN(currentTemp)) {
        throw new Error('Invalid current temperature');
      }

      // Calculate new temperature in Celsius
      const newTemp = currentTemp + increment;

      // Validate temperature range (9-32°C or 48-90°F)
      const minTemp = useFahrenheit ? (48 - 32) * 5/9 : 9;
      const maxTemp = useFahrenheit ? (90 - 32) * 5/9 : 32;
      
      if (newTemp < minTemp || newTemp > maxTemp) {
        throw new Error(`Temperature must be between ${useFahrenheit ? '48°F' : '9°C'} and ${useFahrenheit ? '90°F' : '32°C'}`);
      }

      // Update the temperature
      const response = await fetch(`/api/devices/${device.id}/temperature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          temperature: newTemp,
          useFahrenheit: useFahrenheit 
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to update temperature');
      }

      // Fetch updated device list to ensure all data is in sync
      await fetchDevices();
    } catch (error) {
      console.error('Error updating temperature:', error);
      alert(`Failed to update temperature: ${error.message}`);
    }
  };

  // Get the current run status based on mode and temperatures
  const getRunStatus = (device) => {
    if (device.mode === 'OFF' || device.mode === 'ECO') {
      return 'Off';
    }
    
    const currentTemp = parseFloat(device.currentTemp);
    const targetTemp = parseFloat(device.targetTemp);
    
    if (isNaN(currentTemp) || isNaN(targetTemp)) {
      return 'Unknown';
    }

    if (device.mode === 'HEAT') {
      return currentTemp < targetTemp ? 'Heating' : 'Idle';
    } else if (device.mode === 'COOL') {
      return currentTemp > targetTemp ? 'Cooling' : 'Idle';
    }
    
    return 'Unknown';
  };

  const handleModeChange = async (device, newMode) => {
    try {
      const response = await fetch(`/api/devices/${device.id}/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: newMode }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to update mode');
      }

      const updatedDevices = await response.json();
      setDevices(updatedDevices);
    } catch (error) {
      console.error('Error updating mode:', error);
      alert(`Failed to update mode: ${error.message}`);
    }
  };

  const handleNameChange = async (deviceId, newName) => {
    try {
      console.log('Updating device name:', { deviceId, newName });
      const response = await fetch(`/api/devices/${deviceId}/name`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ name: newName })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update device name');
      }

      // Update local state immediately for better UX
      setDevices(prevDevices => 
        prevDevices.map(device => 
          device.id === deviceId 
            ? { ...device, name: newName }
            : device
        )
      );

      // Fetch fresh data in the background
      fetchDevices();
    } catch (error) {
      console.error('Error updating device name:', error);
      setError(error.message);
    } finally {
      setEditingName(null);
      setNewName('');
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Loading...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold text-red-500 mb-4">Error</h1>
        <p className="text-red-700">{error}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Nest Thermostat Control</h1>
        <p className="mb-4">Please login to continue</p>
        <a 
          href="/auth/login" 
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 inline-block"
        >
          Login with Google
        </a>
      </div>
    );
  }

  // Ensure devices is an array before rendering
  const deviceList = Array.isArray(devices) ? devices : [];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Nest Thermostat Control</h1>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <label htmlFor="pollInterval" className="text-sm text-gray-600">Update every:</label>
            <select
              id="pollInterval"
              value={pollInterval}
              onChange={(e) => setPollInterval(Number(e.target.value))}
              className="border rounded px-2 py-1"
            >
              <option value="30">30 seconds</option>
              <option value="60">1 minute</option>
              <option value="120">2 minutes</option>
              <option value="300">5 minutes</option>
            </select>
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="tempIncrement" className="text-sm text-gray-600">Temp increment:</label>
            <select
              id="tempIncrement"
              value={tempIncrement}
              onChange={(e) => setTempIncrement(Number(e.target.value))}
              className="border rounded px-2 py-1"
            >
              <option value="0.5">0.5°</option>
              <option value="1">1.0°</option>
              <option value="2">2.0°</option>
              <option value="5">5.0°</option>
            </select>
          </div>
          <button
            onClick={() => setUseFahrenheit(!useFahrenheit)}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Switch to {useFahrenheit ? 'Celsius' : 'Fahrenheit'}
          </button>
          <a 
            href="/auth/logout" 
            className="text-blue-500 hover:text-blue-700"
          >
            Logout
          </a>
        </div>
      </div>

      {deviceList.length === 0 ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 p-4">
          <p className="text-yellow-700">No thermostats found. Please make sure you have a Nest thermostat connected to your account.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="text-sm text-gray-500 mb-2">
            Last updated: {formatTimestamp(lastUpdate)}
          </div>
          <table className="min-w-full bg-white border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-4 py-2 border">Name</th>
                <th className="px-4 py-2 border">Current Temp</th>
                <th className="px-4 py-2 border">Target Temp</th>
                <th className="px-4 py-2 border">Mode</th>
                <th className="px-4 py-2 border">Status</th>
                <th className="px-4 py-2 border">Humidity</th>
                <th className="px-4 py-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deviceList.map(device => (
                <tr key={device.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 border">
                    {editingName === device.id ? (
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="border rounded px-2 py-1 w-32"
                          placeholder="New name"
                        />
                        <button
                          onClick={() => handleNameChange(device.id, newName)}
                          className="text-green-600 hover:text-green-900"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => {
                            setEditingName(null);
                            setNewName('');
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">{device.name}</span>
                        <button
                          onClick={() => {
                            setEditingName(device.id);
                            setNewName(device.name);
                          }}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 border text-center">
                    {formatTemp(device.currentTemp, useFahrenheit)}
                  </td>
                  <td className="px-4 py-2 border">
                    <div className="flex items-center justify-center space-x-2">
                      <button
                        onClick={() => handleIncrement(device, -tempIncrement)}
                        className="text-blue-500 hover:text-blue-700 px-2 py-1 border rounded"
                      >
                        -
                      </button>
                      <span className="w-16 text-center">
                        {formatTemp(device.targetTemp, useFahrenheit)}
                      </span>
                      <button
                        onClick={() => handleIncrement(device, tempIncrement)}
                        className="text-blue-500 hover:text-blue-700 px-2 py-1 border rounded"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2 border">
                    <select
                      value={device.mode || ''}
                      onChange={(e) => handleModeChange(device, e.target.value)}
                      className="w-full p-1 border rounded"
                    >
                      <option value="HEAT">HEAT</option>
                      <option value="COOL">COOL</option>
                      <option value="ECO">ECO</option>
                      <option value="OFF">OFF</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 border text-center">
                    <span className={`px-2 py-1 rounded text-sm ${
                      getRunStatus(device) === 'Heating' ? 'bg-red-100 text-red-800' :
                      getRunStatus(device) === 'Cooling' ? 'bg-blue-100 text-blue-800' :
                      getRunStatus(device) === 'Idle' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {getRunStatus(device)}
                    </span>
                  </td>
                  <td className="px-4 py-2 border text-center">
                    {device.humidity}%
                  </td>
                  <td className="px-4 py-2 border">
                    <button
                      onClick={() => setSelectedDevice(device)}
                      className="text-blue-500 hover:text-blue-700"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Add polling status display */}
      {pollError && (
        <div className="mt-4 p-2 bg-yellow-100 text-yellow-800 rounded">
          {pollError}
        </div>
      )}
      
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Temperature History</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {devices.map(device => (
            <TemperatureGraph
              key={device.id}
              device={device}
              useFahrenheit={useFahrenheit}
              timestamp={device.timestamp} // Pass timestamp to force updates
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default App; 