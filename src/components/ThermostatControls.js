import React, { useState, useEffect } from 'react';

const ThermostatControls = ({ deviceData, deviceId, session }) => {
  const [pendingSetpoint, setPendingSetpoint] = useState(null);
  const [adjustingSetpoint, setAdjustingSetpoint] = useState(null);
  const [setpointStatus, setSetpointStatus] = useState('');
  const [setpointIncrement, setSetpointIncrement] = useState(0.5);

  const celsiusToFahrenheit = (celsius) => (celsius * 9/5) + 32;

  // Extract temperature data from traits
  const getTemperatureData = () => {
    if (!deviceData?.traits) return null;
    
    return {
      heatSetpoint: deviceData.traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius,
      coolSetpoint: deviceData.traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius,
      currentTemp: deviceData.traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius,
      humidity: deviceData.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent,
      mode: deviceData.traits['sdm.devices.traits.ThermostatMode']?.mode,
      hvacStatus: deviceData.traits['sdm.devices.traits.ThermostatHvac']?.status,
      fanStatus: deviceData.traits['sdm.devices.traits.Fan']?.timerMode,
      ecoMode: deviceData.traits['sdm.devices.traits.ThermostatEco']?.mode,
      connectivity: deviceData.traits['sdm.devices.traits.Connectivity']?.status
    };
  };

  const adjustSetpoint = async (type, value) => {
    if (!deviceId) {
      console.error('No device ID available');
      setSetpointStatus('Error: No device ID available');
      return;
    }

    if (pendingSetpoint) return; // Prevent multiple changes while pending
    
    try {
      setAdjustingSetpoint(type);
      setSetpointStatus(`${type === 'heat' ? 'Heat' : 'Cool'} setpoint updating...`);
      setPendingSetpoint({ type, value, timestamp: Date.now() });
      
      const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/setTemperature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.accessToken}`
        },
        body: JSON.stringify({
          type,
          temperature: value
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update setpoint');
      }
    } catch (error) {
      console.error('Error updating setpoint:', error);
      setSetpointStatus(`Failed to update ${type} setpoint`);
      setPendingSetpoint(null);
      setTimeout(() => setSetpointStatus(''), 3000);
    } finally {
      setAdjustingSetpoint(null);
    }
  };

  useEffect(() => {
    if (!deviceData || !pendingSetpoint) return;

    const tempData = getTemperatureData();
    if (!tempData) return;

    const currentValue = pendingSetpoint.type === 'heat' 
      ? tempData.heatSetpoint 
      : tempData.coolSetpoint;

    if (currentValue === pendingSetpoint.value) {
      // Setpoint has been updated
      setSetpointStatus(`${pendingSetpoint.type === 'heat' ? 'Heat' : 'Cool'} setpoint updated`);
      setPendingSetpoint(null);
      setTimeout(() => setSetpointStatus(''), 2000);
    } else if (Date.now() - pendingSetpoint.timestamp > 30000) {
      // Timeout after 30 seconds
      setSetpointStatus(`Setpoint update timed out`);
      setPendingSetpoint(null);
      setTimeout(() => setSetpointStatus(''), 3000);
    }
  }, [deviceData, pendingSetpoint]);

  if (!deviceData) {
    return <div className="text-gray-500">No device data available</div>;
  }

  if (!deviceId) {
    return <div className="text-gray-500">No device ID available</div>;
  }

  const tempData = getTemperatureData();
  if (!tempData) {
    return <div className="text-gray-500">No temperature data available</div>;
  }

  return (
    <div className="thermostat-controls">
      {/* Status Information */}
      <div className="status-info mb-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="status-item">
            <span className="label">Mode:</span>
            <span className={`value ${tempData.mode?.toLowerCase()}`}>
              {tempData.mode || 'Unknown'}
            </span>
          </div>
          <div className="status-item">
            <span className="label">Status:</span>
            <span className={`value ${tempData.hvacStatus?.toLowerCase()}`}>
              {tempData.hvacStatus || 'Unknown'}
            </span>
          </div>
          <div className="status-item">
            <span className="label">Fan:</span>
            <span className="value">{tempData.fanStatus || 'Unknown'}</span>
          </div>
          <div className="status-item">
            <span className="label">Eco Mode:</span>
            <span className="value">{tempData.ecoMode || 'Unknown'}</span>
          </div>
        </div>
      </div>

      {/* Current Temperature Display */}
      {tempData.currentTemp !== undefined && (
        <div className="current-temp mb-6">
          <h3 className="text-lg font-semibold mb-2">Current Temperature</h3>
          <div className="temperature-display text-2xl">
            {tempData.currentTemp.toFixed(1)}°C / {celsiusToFahrenheit(tempData.currentTemp).toFixed(1)}°F
          </div>
          {tempData.humidity !== undefined && (
            <div className="humidity-display text-sm text-gray-600 mt-1">
              Humidity: {tempData.humidity}%
            </div>
          )}
        </div>
      )}

      {/* Heat Setpoint Control */}
      {tempData.heatSetpoint !== undefined && (
        <div className="setpoint-control">
          <h3 className="text-lg font-semibold mb-2">Heat Setpoint</h3>
          <div className="control-group">
            <button
              onClick={() => adjustSetpoint('heat', tempData.heatSetpoint - setpointIncrement)}
              disabled={pendingSetpoint !== null}
              className={`control-button ${pendingSetpoint?.type === 'heat' ? 'updating' : ''}`}
            >
              {pendingSetpoint?.type === 'heat' ? '...' : '-'}
            </button>
            <span className="temperature-display">
              {tempData.heatSetpoint.toFixed(1)}°C / {celsiusToFahrenheit(tempData.heatSetpoint).toFixed(1)}°F
            </span>
            <button
              onClick={() => adjustSetpoint('heat', tempData.heatSetpoint + setpointIncrement)}
              disabled={pendingSetpoint !== null}
              className={`control-button ${pendingSetpoint?.type === 'heat' ? 'updating' : ''}`}
            >
              {pendingSetpoint?.type === 'heat' ? '...' : '+'}
            </button>
          </div>
          <div className="status-group">
            <span className="increment-display">Increment: {setpointIncrement.toFixed(1)}°</span>
            {setpointStatus && (pendingSetpoint?.type === 'heat' || adjustingSetpoint === 'heat') && (
              <span className="status-message">{setpointStatus}</span>
            )}
          </div>
        </div>
      )}

      {/* Cool Setpoint Control */}
      {tempData.coolSetpoint !== undefined && (
        <div className="setpoint-control">
          <h3 className="text-lg font-semibold mb-2">Cool Setpoint</h3>
          <div className="control-group">
            <button
              onClick={() => adjustSetpoint('cool', tempData.coolSetpoint - setpointIncrement)}
              disabled={pendingSetpoint !== null}
              className={`control-button ${pendingSetpoint?.type === 'cool' ? 'updating' : ''}`}
            >
              {pendingSetpoint?.type === 'cool' ? '...' : '-'}
            </button>
            <span className="temperature-display">
              {tempData.coolSetpoint.toFixed(1)}°C / {celsiusToFahrenheit(tempData.coolSetpoint).toFixed(1)}°F
            </span>
            <button
              onClick={() => adjustSetpoint('cool', tempData.coolSetpoint + setpointIncrement)}
              disabled={pendingSetpoint !== null}
              className={`control-button ${pendingSetpoint?.type === 'cool' ? 'updating' : ''}`}
            >
              {pendingSetpoint?.type === 'cool' ? '...' : '+'}
            </button>
          </div>
          <div className="status-group">
            <span className="increment-display">Increment: {setpointIncrement.toFixed(1)}°</span>
            {setpointStatus && (pendingSetpoint?.type === 'cool' || adjustingSetpoint === 'cool') && (
              <span className="status-message">{setpointStatus}</span>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .thermostat-controls {
          padding: 1rem;
        }
        .status-info {
          background: #f8f9fa;
          padding: 1rem;
          border-radius: 0.5rem;
        }
        .status-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem;
        }
        .label {
          color: #666;
          font-size: 0.875rem;
        }
        .value {
          font-weight: 500;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
        }
        .value.heat {
          background: #fee2e2;
          color: #991b1b;
        }
        .value.cool {
          background: #dbeafe;
          color: #1e40af;
        }
        .value.off {
          background: #f3f4f6;
          color: #374151;
        }
        .current-temp {
          text-align: center;
          padding: 1rem;
          background: #f8f9fa;
          border-radius: 0.5rem;
        }
        .setpoint-control {
          margin-bottom: 1.5rem;
          padding: 1rem;
          background: #f8f9fa;
          border-radius: 0.5rem;
        }
        .control-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0.5rem 0;
        }
        .control-button {
          padding: 0.5rem 1rem;
          border-radius: 0.25rem;
          border: 1px solid #ccc;
          background: #f8f8f8;
          cursor: pointer;
          transition: all 0.2s;
        }
        .control-button:hover:not(:disabled) {
          background: #e8e8e8;
        }
        .control-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .control-button.updating {
          background: #e0e0e0;
        }
        .temperature-display {
          min-width: 120px;
          text-align: center;
          font-weight: 500;
        }
        .status-group {
          display: flex;
          align-items: center;
          gap: 1rem;
          font-size: 0.875rem;
          color: #666;
        }
        .status-message {
          font-style: italic;
        }
        .increment-display {
          color: #666;
        }
      `}</style>
    </div>
  );
};

export default ThermostatControls; 