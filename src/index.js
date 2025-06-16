require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { backOff } = require('exponential-backoff');
const path = require('path');
const https = require('https');

// Add caching variables
let deviceListCache = null;
let lastDeviceListFetch = 0;
const CACHE_DURATION = 30000; // 30 seconds cache

// Configure axios with custom HTTPS agent
const httpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
  timeout: 30000,
  maxSockets: 10
});

// Configure axios defaults
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000;

// Debug logging for environment variables
console.log('Environment variables loaded:');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? 'Set' : 'Not set');
console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set');
console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set');
console.log('REDIRECT_URI:', process.env.REDIRECT_URI ? 'Set' : 'Not set');
console.log('GOOGLE_PROJECT_ID:', process.env.GOOGLE_PROJECT_ID ? 'Set' : 'Not set');

// Add error handling for environment variables
const requiredEnvVars = [
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'REDIRECT_URI',
  'GOOGLE_PROJECT_ID'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

// Configure session first
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
    path: '/'
  }
});

// Then configure CORS
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Accept'],
  exposedHeaders: ['Set-Cookie']
}));

// Then use session middleware
app.use(sessionMiddleware);

// Add session debugging middleware
app.use((req, res, next) => {
  console.log('Session Debug:', {
    hasSession: !!req.session,
    hasTokens: !!req.session?.tokens,
    hasAccessToken: !!req.session?.accessToken,
    path: req.path,
    method: req.method,
    sessionID: req.session?.id,
    cookie: req.headers.cookie
  });
  next();
});

// Then parse JSON
app.use(express.json());

