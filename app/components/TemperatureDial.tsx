import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useSession } from 'next-auth/react';

/**
 * DeviceData interface defines the structure of temperature sensor data
 * @property {string} name - Device name/model
 * @property {number} temperature - Temperature in Celsius
 * @property {number} [humidity] - Optional humidity percentage
 * @property {string} lastUpdate - Timestamp of last data update
 * @property {string} [mode] - Optional mode for run status
 * @property {string} [hvacStatus] - Optional HVAC state (HEATING, COOLING, OFF)
 * @property {number} [heatSetpoint] - Optional heat setpoint in Celsius
 * @property {number} [coolSetpoint] - Optional cool setpoint in Celsius
 */
interface DeviceData {
  name: string;
  temperature: number;
  humidity?: number;
  lastUpdate: string;
  mode?: string;
  hvacStatus?: string;
  heatSetpoint?: number;
  coolSetpoint?: number;
}

/**
 * DeviceTableProps interface defines the component's props
 * @property {string} deviceId - Unique identifier for the device
 * @property {number} [refreshInterval] - Optional polling interval in milliseconds (default: 60000)
 * @property {number} [setpointIncrement] - Optional setpoint increment in Celsius
 */
interface DeviceTableProps {
  deviceId: string;
  refreshInterval?: number;
  setpointIncrement?: number;
}

/**
 * TemperatureDial Component
 * Displays a real-time temperature gauge with WebSocket updates and REST fallback
 * Features:
 * - Real-time temperature monitoring via WebSocket
 * - Fallback to REST API polling
 * - Temperature unit toggle (Fahrenheit/Celsius)
 * - Custom device naming
 * - Configurable update interval
 * 
 * Authentication:
 * - Uses NextAuth.js for session management
 * - Automatically handles token refresh through useSession hook
 * - Reconnects WebSocket when token is refreshed
 */
