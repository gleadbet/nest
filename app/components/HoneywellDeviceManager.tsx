'use client';

import React, { useState, useEffect } from 'react';

interface HoneywellDevice {
  id: string;
  name: string;
  currentTemp: number | string;
  targetTemp: number | string;
  mode: string;
  humidity: number | string;
  status: string;
  type: string;
  ip: string;
  lastUpdated: string;
  error?: string;
}

interface DiscoveryResult {
  honeywell: number;
  total: number;
}

const HoneywellDeviceManager: React.FC = () => {
  const [devices, setDevices] = useState<HoneywellDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [manualIP, setManualIP] = useState('');
  const [manualName, setManualName] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [temperature, setTemperature] = useState('');
  const [mode, setMode] = useState('HEAT');
  const [message, setMessage] = useState('');

  // Load devices on component mount
  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/devices/honeywell');
      if (response.ok) {
        const data = await response.json();
        setDevices(data);
      } else {
        setMessage('Failed to load devices');
      }
    } catch (error) {
      console.error('Error loading devices:', error);
      setMessage('Error loading devices');
    } finally {
      setLoading(false);
    }
  };

  const runDiscovery = async () => {
    setDiscovering(true);
    try {
      const response = await fetch('/api/devices/honeywell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'discover' }),
      });

      if (response.ok) {
        const result: DiscoveryResult = await response.json();
        setMessage(`Discovery complete. Found ${result.honeywell} Honeywell devices.`);
        await loadDevices(); // Reload devices after discovery
      } else {
        setMessage('Discovery failed');
      }
    } catch (error) {
      console.error('Error during discovery:', error);
      setMessage('Error during discovery');
    } finally {
      setDiscovering(false);
    }
  };

  const addDevice = async () => {
    if (!manualIP.trim()) {
      setMessage('Please enter an IP address');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/devices/honeywell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'add',
          ip: manualIP.trim(),
          name: manualName.trim() || null,
        }),
      });

      if (response.ok) {
        setMessage('Device added successfully');
        setManualIP('');
        setManualName('');
        await loadDevices();
      } else {
        const error = await response.json();
        setMessage(`Failed to add device: ${error.error}`);
      }
    } catch (error) {
      console.error('Error adding device:', error);
      setMessage('Error adding device');
    } finally {
      setLoading(false);
    }
  };

  const removeDevice = async (deviceId: string) => {
    if (!confirm('Are you sure you want to remove this device?')) {
      return;
    }

    try {
      const response = await fetch(`/api/devices/honeywell/${deviceId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setMessage('Device removed successfully');
        await loadDevices();
      } else {
        setMessage('Failed to remove device');
      }
    } catch (error) {
      console.error('Error removing device:', error);
      setMessage('Error removing device');
    }
  };

  const setDeviceTemperature = async () => {
    if (!selectedDevice || !temperature.trim()) {
      setMessage('Please select a device and enter a temperature');
      return;
    }

    const tempValue = parseFloat(temperature);
    if (isNaN(tempValue)) {
      setMessage('Please enter a valid temperature');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/devices/honeywell/${selectedDevice}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'setTemperature',
          temperature: tempValue,
          mode: mode,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setMessage(`Temperature set successfully to ${tempValue}°C`);
        setTemperature('');
        await loadDevices();
      } else {
        const error = await response.json();
        setMessage(`Failed to set temperature: ${error.error}`);
      }
    } catch (error) {
      console.error('Error setting temperature:', error);
      setMessage('Error setting temperature');
    } finally {
      setLoading(false);
    }
  };

  const setDeviceMode = async (deviceId: string, newMode: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/devices/honeywell/${deviceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'setMode',
          mode: newMode,
        }),
      });

      if (response.ok) {
        setMessage(`Mode set successfully to ${newMode}`);
        await loadDevices();
      } else {
        const error = await response.json();
        setMessage(`Failed to set mode: ${error.error}`);
      }
    } catch (error) {
      console.error('Error setting mode:', error);
      setMessage('Error setting mode');
    } finally {
      setLoading(false);
    }
  };

  const formatTemperature = (temp: number | string) => {
    if (typeof temp === 'number') {
      return `${temp.toFixed(1)}°C`;
    }
    return temp;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return 'text-green-600';
      case 'ERROR':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Honeywell Resideo Thermostat Manager</h1>
      
      {/* Message Display */}
      {message && (
        <div className="mb-4 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded">
          {message}
        </div>
      )}

      {/* Discovery Section */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-xl font-semibold mb-4">Device Discovery</h2>
        <div className="flex gap-4 items-end">
          <button
            onClick={runDiscovery}
            disabled={discovering}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {discovering ? 'Discovering...' : 'Discover Devices'}
          </button>
          <button
            onClick={loadDevices}
            disabled={loading}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-400"
          >
            Refresh Devices
          </button>
        </div>
      </div>

      {/* Manual Add Section */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-xl font-semibold mb-4">Add Device Manually</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">IP Address</label>
            <input
              type="text"
              value={manualIP}
              onChange={(e) => setManualIP(e.target.value)}
              placeholder="192.168.1.100"
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name (Optional)</label>
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Living Room Thermostat"
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={addDevice}
              disabled={loading || !manualIP.trim()}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
            >
              Add Device
            </button>
          </div>
        </div>
      </div>

      {/* Temperature Control Section */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-xl font-semibold mb-4">Temperature Control</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Device</label>
            <select
              value={selectedDevice || ''}
              onChange={(e) => setSelectedDevice(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            >
              <option value="">Choose a device...</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Temperature (°C)</label>
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="22.0"
              step="0.5"
              min="4.4"
              max="32.2"
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            >
              <option value="HEAT">Heat</option>
              <option value="COOL">Cool</option>
              <option value="AUTO">Auto</option>
              <option value="OFF">Off</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={setDeviceTemperature}
              disabled={loading || !selectedDevice || !temperature.trim()}
              className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400"
            >
              Set Temperature
            </button>
          </div>
        </div>
      </div>

      {/* Devices List */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Discovered Devices</h2>
        {loading ? (
          <div className="text-center py-8">Loading devices...</div>
        ) : devices.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No Honeywell devices found. Try running discovery or adding a device manually.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((device) => (
              <div key={device.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-lg">{device.name}</h3>
                  <span className={`text-sm font-medium ${getStatusColor(device.status)}`}>
                    {device.status}
                  </span>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Current:</span>
                    <span className="font-medium">{formatTemperature(device.currentTemp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Target:</span>
                    <span className="font-medium">{formatTemperature(device.targetTemp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Mode:</span>
                    <span className="font-medium">{device.mode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Humidity:</span>
                    <span className="font-medium">
                      {typeof device.humidity === 'number' ? `${device.humidity.toFixed(1)}%` : device.humidity}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">IP:</span>
                    <span className="font-mono text-sm">{device.ip}</span>
                  </div>
                </div>

                {device.error && (
                  <div className="mb-3 p-2 bg-red-100 border border-red-300 text-red-700 rounded text-sm">
                    Error: {device.error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setDeviceMode(device.id, 'HEAT')}
                    disabled={loading}
                    className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 disabled:bg-gray-400"
                  >
                    Heat
                  </button>
                  <button
                    onClick={() => setDeviceMode(device.id, 'COOL')}
                    disabled={loading}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:bg-gray-400"
                  >
                    Cool
                  </button>
                  <button
                    onClick={() => setDeviceMode(device.id, 'AUTO')}
                    disabled={loading}
                    className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600 disabled:bg-gray-400"
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => setDeviceMode(device.id, 'OFF')}
                    disabled={loading}
                    className="px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 disabled:bg-gray-400"
                  >
                    Off
                  </button>
                  <button
                    onClick={() => removeDevice(device.id)}
                    disabled={loading}
                    className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:bg-gray-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HoneywellDeviceManager; 