try {
  // Google OAuth2 configuration
  console.log('Initializing OAuth2 client...');
  console.log('Environment variables:', {
    clientId: process.env.GOOGLE_CLIENT_ID ? 'present' : 'missing',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'present' : 'missing',
    redirectUri: process.env.REDIRECT_URI
  });

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    process.env.REDIRECT_URI?.trim()
  );

  // Configure OAuth2 client with custom transport
  oauth2Client.transporter = {
    request: async (opts) => {
      try {
        console.log('Making OAuth request:', {
          url: opts.url,
          method: opts.method,
          data: opts.data
        });

        const response = await axios({
          ...opts,
          httpsAgent,
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 300
        });

        console.log('OAuth response:', response.data);
        return response.data;
      } catch (error) {
        console.error('OAuth2 request error:', {
          url: opts.url,
          method: opts.method,
          error: error.message,
          response: error.response?.data
        });
        throw error;
      }
    }
  };

  // Basic scopes for device access
  const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/sdm.service'
  ];

  // Add a test endpoint
  app.get('/api/test', (req, res) => {
    console.log('=== TEST ENDPOINT HIT ===');
    res.setHeader('Content-Type', 'application/json');
    res.json({ message: 'Test endpoint working' });
  });

  // API routes - MUST come before static file serving
  app.get('/api/auth/status', (req, res) => {
    console.log('Auth status endpoint hit');
    console.log('Session state:', {
      hasSession: !!req.session,
      hasTokens: !!req.session?.tokens,
      hasAccessToken: !!req.session?.accessToken,
      sessionID: req.session?.id,
      cookie: req.headers.cookie
    });
    
    const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
    
    if (!accessToken) {
      console.log('No access token found in session');
      res.setHeader('Content-Type', 'application/json');
      return res.status(401).json({ 
        error: 'Not authenticated',
        authenticated: false
      });
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.json({ 
      authenticated: true,
      hasAccessToken: true
    });
  });

  // Add token refresh function
  async function refreshAccessToken(session) {
    try {
      if (!session?.tokens?.refresh_token) {
        throw new Error('No refresh token available');
      }

      oauth2Client.setCredentials({
        refresh_token: session.tokens.refresh_token
      });

      const { credentials } = await oauth2Client.refreshAccessToken();
      return credentials.access_token;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      throw error;
    }
  }

  // Add rate limiting variables
  const RATE_LIMIT_WINDOW = 60000; // 1 minute
  const MAX_REQUESTS_PER_WINDOW = 60; // 60 requests per minute
  let requestCount = 0;
  let windowStart = Date.now();

  async function fetchDeviceList(accessToken, forceRefresh = false, session = null) {
    const now = Date.now();
    
    // Reset rate limit window if needed
    if (now - windowStart > RATE_LIMIT_WINDOW) {
      requestCount = 0;
      windowStart = now;
    }

    // Check rate limit
    if (requestCount >= MAX_REQUESTS_PER_WINDOW) {
      console.log('Rate limit reached, using cached data');
      if (deviceListCache) {
        return deviceListCache;
      }
      throw new Error('Rate limit reached and no cached data available');
    }

    // Return cached list if it's fresh enough
    if (!forceRefresh && deviceListCache && (now - lastDeviceListFetch) < CACHE_DURATION) {
      console.log('Returning cached device list');
      return deviceListCache;
    }

    try {
      console.log('Fetching fresh device list...');
      requestCount++;
      
      const response = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      console.log('Raw API response:', response.data);

      if (!response.data?.devices) {
        console.log('No devices in response');
        return [];
      }

      // Update cache
      deviceListCache = response.data.devices;
      lastDeviceListFetch = now;
      
      return response.data.devices;
    } catch (error) {
      console.error('Error fetching device list:', error);
      
      // Handle token expiration
      if (error.response?.status === 401 && session) {
        console.log('Token expired, attempting to refresh...');
        try {
          const newToken = await refreshAccessToken(session);
          if (session) {
            session.tokens.access_token = newToken;
            session.accessToken = newToken;
            await new Promise((resolve, reject) => {
              session.save((err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
          
          // Retry the request with new token
          return fetchDeviceList(newToken, forceRefresh, session);
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError);
          throw new Error('Authentication failed. Please login again.');
        }
      }
      
      // If we have cached data and the error is rate limiting, return cached data
      if ((error.response?.status === 429 || error.response?.status === 403) && deviceListCache) {
        console.log('Rate limited, returning cached data');
        return deviceListCache;
      }
      
      throw error;
    }
  }

  app.get('/api/devices', async (req, res) => {
    try {
      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      
      if (!accessToken) {
        console.log('No access token found');
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      console.log('Fetching devices with token:', accessToken.substring(0, 10) + '...');
      const devices = await fetchDeviceList(accessToken, false, req.session);
      console.log('Raw devices from API:', devices);

      const thermostats = devices
        .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
        .map(device => {
          const deviceId = device.name.split('/').pop();
          const traits = device.traits || {};
          const thermostatModeTrait = traits['sdm.devices.traits.ThermostatMode'] || {};
          const ecoTrait = traits['sdm.devices.traits.ThermostatEco'] || {};
          const hvacTrait = traits['sdm.devices.traits.ThermostatHvac'] || {};
          
          console.log('Processing device:', {
            id: deviceId,
            name: device.name,
            traits: traits
          });

          // Check if device is in ECO mode
          const isEcoMode = ecoTrait.mode === 'MANUAL_ECO';
          
          // Get the base mode (HEAT/COOL/OFF) and ECO state
          const baseMode = thermostatModeTrait.mode || 'OFF';
          const mode = isEcoMode ? `ECO (${baseMode})` : baseMode;

          // Get target temperature based on mode
          let targetTemp = 'N/A';
          if (isEcoMode) {
            const heatTemp = typeof ecoTrait.heatCelsius === 'number' ? Number(ecoTrait.heatCelsius.toFixed(1)) : 'N/A';
            const coolTemp = typeof ecoTrait.coolCelsius === 'number' ? Number(ecoTrait.coolCelsius.toFixed(1)) : 'N/A';
            targetTemp = `ECO (${heatTemp}°C - ${coolTemp}°C)`;
          } else if (baseMode === 'COOL') {
            const temp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;
            targetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
          } else if (baseMode === 'HEAT') {
            const temp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
            targetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
          }

          // Determine device status
          let status = 'UNKNOWN';
          if (hvacTrait.status) {
            status = hvacTrait.status;
          } else if (isEcoMode) {
            status = 'IDLE';  // Default to IDLE when in ECO mode
          }

          const processedDevice = {
            id: deviceId,
            name: req.session.customNames?.[deviceId] || device.name.split('/').pop(),
            currentTemp: typeof traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius === 'number' 
              ? Number(traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius.toFixed(1))
              : 'N/A',
            targetTemp: targetTemp,
            mode: mode,
            status: status,
            humidity: typeof traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent === 'number'
              ? Number(traits['sdm.devices.traits.Humidity'].ambientHumidityPercent.toFixed(1))
              : 'N/A',
            availableModes: thermostatModeTrait.availableModes || ['HEAT', 'COOL', 'HEATCOOL', 'OFF'],
            hasEcoTrait: !!traits['sdm.devices.traits.ThermostatEco']
          };

          console.log('Processed device:', processedDevice);
          return processedDevice;
        });

      console.log('Sending response with thermostats:', thermostats);
      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
    } catch (error) {
      console.error('Error in /api/devices:', error);
      if (error.response?.status === 429) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(429).json({ 
          error: 'Rate limited by Nest API',
          details: 'Please try again in a few minutes'
        });
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.status(error.response?.status || 500).json({ 
        error: 'Failed to fetch devices',
        details: error.message
      });
    }
  });

  // Store custom device names in the session only
  app.post('/api/devices/:deviceId/name', async (req, res) => {
    try {
      console.log('=== Device Name Update Start ===');
      console.log('Session before update:', {
        hasCustomNames: !!req.session.customNames,
        customNames: req.session.customNames
      });

      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      if (!accessToken) {
        console.log('No access token found');
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      const { deviceId } = req.params;
      const { name } = req.body;
      
      console.log('Update request:', {
        deviceId,
        newName: name,
        hasAccessToken: !!accessToken
      });

      if (!name) {
        console.log('No name provided in request');
        return res.status(400).json({ error: 'Name is required' });
      }

      // Initialize customNames if needed
      if (!req.session.customNames) {
        console.log('Initializing customNames in session');
        req.session.customNames = {};
      }

      // Store the custom name
      req.session.customNames[deviceId] = name;
      console.log('Updated session customNames:', req.session.customNames);

      // Save session explicitly
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
          return res.status(500).json({ error: 'Failed to save session' });
        }
        console.log('Session saved successfully');
      });

      // Fetch updated device list with force refresh
      const devices = await fetchDeviceList(accessToken, true, req.session);

      const thermostats = devices
        .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
        .map(device => {
          const deviceId = device.name.split('/').pop();
          return {
            name: device.name,
            type: device.type,
            traits: device.traits || {},
            parentRelations: device.parentRelations || [],
            customName: req.session.customNames?.[deviceId] || device.name.split('/').pop()
          };
        });

      console.log('Sending response with thermostats:', {
        count: thermostats.length,
        customNames: thermostats.map(t => t.customName)
      });

      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
    } catch (error) {
      console.error('Error in device name update:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status
      });
      
      res.setHeader('Content-Type', 'application/json');
      res.status(error.response?.status || 500).json({ 
        error: 'Failed to update device name',
        details: error.message,
        response: error.response?.data
      });
    }
  });

  // Add endpoint for updating temperature
  app.post('/api/devices/:deviceId/temperature', async (req, res) => {
    try {
      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      
      if (!accessToken) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      const { deviceId } = req.params;
      const { temperature } = req.body;

      if (temperature === undefined || temperature === null) {
        return res.status(400).json({ error: 'Temperature is required' });
      }

      // Convert temperature to number and validate
      const tempValue = parseFloat(temperature);
      if (isNaN(tempValue)) {
        return res.status(400).json({ error: 'Invalid temperature value' });
      }

      // Validate temperature range (Nest thermostats typically support 9-32°C)
      if (tempValue < 9 || tempValue > 32) {
        return res.status(400).json({ 
          error: 'Temperature out of range',
          details: 'Temperature must be between 9°C and 32°C (48°F and 90°F)'
        });
      }

      console.log('Updating temperature:', {
        deviceId,
        temperature: tempValue,
        useFahrenheit: req.body.useFahrenheit
      });

      // First get the current device state to determine the mode
      const deviceResponse = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const device = deviceResponse.data;
      const traits = device.traits || {};
      const thermostatModeTrait = traits['sdm.devices.traits.ThermostatMode'] || {};
      const ecoTrait = traits['sdm.devices.traits.ThermostatEco'] || {};
      const baseMode = thermostatModeTrait.mode || 'HEAT';
      const isEcoMode = ecoTrait.mode === 'MANUAL_ECO';

      // If in ECO mode, we need to disable it first
      if (isEcoMode) {
        console.log('Device is in ECO mode, disabling before setting temperature');
        await axios.post(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`,
          {
            command: 'sdm.devices.commands.ThermostatEco.SetMode',
            params: { mode: 'OFF' }
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Wait for ECO mode to be disabled
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Determine which command to use based on mode
      let command, params;
      if (baseMode === 'COOL') {
        command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';
        params = { coolCelsius: tempValue };
      } else if (baseMode === 'HEAT') {
        command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat';
        params = { heatCelsius: tempValue };
      } else {
        return res.status(400).json({ 
          error: 'Unsupported thermostat mode',
          details: `Cannot set temperature in ${baseMode} mode`
        });
      }

      // Function to verify the temperature update
      const verifyTemperatureUpdate = async () => {
        // Wait longer for the initial change to be processed
        // This is crucial because the Nest API sometimes takes a few seconds
        // to fully process and reflect temperature changes
        await new Promise(resolve => setTimeout(resolve, 2000));

        let isVerified = false;
        let retryCount = 0;
        const maxRetries = 5;  // Allow up to 5 verification attempts
        const retryDelay = 1000;  // Wait 1 second between retries

        // Keep trying to verify the temperature update until successful
        // or we run out of retries. This handles cases where the API
        // takes longer to reflect the new temperature.
        while (!isVerified && retryCount < maxRetries) {
          const verifyResponse = await axios.get(
            `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          );
          
          const currentTraits = verifyResponse.data.traits || {};
          const currentTemp = baseMode === 'COOL' 
            ? currentTraits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius
            : currentTraits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
          
          console.log('Verifying temperature update:', {
            attempt: retryCount + 1,
            currentTemp,
            targetTemp: tempValue,
            difference: Math.abs(currentTemp - tempValue)
          });

          // Consider the update verified if the current temperature
          // is within 0.1 degrees of the target temperature
          // This accounts for any rounding or precision differences
          if (Math.abs(currentTemp - tempValue) < 0.1) {
            isVerified = true;
            console.log('Temperature update verified');
          } else {
            console.log('Temperature update not verified, retrying...');
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryCount++;
          }
        }

        return isVerified;
      };

      // Update the temperature using the Smart Device Management API
      const response = await axios.post(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`,
        {
          command: command,
          params: params
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      console.log('Temperature update response:', response.data);

      // Verify the update was successful
      const isVerified = await verifyTemperatureUpdate();
      if (!isVerified) {
        console.log('Temperature update not verified after all retries');
        // Try one more time with a longer delay
        // This final attempt helps handle edge cases where the API
        // takes longer than expected to process the change
        await new Promise(resolve => setTimeout(resolve, 3000));
        const finalVerification = await verifyTemperatureUpdate();
        if (!finalVerification) {
          console.log('Temperature update still not verified after final attempt');
        }
      }

      // Fetch updated device list
      const devices = await fetchDeviceList(accessToken, true, req.session);

      const thermostats = devices
        .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
        .map(device => {
          const deviceId = device.name.split('/').pop();
          const traits = device.traits || {};
          const thermostatModeTrait = traits['sdm.devices.traits.ThermostatMode'] || {};
          const ecoTrait = traits['sdm.devices.traits.ThermostatEco'] || {};
          const hvacTrait = traits['sdm.devices.traits.ThermostatHvac'] || {};
          
          // Check if device is in ECO mode
          const isEcoMode = ecoTrait.mode === 'MANUAL_ECO';
          
          // Get the base mode (HEAT/COOL/OFF) and ECO state
          const baseMode = thermostatModeTrait.mode || 'OFF';
          const mode = isEcoMode ? `ECO (${baseMode})` : baseMode;
          const availableModes = thermostatModeTrait.availableModes || ['HEAT', 'COOL', 'HEATCOOL', 'OFF'];
          
          // Check if device supports ECO mode
          const hasEcoTrait = !!traits['sdm.devices.traits.ThermostatEco'];
          const ecoMode = hasEcoTrait ? 'ECO' : null;
          
          // Add ECO to available modes if supported
          const allAvailableModes = ecoMode ? [...availableModes, ecoMode] : availableModes;

          // Determine device status
          let status = 'UNKNOWN';
          if (hvacTrait.status) {
            status = hvacTrait.status;
          } else if (isEcoMode) {
            status = 'IDLE';  // Default to IDLE when in ECO mode
          }
          
          console.log('Processing device modes:', {
            deviceId,
            mode,
            baseMode,
            isEcoMode,
            ecoTraitMode: ecoTrait.mode,
            thermostatMode: thermostatModeTrait.mode,
            hvacStatus: hvacTrait.status,
            status,
            availableModes,
            hasEcoTrait,
            ecoMode,
            allAvailableModes,
            thermostatModeTrait,
            ecoTrait,
            allTraits: Object.keys(traits)
          });

          // Get target temperature based on mode
          let targetTemp = 'N/A';
          if (isEcoMode) {
            const heatTemp = typeof ecoTrait.heatCelsius === 'number' ? Number(ecoTrait.heatCelsius.toFixed(1)) : 'N/A';
            const coolTemp = typeof ecoTrait.coolCelsius === 'number' ? Number(ecoTrait.coolCelsius.toFixed(1)) : 'N/A';
            targetTemp = `ECO (${heatTemp}°C - ${coolTemp}°C)`;
          } else if (baseMode === 'COOL') {
            const temp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;
            targetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
          } else if (baseMode === 'HEAT') {
            const temp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
            targetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
          }

          // Get the device name, handling both custom names and default names
          let deviceName = req.session.customNames?.[deviceId];
          if (!deviceName) {
            // Try to get name from Info trait first
            deviceName = traits['sdm.devices.traits.Info']?.customName;
            // If no custom name in Info trait, use the last part of the device name
            if (!deviceName) {
              deviceName = device.name.split('/').pop();
            }
          }

          const processedDevice = {
            id: deviceId,
            name: deviceName,
            currentTemp: typeof traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius === 'number' 
              ? Number(traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius.toFixed(1))
              : 'N/A',
            targetTemp: targetTemp,
            mode: mode,
            status: status,
            humidity: typeof traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent === 'number'
              ? Number(traits['sdm.devices.traits.Humidity'].ambientHumidityPercent.toFixed(1))
              : 'N/A',
            availableModes: allAvailableModes,
            hasEcoTrait: hasEcoTrait
          };

          console.log('Processed device:', processedDevice);
          return processedDevice;
        });

      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
    } catch (error) {
      console.error('Error updating temperature:', error);
      res.status(error.response?.status || 500).json({ 
        error: 'Failed to update temperature',
        details: error.message,
        response: error.response?.data
      });
    }
  });

  // Add endpoint for changing thermostat mode
  app.post('/api/devices/:deviceId/mode', async (req, res) => {
    try {
      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      
      if (!accessToken) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      const { deviceId } = req.params;
      const { mode } = req.body;

      console.log('Mode update request:', {
        deviceId,
        requestedMode: mode,
        body: req.body
      });

      if (!mode) {
        return res.status(400).json({ error: 'Mode is required' });
      }

      // First get the current device state to check available modes
      const deviceResponse = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const device = deviceResponse.data;
      const traits = device.traits || {};
      const thermostatModeTrait = traits['sdm.devices.traits.ThermostatMode'] || {};
      const availableModes = thermostatModeTrait.availableModes || ['HEAT', 'COOL', 'HEATCOOL', 'OFF'];
      const hasEcoTrait = !!traits['sdm.devices.traits.ThermostatEco'];
      const allAvailableModes = hasEcoTrait ? [...availableModes, 'ECO'] : availableModes;

      console.log('Device mode info:', {
        deviceId,
        currentMode: thermostatModeTrait.mode,
        availableModes,
        hasEcoTrait,
        allAvailableModes,
        requestedMode: mode,
        thermostatModeTrait
      });

      // Validate mode against available modes
      if (!allAvailableModes.includes(mode)) {
        console.log('Invalid mode requested:', {
          mode,
          availableModes: allAvailableModes
        });
        return res.status(400).json({ 
          error: 'Invalid mode',
          details: `Mode must be one of: ${allAvailableModes.join(', ')}`
        });
      }

      let response;
      
      // Handle ECO mode differently
      if (mode === 'ECO') {
        // Check if device supports ECO mode
        if (!hasEcoTrait) {
          return res.status(400).json({ 
            error: 'Device does not support ECO mode',
            details: 'This thermostat does not have ECO mode capability'
          });
        }

        // Enable ECO mode directly
        response = await axios.post(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`,
          {
            command: 'sdm.devices.commands.ThermostatEco.SetMode',
            params: { mode: 'MANUAL_ECO' }
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('ECO mode enabled:', response.data);
      } else {
        // For other modes, first disable ECO mode if it's active
        const currentEcoMode = traits['sdm.devices.traits.ThermostatEco']?.mode;
        if (currentEcoMode === 'MANUAL_ECO') {
          console.log('Disabling ECO mode before changing to:', mode);
          await axios.post(
            `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`,
            {
              command: 'sdm.devices.commands.ThermostatEco.SetMode',
              params: { mode: 'OFF' }
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          // Wait a moment for ECO mode to be disabled
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Then set the requested mode
        response = await axios.post(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`,
          {
            command: 'sdm.devices.commands.ThermostatMode.SetMode',
            params: { mode: mode }
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('Mode changed to:', mode, response.data);
      }

      // Wait for a short delay to allow the update to propagate
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch updated device list
      const devicesResponse = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!devicesResponse.data?.devices) {
        return res.json([]);
      }

      const thermostats = devicesResponse.data.devices
        .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
        .map(device => {
          const deviceId = device.name.split('/').pop();
          const traits = device.traits || {};
          const thermostatModeTrait = traits['sdm.devices.traits.ThermostatMode'] || {};
          const ecoTrait = traits['sdm.devices.traits.ThermostatEco'] || {};
          const hvacTrait = traits['sdm.devices.traits.ThermostatHvac'] || {};
          
          // Check if device is in ECO mode
          const isEcoMode = ecoTrait.mode === 'MANUAL_ECO';
          
          // Get the base mode (HEAT/COOL/OFF) and ECO state
          const baseMode = thermostatModeTrait.mode || 'OFF';
          const mode = isEcoMode ? `ECO (${baseMode})` : baseMode;
          const availableModes = thermostatModeTrait.availableModes || ['HEAT', 'COOL', 'HEATCOOL', 'OFF'];
          
          // Check if device supports ECO mode
          const hasEcoTrait = !!traits['sdm.devices.traits.ThermostatEco'];
          const ecoMode = hasEcoTrait ? 'ECO' : null;
          
          // Add ECO to available modes if supported
          const allAvailableModes = ecoMode ? [...availableModes, ecoMode] : availableModes;

          // Determine device status
          let status = 'UNKNOWN';
          if (hvacTrait.status) {
            status = hvacTrait.status;
          } else if (isEcoMode) {
            status = 'IDLE';  // Default to IDLE when in ECO mode
          }
          
          console.log('Processing device modes:', {
            deviceId,
            mode,
            baseMode,
            isEcoMode,
            ecoTraitMode: ecoTrait.mode,
            thermostatMode: thermostatModeTrait.mode,
            hvacStatus: hvacTrait.status,
            status,
            availableModes,
            hasEcoTrait,
            ecoMode,
            allAvailableModes,
            thermostatModeTrait,
            ecoTrait,
            allTraits: Object.keys(traits)
          });

          // Get target temperature based on mode
          let targetTemp = 'N/A';
          if (isEcoMode) {
            const heatTemp = typeof ecoTrait.heatCelsius === 'number' ? Number(ecoTrait.heatCelsius.toFixed(1)) : 'N/A';
            const coolTemp = typeof ecoTrait.coolCelsius === 'number' ? Number(ecoTrait.coolCelsius.toFixed(1)) : 'N/A';
            targetTemp = `ECO (${heatTemp}°C - ${coolTemp}°C)`;
          } else if (baseMode === 'COOL') {
            const temp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;
            targetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
          } else if (baseMode === 'HEAT') {
            const temp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
            targetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
          }

          // Get the device name, handling both custom names and default names
          let deviceName = req.session.customNames?.[deviceId];
          if (!deviceName) {
            // Try to get name from Info trait first
            deviceName = traits['sdm.devices.traits.Info']?.customName;
            // If no custom name in Info trait, use the last part of the device name
            if (!deviceName) {
              deviceName = device.name.split('/').pop();
            }
          }

          const processedDevice = {
            id: deviceId,
            name: deviceName,
            currentTemp: typeof traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius === 'number' 
              ? Number(traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius.toFixed(1))
              : 'N/A',
            targetTemp: targetTemp,
            mode: isEcoMode ? `ECO (${baseMode})` : baseMode,
            status: isEcoMode ? 'IDLE' : (hvacTrait.status || 'IDLE'),
            humidity: typeof traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent === 'number'
              ? Number(traits['sdm.devices.traits.Humidity'].ambientHumidityPercent.toFixed(1))
              : 'N/A',
            availableModes: allAvailableModes,
            hasEcoTrait: hasEcoTrait
          };

          console.log('Processed device:', processedDevice);
          return processedDevice;
        });

      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
    } catch (error) {
      console.error('Error updating mode:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      res.status(error.response?.status || 500).json({ 
        error: 'Failed to update mode',
        details: error.response?.data?.error?.message || error.message
      });
    }
  });

  // Add debug endpoint to check device traits
  app.get('/api/devices/:deviceId/debug', async (req, res) => {
    try {
      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      
      if (!accessToken) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      const { deviceId } = req.params;
      const fullDevicePath = `enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`;

      // Get device details
      const response = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/${fullDevicePath}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      res.setHeader('Content-Type', 'application/json');
      res.json(response.data);
    } catch (error) {
      console.error('Error getting device debug info:', error);
      res.status(error.response?.status || 500).json({ 
        error: 'Failed to get device debug info',
        details: error.message,
        response: error.response?.data
      });
    }
  });

  // Auth routes
  app.get('/auth/login', (req, res) => {
    console.log('Login route hit');
    console.log('Session state:', {
      hasTokens: !!req.session?.tokens,
      hasAccessToken: !!req.session?.accessToken,
      sessionID: req.session?.id,
      cookie: req.headers.cookie
    });

    // If already authenticated, redirect to home
    const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
    if (accessToken) {
      console.log('Already authenticated, redirecting to home');
      return res.redirect('/');
    }

    const state = Math.random().toString(36).substring(7);
    console.log('Generated state:', state);
    
    // Ensure OAuth2 client is properly configured
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirectUri = process.env.REDIRECT_URI?.trim();

    if (!clientId || !clientSecret || !redirectUri) {
      console.error('OAuth2 configuration missing:', {
        clientId: clientId ? 'present' : 'missing',
        clientSecret: clientSecret ? 'present' : 'missing',
        redirectUri: redirectUri
      });
      return res.status(500).send('OAuth configuration error');
    }

    // Clear existing session data but keep the session
    req.session.tokens = null;
    req.session.accessToken = null;
    req.session.oauthState = state;

    // Save session before redirect
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
        return res.status(500).send('Session error');
      }

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_SCOPES,
        prompt: 'consent',
        include_granted_scopes: true,
        state: state
      });
      
      console.log('Generated auth URL:', authUrl);
      res.redirect(authUrl);
    });
  });

  app.get('/auth/callback', async (req, res) => {
    console.log('Callback route hit');
    console.log('Full request query:', req.query);
    console.log('Full request headers:', req.headers);
    console.log('Session state before:', {
      hasSession: !!req.session,
      hasTokens: !!req.session?.tokens,
      hasAccessToken: !!req.session?.accessToken,
      oauthState: req.session?.oauthState,
      sessionID: req.session?.id
    });
    
    try {
      const { code, error, state } = req.query;
      
      if (error) {
        console.error('OAuth error:', error);
        throw new Error(`OAuth error: ${error}`);
      }
      
      if (!code) {
        console.error('No code in query params:', req.query);
        throw new Error('No authorization code provided');
      }

      // Verify state
      if (state !== req.session?.oauthState) {
        console.error('State mismatch:', {
          received: state,
          expected: req.session?.oauthState
        });
        throw new Error('Invalid state parameter');
      }

      console.log('Getting tokens with code...');
      try {
        const tokenResponse = await oauth2Client.getToken(code);
        console.log('Raw token response:', JSON.stringify(tokenResponse, null, 2));

        if (!tokenResponse || !tokenResponse.res) {
          console.error('Invalid token response:', tokenResponse);
          throw new Error('Failed to get tokens from Google');
        }

        const tokens = tokenResponse.res;
        console.log('Tokens received:', { 
          access_token: tokens.access_token ? 'present' : 'missing',
          refresh_token: tokens.refresh_token ? 'present' : 'missing'
        });
        
        if (!tokens.access_token) {
          console.error('No access token in response:', tokens);
          throw new Error('No access token received from Google');
        }

        // Save tokens to session
        req.session.tokens = tokens;
        req.session.accessToken = tokens.access_token;
        console.log('Session updated with tokens');

        // Save session explicitly
        req.session.save((err) => {
          if (err) {
            console.error('Error saving session:', err);
            return res.redirect('/auth/login');
          }
          console.log('Session saved successfully');
          console.log('Session state after save:', {
            hasSession: !!req.session,
            hasTokens: !!req.session?.tokens,
            hasAccessToken: !!req.session?.accessToken,
            sessionID: req.session?.id
          });
          res.redirect('/');
        });
      } catch (tokenError) {
        console.error('Token exchange error:', {
          message: tokenError.message,
          stack: tokenError.stack,
          response: tokenError.response?.data,
          status: tokenError.response?.status,
          headers: tokenError.response?.headers
        });
        throw tokenError;
      }
    } catch (error) {
      console.error('Auth callback error:', error);
      console.error('Full error details:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers
      });
      res.redirect('/auth/login');
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to logout' });
      }
      res.redirect('/auth/login');
    });
  });

  // Serve static files from the React app
  app.use(express.static(path.join(__dirname, 'client'), {
    index: false, // Don't serve index.html for directory requests
    setHeaders: (res, path) => {
      // Set proper content type for JavaScript files
      if (path.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      } else if (path.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html');
      }
    }
  }));

  // Serve index.html for the root route
  app.get('/', (req, res) => {
    const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
    if (!accessToken) {
      console.log('No access token found, redirecting to login');
      return res.redirect('/auth/login');
    }
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
  });

  // The "catchall" handler: for any request that doesn't
  // match one above, send back React's index.html file.
  app.get('*', (req, res) => {
    // Don't send index.html for API routes
    if (req.path.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
  });

  // Start the server
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

} catch (error) {
  console.error('Fatal error during app initialization:', error);
  process.exit(1);
} 