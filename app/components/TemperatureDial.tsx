import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useSession } from 'next-auth/react';

/**
 * DeviceData interface defines the structure of temperature sensor data
 * @property {string} name - Device name/model
 * @property {number} temperature - Temperature in Celsius
 * @property {number} [humidity] - Optional humidity percentage
 * @property {string} lastUpdate - Timestamp of last data update
 */
interface DeviceData {
  name: string;
  temperature: number;
  humidity?: number;
  lastUpdate: string;
}

/**
 * DeviceTableProps interface defines the component's props
 * @property {string} deviceId - Unique identifier for the device
 * @property {number} [refreshInterval] - Optional polling interval in milliseconds (default: 60000)
 */
interface DeviceTableProps {
  deviceId: string;
  refreshInterval?: number;
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
export default function DeviceTable({ deviceId, refreshInterval = 60000 }: DeviceTableProps) {
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
  
  // Refs for managing state and preventing memory leaks
  const socketRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const lastFetchTimeRef = useRef(0);
  const customNameRef = useRef(customName);

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
          const deviceInfo: DeviceData = {
            name: customNameRef.current || data.traits['sdm.devices.traits.Info']?.modelName || 'Device ' + deviceId,
            temperature: data.traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius ?? 0,
            humidity: data.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent,
            lastUpdate: new Date().toLocaleTimeString()
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
    if (!session?.accessToken || !isMountedRef.current) return;

    try {
      const now = Date.now();
      if (now - lastFetchTimeRef.current < 1000) return; // Prevent rapid refetches
      lastFetchTimeRef.current = now;

      const response = await fetch(`/api/devices/${deviceId}`, {
        headers: {
          'Authorization': `Bearer ${session.accessToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.traits && isMountedRef.current) {
          const deviceInfo: DeviceData = {
            name: customNameRef.current || data.traits['sdm.devices.traits.Info']?.modelName || 'Device ' + deviceId,
            temperature: data.traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius ?? 0,
            humidity: data.traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent,
            lastUpdate: new Date().toLocaleTimeString()
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
          
          {/* Light background circle */}
          <circle
            cx="100"
            cy="100"
            r="90"
            fill="#f8fafc"
            stroke="#93c5fd"
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
          <tr>
            <td className="py-1 text-gray-600">Last Update:</td>
            <td className="py-1 font-medium">{deviceData.lastUpdate}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
} 