export default function DeviceTable({ deviceId, refreshInterval = 60000, setpointIncrement = 0.5 }: DeviceTableProps) {
  // Entry logging
  console.log('TemperatureDial - Component mounting/rendering:', { deviceId, refreshInterval, setpointIncrement });
  
  // useSession hook automatically handles:
  // - Initial session loading
  // - Token refresh when expired
  // - Session updates
  // - Automatic re-renders when session changes
  const { data: session } = useSession();
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showFahrenheit, setShowFahrenheit] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [customName, setCustomName] = useState('');
  const [currentRefreshInterval, setCurrentRefreshInterval] = useState(refreshInterval);
  
  // Log session state
  useEffect(() => {
    console.log('TemperatureDial - Session state:', {
      deviceId,
      hasSession: !!session,
      hasAccessToken: !!session?.accessToken,
      sessionPreview: session?.accessToken?.substring(0, 20) + '...'
    });
  }, [session, deviceId]);
  
  // Refs for managing state and preventing memory leaks
  const socketRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const lastFetchTimeRef = useRef(0);
  const customNameRef = useRef(customName);

  // Add loading state for setpoint adjustments
  const [adjustingSetpoint, setAdjustingSetpoint] = useState<'heat' | 'cool' | null>(null);

  // Update customNameRef when customName changes
  useEffect(() => {
    customNameRef.current = customName;
  }, [customName]);

  // Load custom name from localStorage on mount
  useEffect(() => {
    const savedName = localStorage.getItem(`device-name-${deviceId}`);
    if (savedName) {
      setCustomName(savedName);
    }
  }, [deviceId]);

  /**
   * Initialize WebSocket connection for real-time updates
   * - Connects to the socket.io server
   * - Subscribes to device-specific updates
   * - Handles reconnection and authentication
   * 
   * Token Refresh Handling:
   * - When NextAuth refreshes the token, useSession will update
   * - This triggers a re-render with the new session
   * - The socket is reinitialized with the new token
   * - All existing connections are properly cleaned up
   */
  const initializeSocket = useRef(() => {
    if (!session?.accessToken || socketRef.current?.connected) return;

    try {
      const socket = io({
        path: '/api/socketio',
        addTrailingSlash: false,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000,
        transports: ['websocket', 'polling'],
        auth: {
          token: session.accessToken
        }
      });

      socket.on('connect', () => {
        console.log('Socket connected');
        socket.emit('subscribe', deviceId);
      });

      socket.on(`device-${deviceId}-update`, (data: any) => {
        if (data?.traits && isMountedRef.current) {
          const setpointTrait = data.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
          const currentMode = data.traits['sdm.devices.traits.ThermostatMode']?.mode;
          
          // Extract setpoints - handle numbers, strings, and undefined/null
          let heatSetpoint: number | undefined = undefined;
          let coolSetpoint: number | undefined = undefined;
          
          // Handle heatCelsius
          if (setpointTrait.heatCelsius !== undefined && setpointTrait.heatCelsius !== null) {
            const rawValue = setpointTrait.heatCelsius;
            // Skip if it's the string "N/A"
            if (typeof rawValue === 'string' && rawValue === 'N/A') {
              heatSetpoint = undefined;
            } else {
              const value = Number(rawValue);
              if (!isNaN(value) && isFinite(value)) {
                heatSetpoint = value;
              }
            }
          }
          
          // Handle coolCelsius
          if (setpointTrait.coolCelsius !== undefined && setpointTrait.coolCelsius !== null) {
            const rawValue = setpointTrait.coolCelsius;
            // Skip if it's the string "N/A"
            if (typeof rawValue === 'string' && rawValue === 'N/A') {
              coolSetpoint = undefined;
            } else {
              const value = Number(rawValue);
              if (!isNaN(value) && isFinite(value)) {
                coolSetpoint = value;
              }
            }
          }

          const deviceInfo: DeviceData = {
            name: customNameRef.current || data.traits['sdm.devices.traits.Info']?.modelName || data.traits['sdm.devices.traits.Info']?.customName || 'Device ' + deviceId,
            temperature: data.traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius ?? 0,
            humidity: data.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent,
            lastUpdate: new Date().toLocaleTimeString(),
            mode: currentMode,
            hvacStatus: data.traits['sdm.devices.traits.ThermostatHvac']?.status,
            heatSetpoint: heatSetpoint,
            coolSetpoint: coolSetpoint
          };
          setDeviceData(deviceInfo);
        }
      });

      socketRef.current = socket;
    } catch (err) {
      console.error('Socket initialization error:', err);
    }
  });

  /**
   * Fetch device data via REST API
   * - Implements exponential backoff for retries
   * - Handles authentication errors
   * - Updates device state with new data
   * 
   * Token Refresh Handling:
   * - Uses current session token for each request
   * - If token is expired, NextAuth will refresh it
   * - 401/403 responses trigger socket reinitialization
   * - New requests use the refreshed token automatically
   */
  const fetchDeviceData = useRef(async () => {
    console.log('TemperatureDial - fetchDeviceData called:', {
      deviceId,
      hasSession: !!session,
      hasAccessToken: !!session?.accessToken,
      isMounted: isMountedRef.current
    });
    
    if (!deviceId) {
      console.error('TemperatureDial - No deviceId provided');
      return;
    }
    
    if (!session?.accessToken) {
      console.warn('TemperatureDial - No access token, skipping fetch');
      return;
    }
    
    if (!isMountedRef.current) {
      console.warn('TemperatureDial - Component not mounted, skipping fetch');
      return;
    }

    try {
      const now = Date.now();
      if (now - lastFetchTimeRef.current < 1000) {
        console.log('TemperatureDial - Skipping fetch, too recent');
        return; // Prevent rapid refetches
      }
      lastFetchTimeRef.current = now;

      console.log('TemperatureDial - Fetching device data from:', `/api/devices/${deviceId}`);
      const response = await fetch(`/api/devices/${deviceId}`, {
        headers: {
          'Authorization': `Bearer ${session.accessToken}`
        }
      });
      
      console.log('TemperatureDial - API response status:', response.status, response.statusText);

      if (response.ok) {
        const data = await response.json();
        console.log('TemperatureDial - Raw API response:', JSON.stringify(data, null, 2));
        
        if (data?.traits && isMountedRef.current) {
          const setpointTrait = data.traits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
          const currentMode = data.traits['sdm.devices.traits.ThermostatMode']?.mode;
          const currentTemp = data.traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius ?? 0;
          
          // Extract setpoints - handle numbers, strings, and undefined/null
          let heatSetpoint: number | undefined = undefined;
          let coolSetpoint: number | undefined = undefined;
          
          // Handle heatCelsius
          if (setpointTrait.heatCelsius !== undefined && setpointTrait.heatCelsius !== null) {
            const rawValue = setpointTrait.heatCelsius;
            // Skip if it's the string "N/A"
            if (typeof rawValue === 'string' && rawValue === 'N/A') {
              heatSetpoint = undefined;
            } else {
              const value = Number(rawValue);
              if (!isNaN(value) && isFinite(value)) {
                heatSetpoint = value;
              }
            }
          }
          
          // Handle coolCelsius
          if (setpointTrait.coolCelsius !== undefined && setpointTrait.coolCelsius !== null) {
            const rawValue = setpointTrait.coolCelsius;
            // Skip if it's the string "N/A"
            if (typeof rawValue === 'string' && rawValue === 'N/A') {
              coolSetpoint = undefined;
            } else {
              const value = Number(rawValue);
              if (!isNaN(value) && isFinite(value)) {
                coolSetpoint = value;
              }
            }
          }

          // Debug logging - comprehensive
          console.log('TemperatureDial - Full data extraction:', {
            deviceId,
            mode: currentMode,
            heatSetpoint,
            coolSetpoint,
            heatSetpointType: typeof heatSetpoint,
            coolSetpointType: typeof coolSetpoint,
            setpointTraitExists: !!setpointTrait,
            setpointTraitKeys: Object.keys(setpointTrait),
            heatCelsiusRaw: setpointTrait.heatCelsius,
            heatCelsiusType: typeof setpointTrait.heatCelsius,
            coolCelsiusRaw: setpointTrait.coolCelsius,
            coolCelsiusType: typeof setpointTrait.coolCelsius,
            setpointTraitRaw: setpointTrait,
            currentTemp,
            allTraitsKeys: Object.keys(data.traits || {})
          });

          const deviceInfo: DeviceData = {
            name: customNameRef.current || data.traits['sdm.devices.traits.Info']?.modelName || data.traits['sdm.devices.traits.Info']?.customName || 'Device ' + deviceId,
            temperature: currentTemp,
            humidity: data.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent,
            lastUpdate: new Date().toLocaleTimeString(),
            mode: currentMode,
            hvacStatus: data.traits['sdm.devices.traits.ThermostatHvac']?.status,
            heatSetpoint: heatSetpoint,
            coolSetpoint: coolSetpoint
          };
          setDeviceData(deviceInfo);
          retryCountRef.current = 0;
        }
      } else if (response.status === 401 || response.status === 403) {
        // Handle auth errors by reinitializing socket
        if (socketRef.current?.connected) {
          socketRef.current.disconnect();
        }
        socketRef.current = null;
        initializeSocket.current();
      }
    } catch (error) {
      console.error('Error fetching device data:', error);
      retryCountRef.current++;
      
      // Retry with exponential backoff
      if (retryCountRef.current < 5) {
        setTimeout(() => {
          if (isMountedRef.current) {
            fetchDeviceData.current();
          }
        }, Math.min(1000 * Math.pow(2, retryCountRef.current), 10000));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  });

  /**
   * Component lifecycle management
   * - Initializes socket and data fetching
   * - Sets up polling interval
   * - Handles cleanup on unmount
   * 
   * Token Refresh Handling:
   * - Component re-renders when session changes
   * - New token is automatically used for new connections
   * - Existing connections are properly cleaned up
   */
  useEffect(() => {
    console.log('TemperatureDial - useEffect lifecycle:', {
      deviceId,
      currentRefreshInterval,
      hasAccessToken: !!session?.accessToken,
      isMounted: isMountedRef.current
    });
    
    if (!deviceId) {
      console.error('TemperatureDial - Cannot initialize: no deviceId');
      setIsLoading(false);
      return;
    }
    
    isMountedRef.current = true;
    setIsLoading(true);

    // Initialize socket
    initializeSocket.current();

    // Initial data fetch
    fetchDeviceData.current();

    // Set up polling
    const interval = setInterval(() => {
      if (isMountedRef.current) {
        fetchDeviceData.current();
      }
    }, currentRefreshInterval);

    return () => {
      console.log('TemperatureDial - Cleaning up:', { deviceId });
      isMountedRef.current = false;
      clearInterval(interval);
      if (socketRef.current?.connected) {
        socketRef.current.disconnect();
      }
    };
  }, [deviceId, currentRefreshInterval, session?.accessToken]);

  const handleRetry = () => {
    setIsLoading(true);
    retryCountRef.current = 0;
    fetchDeviceData.current();
  };

  const handleNameSave = () => {
    localStorage.setItem(`device-name-${deviceId}`, customName);
    setIsEditingName(false);
    if (deviceData) {
      setDeviceData({
        ...deviceData,
        name: customName
      });
    }
  };

  /**
   * Utility function to convert Celsius to Fahrenheit
   * @param {number} celsius - Temperature in Celsius
   * @returns {number} Temperature in Fahrenheit
   */
  const celsiusToFahrenheit = (celsius: number) => (celsius * 9/5) + 32;

  /**
   * Get color based on temperature
   * @param {number} temp - Temperature value
   * @param {boolean} isFahrenheit - Whether the temperature is in Fahrenheit
   * @returns {string} Color code for the temperature
   */
  const getTemperatureColor = (temp: number, isFahrenheit: boolean) => {
    const tempF = isFahrenheit ? temp : celsiusToFahrenheit(temp);
    if (tempF < 80) return '#3b82f6';    // Blue for cool
    if (tempF < 90) return '#f59e0b';    // Orange for warm
    return '#ef4444';                    // Red for hot
  };

  // Update setpoint adjustment function
  const adjustSetpoint = async (type: 'heat' | 'cool', value: number) => {
    if (pendingSetpoint) return; // Prevent multiple changes while pending
    
    try {
      setAdjustingSetpoint(type);
      setSetpointStatus(`${type === 'heat' ? 'Heat' : 'Cool'} setpoint updating...`);
      setPendingSetpoint({ type, value, timestamp: Date.now() });
      
      const response = await fetch(`/api/devices/${deviceId}/setTemperature`, {
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
      
      // Don't clear pending state here - wait for the actual update
    } catch (error) {
      console.error('Error updating setpoint:', error);
      setSetpointStatus(`Failed to update ${type} setpoint`);
      setPendingSetpoint(null);
      setTimeout(() => setSetpointStatus(''), 3000);
    } finally {
      setAdjustingSetpoint(null);
    }
  };

  const [pendingSetpoint, setPendingSetpoint] = useState<{
    type: 'heat' | 'cool';
    value: number;
    timestamp: number;
  } | null>(null);
  const [setpointStatus, setSetpointStatus] = useState<string>('');

  useEffect(() => {
    if (!deviceData || !pendingSetpoint) return;

    const currentValue = pendingSetpoint.type === 'heat' 
      ? deviceData.heatSetpoint 
      : deviceData.coolSetpoint;

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

  if (isLoading && !deviceData) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!deviceData) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <div className="text-gray-500">Loading device data...</div>
        <button 
          onClick={handleRetry}
          className="mt-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  /**
   * Gauge Calculation
   * - Converts temperature to appropriate unit
   * - Calculates needle position based on temperature range
   * - Applies calibration offset for accurate needle position
   */
  const temp = deviceData.temperature;
  const tempF = celsiusToFahrenheit(temp);
  const gaugeValue = showFahrenheit ? tempF : temp;
  
  // Calculate gauge ranges based on temperature unit
  const minTemp = showFahrenheit ? 60 : 15.5;  // 60°F = 15.5°C
  const maxTemp = showFahrenheit ? 100 : 37.8; // 100°F = 37.8°C
  const tempRange = maxTemp - minTemp;
  const angleRange = 180; // Total angle of the gauge
  const gaugeRotation = ((gaugeValue - minTemp + 1.0) / tempRange) * angleRange - 90 - 4;

  return (
    <div className="p-4">
      {/* Device Header with Name and Controls */}
      <div className="flex justify-between items-center mb-4">
        {isEditingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="text-lg font-semibold border rounded px-2 py-1"
              placeholder="Enter device name"
            />
            <button
              onClick={handleNameSave}
              className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Save
            </button>
            <button
              onClick={() => setIsEditingName(false)}
              className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-800">{deviceData.name}</h3>
            <button
              onClick={() => setIsEditingName(true)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✏️
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRetry}
            disabled={isLoading}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <label className="text-sm text-gray-600">Update every:</label>
          <select
            value={currentRefreshInterval}
            onChange={(e) => setCurrentRefreshInterval(Number(e.target.value))}
            className="text-sm border rounded px-2 py-1"
          >
            <option value="60000">1m</option>
            <option value="300000">5m</option>
            <option value="600000">10m</option>
          </select>
        </div>
      </div>

      {/* Temperature Gauge SVG */}
      <div className="relative w-96 h-96 mx-auto mb-4">
        <svg viewBox="0 0 200 200" className="w-full h-full">
          {/* Gradient Definitions */}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" /> {/* Blue for cool */}
              <stop offset="50%" stopColor="#f59e0b" /> {/* Orange for warm */}
              <stop offset="100%" stopColor="#ef4444" /> {/* Red for hot */}
            </linearGradient>
          </defs>
          
          {/* Light background circle with HVAC status color */}
          <circle
            cx="100"
            cy="100"
            r="90"
            fill={deviceData.hvacStatus === 'HEATING' ? '#fee2e2' : 
                  deviceData.hvacStatus === 'COOLING' ? '#dbeafe' : 
                  '#f8fafc'}
            stroke={deviceData.hvacStatus === 'HEATING' ? '#fecaca' :
                    deviceData.hvacStatus === 'COOLING' ? '#bfdbfe' :
                    '#93c5fd'}
            strokeWidth="1"
          />
          
          {/* Gradient background arc */}
          <path
            d="M 100 100 L 100 20 A 80 80 0 0 1 180 100 Z"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            opacity="0.3"
          />
          
          {/* Gray background arc */}
          <path
            d="M 100 100 L 100 20 A 80 80 0 0 1 180 100 Z"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="12"
          />
          
          {/* HVAC Status Indicator */}
          {deviceData.hvacStatus && (
            <g>
              {/* Status background */}
              <rect
                x="60"
                y="140"
                width="80"
                height="24"
                rx="12"
                fill={deviceData.hvacStatus === 'HEATING' ? '#fee2e2' :
                      deviceData.hvacStatus === 'COOLING' ? '#dbeafe' :
                      '#f3f4f6'}
                stroke={deviceData.hvacStatus === 'HEATING' ? '#fecaca' :
                        deviceData.hvacStatus === 'COOLING' ? '#bfdbfe' :
                        '#e5e7eb'}
                strokeWidth="1"
              />
              {/* Status text */}
              <text
                x="100"
                y="156"
                textAnchor="middle"
                dominantBaseline="middle"
                className={`text-sm font-medium ${
                  deviceData.hvacStatus === 'HEATING' ? 'fill-red-800' :
                  deviceData.hvacStatus === 'COOLING' ? 'fill-blue-800' :
                  'fill-gray-600'
                }`}
              >
                {deviceData.hvacStatus === 'OFF' ? 'IDLE' : deviceData.hvacStatus}
              </text>
            </g>
          )}
          
          {/* Major tick marks (10-degree increments) */}
          {[...Array(5)].map((_, i) => {
            const angle = (i * 45) - 90;
            const value = showFahrenheit 
              ? 60 + (i * 10)  // 60, 70, 80, 90, 100 for F
              : 15.5 + (i * 5.5); // 15.5, 21, 26.5, 32, 37.5 for C
            return (
              <g key={`major-${i}`} transform={`rotate(${angle}, 100, 100)`}>
                <line
                  x1="100"
                  y1="20"
                  x2="100"
                  y2="38"
                  stroke="#4b5563"
                  strokeWidth="2.5"
                />
                <text
                  x="100"
                  y="45"
                  textAnchor="middle"
                  className="text-[11px] font-medium fill-gray-500"
                >
                  {value.toFixed(showFahrenheit ? 0 : 1)}°
                </text>
              </g>
            );
          })}
          
          {/* Minor tick marks (2-degree increments for F, 1-degree for C) */}
          {[...Array(showFahrenheit ? 20 : 23)].map((_, i) => {
            if (i % 4 === 0) return null; // Skip where major ticks are
            const angle = showFahrenheit 
              ? (i * 9) - 90  // 2-degree increments for F
              : (i * 8.2) - 90; // 1-degree increments for C
            return (
              <g key={`minor-${i}`} transform={`rotate(${angle}, 100, 100)`}>
                <line
                  x1="100"
                  y1="20"
                  x2="100"
                  y2="28"
                  stroke="#9ca3af"
                  strokeWidth="1"
                />
              </g>
            );
          })}
          
          {/* Gauge needle with shadow effect */}
          <g transform={`rotate(${gaugeRotation}, 100, 100)`}>
            {/* Needle shadow */}
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="25"
              stroke="rgba(0,0,0,0.2)"
              strokeWidth="4"
              strokeLinecap="round"
              transform="translate(1,1)"
            />
            {/* Main needle */}
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="25"
              stroke="black"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* Arrow head */}
            <path
              d="M 100 25 L 97 30 L 103 30 Z"
              fill="black"
              stroke="black"
              strokeWidth="1"
            />
          </g>
          
          {/* Center circle */}
          <circle
            cx="100"
            cy="100"
            r="14"
            fill="white"
            stroke="black"
            strokeWidth="2"
          />
          
          {/* Temperature text */}
          <text
            x="100"
            y="125"
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-sm font-bold fill-gray-800"
          >
            {gaugeValue.toFixed(1)}°{showFahrenheit ? 'F' : 'C'}
          </text>
        </svg>
      </div>
      
      {/* Temperature Unit Toggle */}
      <div className="flex justify-center mb-4">
        <button
          onClick={() => setShowFahrenheit(!showFahrenheit)}
          className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Show {showFahrenheit ? 'Celsius' : 'Fahrenheit'}
        </button>
      </div>
      
      {/* Device Information Table */}
      <table className="min-w-full">
        <tbody className="divide-y divide-gray-100">
          <tr>
            <td className="py-1 text-gray-600">Temperature:</td>
            <td className="py-1 font-medium">
              {deviceData.temperature.toFixed(1)}°C / {celsiusToFahrenheit(deviceData.temperature).toFixed(1)}°F
            </td>
          </tr>
          {deviceData.humidity !== undefined && (
            <tr>
              <td className="py-1 text-gray-600">Humidity:</td>
              <td className="py-1 font-medium">{deviceData.humidity.toFixed(1)}%</td>
            </tr>
          )}
          {deviceData.mode && (
            <tr>
              <td className="py-1 text-gray-600">Mode:</td>
              <td className="py-1 font-medium">
                {/* CHANGE: Added HEATCOOL/AUTO mode styling and display formatting */}
                {/* WHY: HEATCOOL mode needs visual distinction and user-friendly 'Heat/Cool' label */}
                <span className={`px-2 py-1 rounded text-sm ${
                  deviceData.mode === 'HEAT' ? 'bg-red-100 text-red-800' :
                  deviceData.mode === 'COOL' ? 'bg-blue-100 text-blue-800' :
                  deviceData.mode === 'HEATCOOL' || deviceData.mode === 'AUTO' ? 'bg-purple-100 text-purple-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {deviceData.mode === 'HEATCOOL' ? 'Heat/Cool' : 
                   deviceData.mode === 'AUTO' ? 'Auto' :
                   deviceData.mode}
                </span>
              </td>
            </tr>
          )}
          {deviceData.hvacStatus && (
            <tr>
              <td className="py-1 text-gray-600">Status:</td>
              <td className="py-1 font-medium">
                <span className={`px-2 py-1 rounded text-sm ${
                  deviceData.hvacStatus === 'HEATING' ? 'bg-red-100 text-red-800' :
                  deviceData.hvacStatus === 'COOLING' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {deviceData.hvacStatus === 'OFF' ? 'IDLE' : deviceData.hvacStatus}
                </span>
              </td>
            </tr>
          )}
          {/* Heat Setpoint Control - Show if mode is HEAT, HEATCOOL, or AUTO, or if heatSetpoint exists */}
          {((deviceData.mode === 'HEAT' || deviceData.mode === 'HEATCOOL' || deviceData.mode === 'AUTO') || 
            (deviceData.heatSetpoint !== undefined && deviceData.heatSetpoint !== null && !isNaN(deviceData.heatSetpoint))) && (
            <tr>
              <td className="py-1 text-gray-600">Heat Setpoint:</td>
              <td className="py-1 font-medium">
                {deviceData.heatSetpoint !== undefined && deviceData.heatSetpoint !== null && !isNaN(deviceData.heatSetpoint) ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustSetpoint('heat', deviceData.heatSetpoint! - (setpointIncrement || 0.5))}
                        disabled={pendingSetpoint !== null}
                        className={`px-2 py-1 rounded transition-colors ${
                          pendingSetpoint?.type === 'heat'
                            ? 'bg-red-200 text-red-900 cursor-not-allowed'
                            : pendingSetpoint
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-red-100 text-red-800 hover:bg-red-200'
                        }`}
                      >
                        {pendingSetpoint?.type === 'heat' ? '...' : '-'}
                      </button>
                      <span className="w-16 text-center">
                        {deviceData.heatSetpoint.toFixed(1)}°C / {celsiusToFahrenheit(deviceData.heatSetpoint).toFixed(1)}°F
                      </span>
                      <button
                        onClick={() => adjustSetpoint('heat', deviceData.heatSetpoint! + (setpointIncrement || 0.5))}
                        disabled={pendingSetpoint !== null}
                        className={`px-2 py-1 rounded transition-colors ${
                          pendingSetpoint?.type === 'heat'
                            ? 'bg-red-200 text-red-900 cursor-not-allowed'
                            : pendingSetpoint
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-red-100 text-red-800 hover:bg-red-200'
                        }`}
                      >
                        {pendingSetpoint?.type === 'heat' ? '...' : '+'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Increment: {(setpointIncrement || 0.5).toFixed(1)}°</span>
                      {setpointStatus && (pendingSetpoint?.type === 'heat' || adjustingSetpoint === 'heat') && (
                        <span className="italic">{setpointStatus}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustSetpoint('heat', Math.round(deviceData.temperature))}
                        disabled={pendingSetpoint !== null}
                        className="px-2 py-1 rounded bg-red-100 text-red-800 hover:bg-red-200 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        Set
                      </button>
                      <span className="text-sm text-gray-500 italic">
                        Not set (Current: {deviceData.temperature.toFixed(1)}°C / {celsiusToFahrenheit(deviceData.temperature).toFixed(1)}°F)
                      </span>
                    </div>
                    {setpointStatus && (pendingSetpoint?.type === 'heat' || adjustingSetpoint === 'heat') && (
                      <span className="text-sm italic text-gray-600">{setpointStatus}</span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          )}
          {/* Cool Setpoint Control - Show if mode is COOL, HEATCOOL, or AUTO, or if coolSetpoint exists */}
          {((deviceData.mode === 'COOL' || deviceData.mode === 'HEATCOOL' || deviceData.mode === 'AUTO') || 
            (deviceData.coolSetpoint !== undefined && deviceData.coolSetpoint !== null && !isNaN(deviceData.coolSetpoint))) && (
            <tr>
              <td className="py-1 text-gray-600">Cool Setpoint:</td>
              <td className="py-1 font-medium">
                {deviceData.coolSetpoint !== undefined && deviceData.coolSetpoint !== null && !isNaN(deviceData.coolSetpoint) ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustSetpoint('cool', deviceData.coolSetpoint! - (setpointIncrement || 0.5))}
                        disabled={pendingSetpoint !== null}
                        className={`px-2 py-1 rounded transition-colors ${
                          pendingSetpoint?.type === 'cool'
                            ? 'bg-blue-200 text-blue-900 cursor-not-allowed'
                            : pendingSetpoint
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                        }`}
                      >
                        {pendingSetpoint?.type === 'cool' ? '...' : '-'}
                      </button>
                      <span className="w-16 text-center">
                        {deviceData.coolSetpoint.toFixed(1)}°C / {celsiusToFahrenheit(deviceData.coolSetpoint).toFixed(1)}°F
                      </span>
                      <button
                        onClick={() => adjustSetpoint('cool', deviceData.coolSetpoint! + (setpointIncrement || 0.5))}
                        disabled={pendingSetpoint !== null}
                        className={`px-2 py-1 rounded transition-colors ${
                          pendingSetpoint?.type === 'cool'
                            ? 'bg-blue-200 text-blue-900 cursor-not-allowed'
                            : pendingSetpoint
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                        }`}
                      >
                        {pendingSetpoint?.type === 'cool' ? '...' : '+'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Increment: {(setpointIncrement || 0.5).toFixed(1)}°</span>
                      {setpointStatus && (pendingSetpoint?.type === 'cool' || adjustingSetpoint === 'cool') && (
                        <span className="italic">{setpointStatus}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustSetpoint('cool', Math.round(deviceData.temperature))}
                        disabled={pendingSetpoint !== null}
                        className="px-2 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        Set
                      </button>
                      <span className="text-sm text-gray-500 italic">
                        Not set (Current: {deviceData.temperature.toFixed(1)}°C / {celsiusToFahrenheit(deviceData.temperature).toFixed(1)}°F)
                      </span>
                    </div>
                    {setpointStatus && (pendingSetpoint?.type === 'cool' || adjustingSetpoint === 'cool') && (
                      <span className="text-sm italic text-gray-600">{setpointStatus}</span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          )}
          <tr>
            <td className="py-1 text-gray-600">Last Update:</td>
            <td className="py-1 font-medium">{deviceData.lastUpdate}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
} 