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

      // Create a new OAuth2 client instance for the refresh
      const refreshClient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID?.trim(),
        process.env.GOOGLE_CLIENT_SECRET?.trim(),
        process.env.REDIRECT_URI?.trim()
      );

      // Set the refresh token
      refreshClient.setCredentials({
        refresh_token: session.tokens.refresh_token
      });

      // Get new tokens
      const { credentials } = await refreshClient.refreshAccessToken();
      
      // Update session with new tokens
      session.tokens = {
        ...session.tokens,
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date
      };
      session.accessToken = credentials.access_token;

      // Save session
      await new Promise((resolve, reject) => {
        session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log('Successfully refreshed access token');
      return credentials.access_token;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      throw error;
    }
  }

  // Add rate limiting variables
  const RATE_LIMIT_WINDOW = 60000; // 1 minute
  const MAX_REQUESTS_PER_WINDOW = 30; // Reduced to 30 requests per minute to be safer
  const rateLimitCounters = {
    temperature: { count: 0, windowStart: Date.now() },
    mode: { count: 0, windowStart: Date.now() },
    devices: { count: 0, windowStart: Date.now() }
  };

  // Add debouncing for temperature changes to prevent race conditions
  const temperatureChangeDebounce = new Map(); // deviceId -> timeout
  const DEBOUNCE_DELAY = 1000; // 1 second debounce

  // Add rate limit check function
  function checkRateLimit(endpoint) {
    const now = Date.now();
    const counter = rateLimitCounters[endpoint];
    
    // Reset counter if window has passed
    if (now - counter.windowStart > RATE_LIMIT_WINDOW) {
      counter.count = 0;
      counter.windowStart = now;
    }
    
    // Check if we're over the limit
    if (counter.count >= MAX_REQUESTS_PER_WINDOW) {
      const timeToWait = RATE_LIMIT_WINDOW - (now - counter.windowStart);
      throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(timeToWait / 1000)} seconds before trying again.`);
    }
    
    counter.count++;
    return true;
  }

  // Add debounce check function for temperature changes
  function checkTemperatureDebounce(deviceId) {
    if (temperatureChangeDebounce.has(deviceId)) {
      const timeSinceLastChange = Date.now() - temperatureChangeDebounce.get(deviceId);
      if (timeSinceLastChange < DEBOUNCE_DELAY) {
        const timeToWait = DEBOUNCE_DELAY - timeSinceLastChange;
        throw new Error(`Please wait ${Math.ceil(timeToWait / 1000)} seconds before making another temperature change.`);
      }
    }
    temperatureChangeDebounce.set(deviceId, Date.now());
    return true;
  }

  async function fetchDeviceList(accessToken, forceRefresh = false, session = null) {
    const startTime = Date.now();
    console.log('fetchDeviceList started at:', new Date().toISOString());
    
    const now = Date.now();
    
    // Check rate limit for devices endpoint
    try {
      checkRateLimit('devices');
    } catch (error) {
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
      console.log('Fetching fresh device list from Google API...');
      const apiStartTime = Date.now();
      
      const response = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          timeout: 25000 // 25 second timeout for Google API call
        }
      );

      const apiEndTime = Date.now();
      console.log(`Google API response received after ${apiEndTime - apiStartTime}ms`);

      console.log('Raw API response:', response.data);

      if (!response.data?.devices) {
        console.log('No devices in response');
        return [];
      }

      // Update cache
      deviceListCache = response.data.devices;
      lastDeviceListFetch = now;
      
      const totalTime = Date.now() - startTime;
      console.log(`fetchDeviceList completed in ${totalTime}ms`);
      
      return response.data.devices;
    } catch (error) {
      console.error('Error fetching device list:', error);
      
      // Handle DNS resolution errors
      if (error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
        console.error('Network connectivity issue:', error.code, error.message);
        if (deviceListCache) {
          console.log('Returning cached data due to network issue');
          return deviceListCache;
        }
        throw new Error(`Network connectivity issue: ${error.message}. Please check your internet connection.`);
      }
      
      // Handle token expiration
      if (error.response?.status === 401 && session) {
        console.log('Token expired, attempting to refresh...');
        try {
          const newToken = await refreshAccessToken(session);
          
          // Retry the request with new token
          return fetchDeviceList(newToken, forceRefresh, session);
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError);
          // Clear session on refresh failure
          session.tokens = null;
          session.accessToken = null;
          await new Promise((resolve, reject) => {
            session.save((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          throw new Error('Authentication failed. Please login again.');
        }
      }
      
      // If we have cached data and the error is rate limiting or network related, return cached data
      if ((error.response?.status === 429 || error.response?.status === 403 || error.code === 'ETIMEDOUT') && deviceListCache) {
        console.log('Rate limited or timeout, returning cached data');
        return deviceListCache;
      }
      
      throw error;
    }
  }

  // Add token expiration check middleware
  app.use(async (req, res, next) => {
    if (req.session?.tokens?.expiry_date) {
      const expiryDate = new Date(req.session.tokens.expiry_date);
      const now = new Date();
      
      // If token expires in less than 5 minutes, refresh it
      if (expiryDate.getTime() - now.getTime() < 300000) {
        try {
          await refreshAccessToken(req.session);
        } catch (error) {
          console.error('Error refreshing token in middleware:', error);
          // Don't throw error here, let the request continue
          // The specific endpoint will handle auth errors
        }
      }
    }
    next();
  });

  // Function to store thermostat data
  async function storeThermostatData(device) {
    try {
      const thermostatData = {
        deviceId: device.id,
        name: device.name,
        currentTemp: device.currentTemp,
        targetTemp: device.targetTemp,
        mode: device.mode,
        status: device.status,
        humidity: device.humidity,
        timestamp: new Date()
      };

      // Add to history array
      thermostatData.history = [{
        currentTemp: device.currentTemp,
        targetTemp: device.targetTemp,
        mode: device.mode,
        status: device.status,
        humidity: device.humidity,
        timestamp: new Date()
      }];

      // Update or insert the document
      await Thermostat.findOneAndUpdate(
        { deviceId: device.id },
        { 
          $set: thermostatData,
          $push: { 
            history: {
              $each: thermostatData.history,
              $slice: -100 // Keep last 100 history entries
            }
          }
        },
        { upsert: true, new: true }
      );

      console.log('Stored thermostat data for device:', device.id);
    } catch (error) {
      console.error('Error storing thermostat data:', error);
    }
  }

  app.get('/api/devices', async (req, res) => {
    const requestStartTime = Date.now();
    console.log('API /api/devices request started at:', new Date().toISOString());
    
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
      const fetchStartTime = Date.now();
      const devices = await fetchDeviceList(accessToken, false, req.session);
      const fetchEndTime = Date.now();
      console.log(`Device list fetched in ${fetchEndTime - fetchStartTime}ms`);
      
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
          // FIX: Previously HEATCOOL mode was not handled, causing targetTemp to show 'N/A'
          // CHANGE: Added explicit HEATCOOL/AUTO mode handling to extract both heat and cool setpoints
          // WHY: In HEATCOOL mode, Google Nest devices have separate heatCelsius and coolCelsius values
          //      that both need to be displayed (e.g., "20.6°C - 23.9°C")
          let targetTemp = 'N/A';
          const setpointTrait = traits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
          const heatSetpoint = setpointTrait.heatCelsius;
          const coolSetpoint = setpointTrait.coolCelsius;
          
          if (isEcoMode) {
            const heatTemp = typeof ecoTrait.heatCelsius === 'number' ? Number(ecoTrait.heatCelsius.toFixed(1)) : 'N/A';
            const coolTemp = typeof ecoTrait.coolCelsius === 'number' ? Number(ecoTrait.coolCelsius.toFixed(1)) : 'N/A';
            targetTemp = `ECO (${heatTemp}°C - ${coolTemp}°C)`;
          } else if (baseMode === 'HEATCOOL' || baseMode === 'AUTO') {
            // In HEATCOOL mode, show both setpoints formatted as a range
            if (typeof heatSetpoint === 'number' && typeof coolSetpoint === 'number') {
              targetTemp = `${Number(heatSetpoint.toFixed(1))}°C - ${Number(coolSetpoint.toFixed(1))}°C`;
            } else if (typeof heatSetpoint === 'number') {
              targetTemp = Number(heatSetpoint.toFixed(1));
            } else if (typeof coolSetpoint === 'number') {
              targetTemp = Number(coolSetpoint.toFixed(1));
            }
          } else if (baseMode === 'COOL') {
            targetTemp = typeof coolSetpoint === 'number' ? Number(coolSetpoint.toFixed(1)) : 'N/A';
          } else if (baseMode === 'HEAT') {
            targetTemp = typeof heatSetpoint === 'number' ? Number(heatSetpoint.toFixed(1)) : 'N/A';
          }

          // Determine device status from HVAC trait
          // FIX: Previously status was showing 'UNKNOWN' when HVAC was idle
          // CHANGE: Extract status from ThermostatHvac trait and default to 'IDLE' instead of 'UNKNOWN'
          // WHY: The HVAC trait provides accurate real-time status (HEATING, COOLING, OFF)
          //      When status is 'OFF' or missing, it means HVAC is idle (not heating/cooling)
          //      'IDLE' is more user-friendly than 'UNKNOWN' or 'OFF'
          // Log HVAC trait for debugging
          console.log('HVAC trait for device:', {
            deviceId,
            hvacTrait,
            hvacStatus: hvacTrait.status,
            hvacTraitKeys: Object.keys(hvacTrait)
          });
          
          let status = 'UNKNOWN';
          if (hvacTrait.status) {
            // Map 'OFF' status to 'IDLE' for better UX
            status = hvacTrait.status === 'OFF' ? 'IDLE' : hvacTrait.status;
          } else if (isEcoMode) {
            status = 'IDLE';  // Default to IDLE when in ECO mode
          } else {
            // Default to IDLE when HVAC is not active (common when thermostat is maintaining temperature)
            status = 'IDLE';
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
            hasEcoTrait: !!traits['sdm.devices.traits.ThermostatEco'],
            // ADDED: Include raw setpoints for components that need them (e.g., TemperatureDial)
            // WHY: Frontend components need individual heat/cool setpoint values for adjustment controls
            //      The targetTemp string format is for display, but components need numeric values
            heatSetpoint: typeof heatSetpoint === 'number' ? Number(heatSetpoint.toFixed(1)) : undefined,
            coolSetpoint: typeof coolSetpoint === 'number' ? Number(coolSetpoint.toFixed(1)) : undefined
          };

          console.log('Processed device:', processedDevice);

          // TODO: Re-enable when database integration is added
          // Store the processed device data
          // storeThermostatData(processedDevice);

          return processedDevice;
        });

      console.log('Sending response with thermostats:', thermostats);
      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
      
      const totalRequestTime = Date.now() - requestStartTime;
      console.log(`API /api/devices request completed in ${totalRequestTime}ms`);
    } catch (error) {
      console.error('Error in /api/devices:', error);
      
      // Handle network connectivity issues
      if (error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
        console.error('Network connectivity issue in /api/devices:', error.code, error.message);
        res.setHeader('Content-Type', 'application/json');
        return res.status(503).json({ 
          error: 'Network connectivity issue',
          details: 'Unable to reach Google API. Please check your internet connection and try again.',
          code: error.code
        });
      }
      
      // Handle timeout errors
      if (error.code === 'ETIMEDOUT') {
        console.error('Request timeout in /api/devices:', error.message);
        res.setHeader('Content-Type', 'application/json');
        return res.status(504).json({ 
          error: 'Request timeout',
          details: 'The request to Google API timed out. Please try again.',
          code: error.code
        });
      }
      
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
        details: error.message,
        code: error.code
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

  /**
   * Temperature Update Endpoint (Legacy Express endpoint)
   * 
   * Handles temperature setpoint adjustments for Google Nest thermostats.
   * This endpoint is used by the older client interface (src/client/App.js).
   * 
   * Recent Updates (v4.0):
   * - HEATCOOL Mode Support: Uses SetRange command as required by Google Nest API
   *   - Previously attempted to use SetHeat/SetCool individually, which were rejected
   *   - SetRange command sets both heatCelsius and coolCelsius simultaneously
   * - Command Re-evaluation: Verifies device state before executing commands
   *   - Re-fetches device state immediately before command execution
   *   - Re-evaluates which setpoint to update based on verified values
   *   - Prevents "command not allowed" errors due to stale device state
   * - Response Format: Always includes heatSetpoint and coolSetpoint for HEATCOOL mode
   *   - Enables frontend to properly display and control setpoints
   *   - Maintains button state after temperature adjustments
   * 
   * Endpoints:
   *   - POST /api/devices/:deviceId/temperature (legacy)
   *   - POST /api/devices/:deviceId/setTemperature (Next.js compatibility)
   * 
   * Request Body:
   *   - temperature: number (required, 9-32°C)
   *   - type: 'heat' | 'cool' (optional, inferred if not provided)
   * 
   * Response:
   *   - Array with single updated device object
   *   - Includes heatSetpoint and coolSetpoint for HEATCOOL mode
   * 
   * @version 4.0
   * @date 2025-11-03
   */
  app.post(['/api/devices/:deviceId/temperature', '/api/devices/:deviceId/setTemperature'], async (req, res) => {
    try {
      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      
      if (!accessToken) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      // Check rate limit before proceeding
      checkRateLimit('temperature');

      // RACE CONDITION FIX: Check debounce to prevent rapid successive changes
      checkTemperatureDebounce(req.params.deviceId);

      const { deviceId } = req.params;
      const { temperature, type } = req.body; // 'type' parameter from setTemperature endpoint ('heat' or 'cool')

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
        type: req.body.type, // 'heat' or 'cool' for HEATCOOL mode
        useFahrenheit: req.body.useFahrenheit
      });

      // OPTIMIZATION: Get current device state to check ECO mode and prevent conflicts
      // FIX: Need to verify device mode right before executing command
      // CHANGE: Fetch device state and validate mode before executing command
      // WHY: Device mode might change or be different than expected, causing API errors
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
      let baseMode = thermostatModeTrait.mode || 'HEAT'; // Changed to let to allow reassignment after ECO mode change
      const isEcoMode = ecoTrait.mode === 'MANUAL_ECO';
      
      // FIX: Log actual device mode to help diagnose "command not allowed" errors
      // CHANGE: Log device state before attempting command
      // WHY: Google API errors about mode might indicate state mismatch
      console.log('Device state before command:', {
        deviceId,
        baseMode,
        isEcoMode,
        availableModes: thermostatModeTrait.availableModes,
        setpointTrait: traits['sdm.devices.traits.ThermostatTemperatureSetpoint']
      });

      // RACE CONDITION FIX: If in ECO mode, disable it first with minimal delay
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
        
        // OPTIMIZATION: Reduced wait time from 1000ms to 500ms
        // This minimizes the delay while still allowing the command to complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // FIX: After disabling ECO mode, refetch device state to get updated mode
        // CHANGE: Fetch device again after ECO mode change to ensure accurate mode
        // WHY: Mode might have changed and we need current state for command selection
        const refreshedDeviceResponse = await axios.get(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );
        const refreshedDevice = refreshedDeviceResponse.data;
        const refreshedTraits = refreshedDevice.traits || {};
        const refreshedThermostatModeTrait = refreshedTraits['sdm.devices.traits.ThermostatMode'] || {};
        baseMode = refreshedThermostatModeTrait.mode || baseMode;
        console.log('Device mode after ECO disable:', baseMode);
      }

      // Determine which command to use based on mode
      // FIX: Previously HEATCOOL mode was rejected, causing "Cannot set temperature in HEATCOOL mode" error
      // CHANGE: Support HEATCOOL mode by determining which setpoint to update based on current temperature
      // WHY: In HEATCOOL mode, users can adjust either heat or cool setpoints independently
      //      The old endpoint doesn't have a 'type' parameter, so we infer it from temperature comparison
      
      // FIX: setpointType was defined inside HEATCOOL block but used outside, causing "setpointType is not defined" error
      // CHANGE: Define setpointType before mode checks so it's available for all modes
      // WHY: Need setpointType for logging regardless of which mode branch executes
      const setpointType = req.body.type; // 'heat' or 'cool' - may be undefined for legacy API calls
      
      // FIX: MIN_GAP needs to be accessible in verification block
      // CHANGE: Define MIN_GAP at function scope so it's available everywhere
      // WHY: Verification block re-evaluates commands and needs MIN_GAP for validation
      const MIN_GAP = 1.7; // 1.7°C (3°F) minimum gap required by Nest API
      
      // FIX: inferredType scope issue - declare at function scope to prevent ReferenceError
      // CHANGE: Declare inferredType outside HEATCOOL block so it's always accessible
      // WHY: Error handlers or logging code might reference it, causing "inferredType is not defined" errors
      let inferredType = null; // Track inferred type for logging - initialized to null
      
      let command, params;
      if (baseMode === 'COOL') {
        command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';
        params = { coolCelsius: tempValue };
      } else if (baseMode === 'HEAT') {
        command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat';
        params = { heatCelsius: tempValue };
      } else if (baseMode === 'HEATCOOL' || baseMode === 'AUTO') {
        // FIX: Google Nest API requires SetRange command in HEATCOOL mode, not SetHeat/SetCool
        // CHANGE: Always use SetRange command with both setpoints in HEATCOOL mode
        // WHY: Google API does not allow individual SetHeat/SetCool commands in HEATCOOL mode
        //      Must set both heatCelsius and coolCelsius together using SetRange
        const setpointTrait = traits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
        const currentHeat = setpointTrait.heatCelsius;
        const currentCool = setpointTrait.coolCelsius;
        const ambientTemp = traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius;
        
        // FIX: Google Nest API requires minimum gap between heat and cool setpoints in HEATCOOL mode
        // CHANGE: Validate setpoint relationships before making API call
        // WHY: API rejects requests that violate heat < cool constraint
        // Google Nest API typically requires 2-3°F gap (1.1-1.7°C), using 1.7°C to be safe
        // Note: MIN_GAP is now defined at function scope above
        
        // Determine which setpoint to update and calculate new values
        let newHeat = currentHeat;
        let newCool = currentCool;
        // Note: inferredType is declared at function scope above
        
        if (setpointType === 'heat') {
          // Validate heat setpoint
          if (typeof currentCool === 'number' && tempValue >= (currentCool - MIN_GAP)) {
            return res.status(400).json({ 
              error: 'Invalid setpoint',
              details: `Heat setpoint (${tempValue.toFixed(1)}°C) must be at least ${MIN_GAP.toFixed(1)}°C below cool setpoint (${currentCool.toFixed(1)}°C)`
            });
          }
          inferredType = 'heat'; // Set for consistency with logging code
          newHeat = tempValue;
          newCool = typeof currentCool === 'number' ? currentCool : tempValue + MIN_GAP;
        } else if (setpointType === 'cool') {
          // Validate cool setpoint
          if (typeof currentHeat === 'number' && tempValue <= (currentHeat + MIN_GAP)) {
            return res.status(400).json({ 
              error: 'Invalid setpoint',
              details: `Cool setpoint (${tempValue.toFixed(1)}°C) must be at least ${MIN_GAP.toFixed(1)}°C above heat setpoint (${currentHeat.toFixed(1)}°C)`
            });
          }
          inferredType = 'cool'; // Set for consistency with logging code
          newHeat = typeof currentHeat === 'number' ? currentHeat : tempValue - MIN_GAP;
          newCool = tempValue;
        } else {
          // Infer type: if closer to heat setpoint, update heat; otherwise update cool
          // FIX: Old client doesn't send type parameter, so we need to infer it intelligently
          // CHANGE: Improve inference logic and provide better error messages
          // WHY: When type is not provided, we must determine which setpoint to update
          if (typeof currentHeat === 'number' && typeof currentCool === 'number') {
            const heatDistance = Math.abs(tempValue - currentHeat);
            const coolDistance = Math.abs(tempValue - currentCool);
            
            // Determine which setpoint is closer or if we're in the middle
            // If the new temp is below the midpoint, we're likely adjusting heat
            // If above the midpoint, we're likely adjusting cool
            const midpoint = (currentHeat + currentCool) / 2;
            
            // FIX: inferredType was declared here but needs to use the outer scope variable
            // CHANGE: Assign to outer inferredType instead of declaring new one
            // WHY: Need to reference inferredType in logging code outside this block
            if (tempValue < midpoint) {
              inferredType = 'heat';
            } else if (tempValue > midpoint) {
              inferredType = 'cool';
            } else {
              // Exactly at midpoint - use distance
              inferredType = heatDistance < coolDistance ? 'heat' : 'cool';
            }
            
            if (inferredType === 'heat') {
              // Update heat setpoint
              if (tempValue >= (currentCool - MIN_GAP)) {
                return res.status(400).json({ 
                  error: 'Invalid setpoint',
                  details: `Cannot set heat setpoint: must be at least ${MIN_GAP.toFixed(1)}°C below cool setpoint (${currentCool.toFixed(1)}°C). Current heat: ${currentHeat.toFixed(1)}°C, attempting: ${tempValue.toFixed(1)}°C. Maximum allowed: ${(currentCool - MIN_GAP).toFixed(1)}°C`
                });
              }
              newHeat = tempValue;
              newCool = currentCool; // Keep cool setpoint unchanged
            } else {
              // Update cool setpoint
              if (tempValue <= (currentHeat + MIN_GAP)) {
                return res.status(400).json({ 
                  error: 'Invalid setpoint',
                  details: `Cannot set cool setpoint: must be at least ${MIN_GAP.toFixed(1)}°C above heat setpoint (${currentHeat.toFixed(1)}°C). Current cool: ${currentCool.toFixed(1)}°C, attempting: ${tempValue.toFixed(1)}°C. Minimum allowed: ${(currentHeat + MIN_GAP).toFixed(1)}°C`
                });
              }
              newHeat = currentHeat; // Keep heat setpoint unchanged
              newCool = tempValue;
            }
          } else if (typeof currentHeat === 'number') {
            // Only heat setpoint exists
            inferredType = 'heat';
            newHeat = tempValue;
            newCool = tempValue + MIN_GAP; // Set cool to maintain gap
          } else if (typeof currentCool === 'number') {
            // Only cool setpoint exists
            inferredType = 'cool';
            newHeat = tempValue - MIN_GAP; // Set heat to maintain gap
            newCool = tempValue;
          } else {
            // Default to heat if we can't determine
            inferredType = 'heat';
            newHeat = tempValue;
            newCool = tempValue + MIN_GAP; // Set cool to maintain gap
          }
          
          // FIX: Use SetRange command for HEATCOOL mode (required by Google API)
          // CHANGE: Always use SetRange with both setpoints instead of individual SetHeat/SetCool
          // WHY: Google Nest API does not allow SetHeat/SetCool in HEATCOOL mode
          //      Must set both heatCelsius and coolCelsius together using SetRange
          command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange';
          params = { 
            heatCelsius: newHeat,
            coolCelsius: newCool
          };
          
          // Determine which setpoint was updated for logging
          // FIX: Safely reference inferredType to avoid ReferenceError
          // CHANGE: Check if inferredType exists and is truthy before using it
          // WHY: May prevent errors if variable scope is unexpected or if it's still null
          let updatedSetpoint = setpointType;
          try {
            if (!updatedSetpoint && inferredType !== null && inferredType !== undefined) {
              updatedSetpoint = inferredType;
            }
          } catch (e) {
            // inferredType might not be in scope - use fallback
            console.warn('Could not access inferredType for logging:', e.message);
          }
          if (!updatedSetpoint) {
            // Determine from which value changed
            const heatChanged = typeof currentHeat === 'number' && Math.abs(newHeat - currentHeat) > 0.1;
            const coolChanged = typeof currentCool === 'number' && Math.abs(newCool - currentCool) > 0.1;
            updatedSetpoint = heatChanged ? 'heat' : (coolChanged ? 'cool' : 'heat');
          }
          
          console.log('Using SetRange command for HEATCOOL mode:', {
            heatCelsius: newHeat,
            coolCelsius: newCool,
            updatedSetpoint: updatedSetpoint,
            previousHeat: currentHeat,
            previousCool: currentCool
          });
        }
      } else {
        return res.status(400).json({ 
          error: 'Unsupported thermostat mode',
          details: `Cannot set temperature in ${baseMode} mode`
        });
      }

      // Update the temperature using the Smart Device Management API
      // FIX: Verify device mode immediately before executing command
      // CHANGE: Re-fetch device state right before command to ensure we have current mode
      // WHY: Device mode might have changed between initial fetch and command execution
      //      Google API "command not allowed" errors often indicate mode mismatch
      let verifyResponse;
      try {
        verifyResponse = await axios.get(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );
        const verifyDevice = verifyResponse.data;
        const verifyTraits = verifyDevice.traits || {};
        const verifyMode = verifyTraits['sdm.devices.traits.ThermostatMode']?.mode;
        const verifyEcoMode = verifyTraits['sdm.devices.traits.ThermostatEco']?.mode === 'MANUAL_ECO';
        
        const verifySetpoints = verifyTraits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
        console.log('Device mode verification before command:', {
          deviceId,
          command,
          expectedMode: baseMode,
          actualMode: verifyMode,
          actualEcoMode: verifyEcoMode,
          modeMatch: verifyMode === baseMode,
          setpointTrait: verifySetpoints,
          availableModes: verifyTraits['sdm.devices.traits.ThermostatMode']?.availableModes
        });
        
        // FIX: Google API might reject SetHeat/SetCool in HEATCOOL if device state is inconsistent
        // CHANGE: If mode doesn't match or if we detect potential issues, log warning
        // WHY: Google API "command not allowed" errors may indicate device state issues
        if (verifyMode !== baseMode) {
          console.warn('Device mode mismatch detected - updating to actual mode:', {
            expected: baseMode,
            actual: verifyMode,
            command: command
          });
          baseMode = verifyMode;
          
          // If mode changed to something other than HEATCOOL/AUTO, we might need to adjust command
          if (baseMode !== 'HEATCOOL' && baseMode !== 'AUTO' && (command.includes('SetHeat') || command.includes('SetCool'))) {
            console.error('Command mismatch with actual mode:', {
              command,
              actualMode: baseMode,
              message: 'This command may be rejected by Google API'
            });
          }
        } else if ((baseMode === 'HEATCOOL' || baseMode === 'AUTO') && (command.includes('SetHeat') || command.includes('SetCool'))) {
          // FIX: Log additional diagnostics for HEATCOOL mode commands
          // CHANGE: Check if setpoints are valid and mode is truly HEATCOOL
          // WHY: Google API sometimes rejects commands even when mode appears correct
          const hasHeatSetpoint = typeof verifySetpoints.heatCelsius === 'number';
          const hasCoolSetpoint = typeof verifySetpoints.coolCelsius === 'number';
          
          if (!hasHeatSetpoint || !hasCoolSetpoint) {
            console.warn('HEATCOOL mode but missing setpoints:', {
              hasHeatSetpoint,
              hasCoolSetpoint,
              heatValue: verifySetpoints.heatCelsius,
              coolValue: verifySetpoints.coolCelsius,
              command: command
            });
          }
          
          // FIX: For HEATCOOL mode, ensure we're using SetRange command (required by Google API)
          // CHANGE: If command is not SetRange, convert it to SetRange with both setpoints
          // WHY: Google Nest API requires SetRange in HEATCOOL mode, not individual SetHeat/SetCool
          if (command.includes('SetHeat') || command.includes('SetCool')) {
            console.warn('Command should be SetRange for HEATCOOL mode, converting:', {
              originalCommand: command,
              originalParams: params,
              verifyHeat: verifySetpoints.heatCelsius,
              verifyCool: verifySetpoints.coolCelsius
            });
            
            // Convert to SetRange - use params if they exist, otherwise use verified setpoints
            const rangeHeat = params?.heatCelsius || verifySetpoints.heatCelsius || tempValue;
            const rangeCool = params?.coolCelsius || verifySetpoints.coolCelsius || (tempValue + MIN_GAP);
            
            command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange';
            params = {
              heatCelsius: rangeHeat,
              coolCelsius: rangeCool
            };
            
            console.log('✓ Converted command to SetRange for HEATCOOL mode');
          }
          
          // FIX: Use verified setpoints if they differ from initial setpoints and type wasn't provided
          // CHANGE: Re-evaluate command if verification shows different setpoint values
          // WHY: Device state might have changed between initial fetch and command execution
          //      Google API might reject commands based on stale setpoint inference
          // NOTE: This is now less critical since we're using SetRange, but still useful for accuracy
          if (!setpointType && hasHeatSetpoint && hasCoolSetpoint && command.includes('SetRange')) {
            const verifyHeat = verifySetpoints.heatCelsius;
            const verifyCool = verifySetpoints.coolCelsius;
            
            // Get initial setpoints from the command params to compare
            const initialHeatFromParams = params?.heatCelsius;
            const initialCoolFromParams = params?.coolCelsius;
            // For SetRange command, extract setpoints from params
            const initialHeatFromCommand = params?.heatCelsius || verifyHeat;
            const initialCoolFromCommand = params?.coolCelsius || verifyCool;
            
            // Determine which setpoint is being updated (whichever is closer to tempValue)
            const paramsHeatDiff = params?.heatCelsius ? Math.abs(params.heatCelsius - tempValue) : Infinity;
            const paramsCoolDiff = params?.coolCelsius ? Math.abs(params.coolCelsius - tempValue) : Infinity;
            const updatingHeatInParams = paramsHeatDiff < paramsCoolDiff;
            
            console.log('Verified setpoints before command execution:', {
              verifyHeat,
              verifyCool,
              command,
              params,
              willUpdate: updatingHeatInParams ? 'heat' : 'cool'
            });
            
            // FIX: Re-evaluate which setpoint to update based on verified values
            // CHANGE: Use verified setpoints for inference instead of potentially stale initial values
            // WHY: Google API validates against current device state, so we should use verified setpoints for inference
            const heatDiff = Math.abs(verifyHeat - (initialHeatFromCommand || 0));
            const coolDiff = Math.abs(verifyCool - (initialCoolFromCommand || 0));
            
            // Always re-evaluate using verified setpoints to ensure we use the most current state
            // FIX: Use verified setpoints for inference to match what Google API sees
            // CHANGE: Re-calculate inference based on verified setpoints instead of initial values
            // WHY: Even if setpoints haven't changed, using verified values ensures consistency with Google API state
            console.log('Re-evaluating command using verified setpoints:', {
              verifiedHeat: verifyHeat,
              verifiedCool: verifyCool,
              tempValue: tempValue,
              currentCommand: command
            });
            
            // Re-evaluate which setpoint to update based on verified values (always do this to match Google API state)
            const verifiedHeatDistance = Math.abs(tempValue - verifyHeat);
            const verifiedCoolDistance = Math.abs(tempValue - verifyCool);
            const verifiedMidpoint = (verifyHeat + verifyCool) / 2;
            
            let shouldBeHeat = tempValue < verifiedMidpoint || 
                              (tempValue === verifiedMidpoint && verifiedHeatDistance < verifiedCoolDistance);
            
            // For SetRange command, check which setpoint in params is being updated
            const currentParamsHeat = params?.heatCelsius;
            const currentParamsCool = params?.coolCelsius;
            // Determine if we're updating heat or cool based on which is closer to tempValue
            const paramsHeatDistance = currentParamsHeat !== undefined ? Math.abs(currentParamsHeat - tempValue) : Infinity;
            const paramsCoolDistance = currentParamsCool !== undefined ? Math.abs(currentParamsCool - tempValue) : Infinity;
            const currentIsHeat = paramsHeatDistance < paramsCoolDistance;
            
            console.log('Re-evaluation result:', {
              tempValue,
              verifiedHeat,
              verifiedCool,
              verifiedMidpoint,
              verifiedHeatDistance,
              verifiedCoolDistance,
              shouldBeHeat,
              currentIsHeat,
              currentCommand: command,
              willUpdate: shouldBeHeat !== currentIsHeat ? 'YES - command mismatch' : 'NO - command matches'
            });
            
            if (shouldBeHeat !== currentIsHeat) {
              console.warn('Command mismatch detected based on verified setpoints, updating command:', {
                inferredCommand: command,
                shouldBeCommand: shouldBeHeat ? 'SetHeat' : 'SetCool',
                tempValue,
                verifiedHeat,
                verifiedCool,
                verifiedMidpoint
              });
              
              // FIX: Update command/params to match verified setpoints using SetRange
              // CHANGE: Use verified setpoints to determine correct command, but always use SetRange for HEATCOOL
              // WHY: Google API validates against current device state, and requires SetRange in HEATCOOL mode
              if (shouldBeHeat) {
                if (tempValue >= (verifyCool - MIN_GAP)) {
                  console.error('Cannot update heat - would violate gap requirement with verified cool setpoint:', {
                    tempValue,
                    verifyCool,
                    minGap: MIN_GAP,
                    maxAllowedHeat: verifyCool - MIN_GAP
                  });
                } else {
                  // Use SetRange with updated heat and current cool
                  command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange';
                  params = { 
                    heatCelsius: tempValue,
                    coolCelsius: verifyCool
                  };
                  console.log('✓ Updated command to SetRange (updating heat) based on verified setpoints');
                }
              } else {
                if (tempValue <= (verifyHeat + MIN_GAP)) {
                  console.error('Cannot update cool - would violate gap requirement with verified heat setpoint:', {
                    tempValue,
                    verifyHeat,
                    minGap: MIN_GAP,
                    minAllowedCool: verifyHeat + MIN_GAP
                  });
                } else {
                  // Use SetRange with current heat and updated cool
                  command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange';
                  params = { 
                    heatCelsius: verifyHeat,
                    coolCelsius: tempValue
                  };
                  console.log('✓ Updated command to SetRange (updating cool) based on verified setpoints');
                }
              }
            } else {
              console.log('Command matches re-evaluation - using:', command);
            }
          }
        }
      } catch (verifyError) {
        // If verification fails, continue anyway - not critical
        console.warn('Could not verify device mode before command:', verifyError.message);
      }
      
      // FIX: setpointType might be undefined for legacy API calls (HEAT/COOL modes)
      // CHANGE: Only include type in log if it's defined
      // WHY: Avoid logging undefined values, but include it when available for debugging
      console.log('Executing temperature command:', {
        deviceId,
        command,
        params,
        mode: baseMode,
        ...(setpointType ? { type: setpointType } : {})
      });
      
      let response;
      try {
        response = await axios.post(
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
      } catch (error) {
        // Enhanced error logging for Google API errors
        // FIX: Provide more detailed error messages to help diagnose 400 errors
        // CHANGE: Extract and log detailed error information from Google API
        // WHY: 400 errors from Google API often have specific reasons that need to be surfaced
        const errorStatus = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.error?.message || errorData?.message || error.message;
        const errorDetails = errorData?.error?.details || errorData?.details || errorData;
        
        console.error('Google API Error:', {
          status: errorStatus,
          statusText: error.response?.statusText,
          errorData: errorData,
          errorMessage: errorMessage,
          command,
          params,
          deviceId,
          mode: baseMode,
          setpointType: setpointType || 'inferred'
        });
        
        // Return a more user-friendly error message for 400 errors
        // FIX: Need to return response instead of throwing to prevent unhandled error
        // CHANGE: Return proper HTTP response for 400 errors from Google API
        // WHY: Client needs structured error response, not thrown exception
        // FIX: Ensure error details are always strings, not objects
        // CHANGE: Convert errorDetails to string if it's an object
        // WHY: Frontend expects string error messages, not objects (prevents "[object Object]")
        // FIX: Return early to prevent ERR_HTTP_HEADERS_SENT error
        // CHANGE: Use return to stop execution after sending error response
        // WHY: If we don't return here, code continues and tries to send another response
        if (errorStatus === 400) {
          res.setHeader('Content-Type', 'application/json');
          let detailsMessage = errorDetails;
          if (detailsMessage && typeof detailsMessage !== 'string') {
            // If errorDetails is an object, extract the message or stringify it
            if (detailsMessage.message) {
              detailsMessage = detailsMessage.message;
            } else {
              detailsMessage = JSON.stringify(detailsMessage);
            }
          }
          if (!detailsMessage) {
            // Use the Google API error message if we have it
            if (errorMessage && errorMessage !== 'Invalid request to Google API') {
              detailsMessage = errorMessage;
            } else {
              detailsMessage = `The temperature value or setpoint relationship may be invalid. Command: ${command}, Params: ${JSON.stringify(params)}`;
            }
          }
          
          // FIX: Include the actual Google API error message in details
          // CHANGE: Use the Google API error message directly if available
          // WHY: The Google API error message explains why the command failed
          const finalErrorMessage = errorMessage || 'Invalid request to Google API';
          const finalDetails = detailsMessage || finalErrorMessage;
          
          // FIX: If Google API says command not allowed in HEATCOOL mode, provide helpful guidance
          // CHANGE: Check for specific error about command not allowed and suggest using type parameter
          // WHY: When old client doesn't send type, inference might work but Google API rejects anyway
          let enhancedDetails = finalDetails;
          if (errorMessage && errorMessage.includes('command not allowed in current thermostat mode') && 
              (baseMode === 'HEATCOOL' || baseMode === 'AUTO') && !setpointType) {
            enhancedDetails = `${finalDetails}. Note: In HEATCOOL mode, the API requires specifying which setpoint to adjust (heat or cool). Please use a client that supports this feature, or switch to HEAT or COOL mode to adjust temperatures.`;
          }
          
          // FIX: Return error message in a format that frontend can easily extract
          // CHANGE: Put the actual Google API error message in both error and details fields
          // WHY: Frontend expects error.message or error.details, but Google error is nested
          return res.status(400).json({
            error: finalErrorMessage,
            details: enhancedDetails,
            message: finalErrorMessage, // Also include at top level for easier extraction
            googleError: errorData, // Include full error for debugging
            suggestion: (errorMessage && errorMessage.includes('command not allowed') && !setpointType) 
              ? 'Try using a client that supports HEATCOOL mode with explicit heat/cool setpoint controls'
              : undefined
          });
        }
        
        // For other errors, throw to be caught by outer try/catch
        throw error;
      }

      // FIX: Only continue if we have a valid response
      // CHANGE: Check that response exists before using it
      // WHY: If there was an error above, response will be undefined
      if (!response) {
        return; // Response was already sent in error handler
      }

      // OPTIMIZATION: Reduced wait time from 2000ms to 500ms
      // This provides faster response while ensuring the Nest API has processed the change
      await new Promise(resolve => setTimeout(resolve, 500));

      // CACHE INVALIDATION: Clear device list cache to prevent stale data
      // This ensures the next device fetch returns fresh data
      deviceListCache = null;
      lastDeviceListFetch = 0;

      // OPTIMIZATION: Fetch updated device state for the specific device only
      // This is faster than fetching all devices and reduces API calls
      const updatedDeviceResponse = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const updatedDevice = updatedDeviceResponse.data;
      const updatedTraits = updatedDevice.traits || {};
      const updatedThermostatModeTrait = updatedTraits['sdm.devices.traits.ThermostatMode'] || {};
      const updatedEcoTrait = updatedTraits['sdm.devices.traits.ThermostatEco'] || {};
      const updatedHvacTrait = updatedTraits['sdm.devices.traits.ThermostatHvac'] || {};
      
      const isUpdatedEcoMode = updatedEcoTrait.mode === 'MANUAL_ECO';
      const updatedBaseMode = updatedThermostatModeTrait.mode || 'OFF';
      const updatedMode = isUpdatedEcoMode ? `ECO (${updatedBaseMode})` : updatedBaseMode;

      // FIX: Response handling must include HEATCOOL mode and setpoints
      // CHANGE: Extract both heat and cool setpoints for HEATCOOL mode
      // WHY: After SetRange command, need to return both setpoints and formatted targetTemp
      const updatedSetpointTrait = updatedTraits['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
      const updatedHeatSetpoint = updatedSetpointTrait.heatCelsius;
      const updatedCoolSetpoint = updatedSetpointTrait.coolCelsius;
      
      let updatedTargetTemp = 'N/A';
      if (isUpdatedEcoMode) {
        const heatTemp = typeof updatedEcoTrait.heatCelsius === 'number' ? Number(updatedEcoTrait.heatCelsius.toFixed(1)) : 'N/A';
        const coolTemp = typeof updatedEcoTrait.coolCelsius === 'number' ? Number(updatedEcoTrait.coolCelsius.toFixed(1)) : 'N/A';
        updatedTargetTemp = `ECO (${heatTemp}°C - ${coolTemp}°C)`;
      } else if (updatedBaseMode === 'HEATCOOL' || updatedBaseMode === 'AUTO') {
        // Format targetTemp as range for HEATCOOL mode
        if (typeof updatedHeatSetpoint === 'number' && typeof updatedCoolSetpoint === 'number') {
          updatedTargetTemp = `${Number(updatedHeatSetpoint.toFixed(1))}°C - ${Number(updatedCoolSetpoint.toFixed(1))}°C`;
        } else if (typeof updatedHeatSetpoint === 'number') {
          updatedTargetTemp = Number(updatedHeatSetpoint.toFixed(1));
        } else if (typeof updatedCoolSetpoint === 'number') {
          updatedTargetTemp = Number(updatedCoolSetpoint.toFixed(1));
        }
      } else if (updatedBaseMode === 'COOL') {
        const temp = updatedSetpointTrait.coolCelsius;
        updatedTargetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
      } else if (updatedBaseMode === 'HEAT') {
        const temp = updatedSetpointTrait.heatCelsius;
        updatedTargetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
      }

      const processedDevice = {
        id: deviceId,
        name: req.session.customNames?.[deviceId] || updatedDevice.name.split('/').pop(),
        currentTemp: typeof updatedTraits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius === 'number' 
          ? Number(updatedTraits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius.toFixed(1))
          : 'N/A',
        targetTemp: updatedTargetTemp,
        mode: updatedMode,
        status: updatedHvacTrait.status || 'IDLE',
        humidity: typeof updatedTraits['sdm.devices.traits.Humidity']?.ambientHumidityPercent === 'number'
          ? Number(updatedTraits['sdm.devices.traits.Humidity'].ambientHumidityPercent.toFixed(1))
          : 'N/A',
        availableModes: updatedThermostatModeTrait.availableModes || ['HEAT', 'COOL', 'HEATCOOL', 'OFF'],
        hasEcoTrait: !!updatedTraits['sdm.devices.traits.ThermostatEco'],
        // FIX: Include setpoints in response for HEATCOOL mode
        // CHANGE: Always include heatSetpoint and coolSetpoint in response
        // WHY: Frontend needs these values to display and control setpoints
        heatSetpoint: typeof updatedHeatSetpoint === 'number' ? Number(updatedHeatSetpoint.toFixed(1)) : undefined,
        coolSetpoint: typeof updatedCoolSetpoint === 'number' ? Number(updatedCoolSetpoint.toFixed(1)) : undefined
      };

      res.setHeader('Content-Type', 'application/json');
      res.json([processedDevice]);
    } catch (error) {
      console.error('Error updating temperature:', error);
      
      // Handle rate limit error specifically
      if (error.response?.status === 429 || error.message.includes('Rate limit exceeded')) {
        const retryAfter = error.response?.headers?.['retry-after'] || 60;
        return res.status(429).json({ 
          error: 'Rate limit exceeded',
          details: `Please wait ${retryAfter} seconds before trying again`,
          retryAfter: parseInt(retryAfter)
        });
      }
      
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
        // This prevents race conditions where ECO mode conflicts with regular modes
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
          
          // Reduced wait time for ECO mode to be disabled (optimized from 1000ms to 500ms)
          // This reduces the delay while still allowing the command to complete
          await new Promise(resolve => setTimeout(resolve, 500));
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

      // Reduced wait time for the update to propagate (optimized from 1000ms to 500ms)
      // This minimizes the delay while ensuring the Nest API has processed the change
      await new Promise(resolve => setTimeout(resolve, 500));

      // OPTIMIZATION: Fetch updated device state for the specific device only
      // This is faster than fetching all devices and reduces API calls
      const updatedDeviceResponse = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const updatedDevice = updatedDeviceResponse.data;
      const updatedTraits = updatedDevice.traits || {};
      const updatedThermostatModeTrait = updatedTraits['sdm.devices.traits.ThermostatMode'] || {};
      const updatedEcoTrait = updatedTraits['sdm.devices.traits.ThermostatEco'] || {};
      const updatedHvacTrait = updatedTraits['sdm.devices.traits.ThermostatHvac'] || {};
      
      // Check if device is in ECO mode
      const isUpdatedEcoMode = updatedEcoTrait.mode === 'MANUAL_ECO';
      
      // Get the base mode (HEAT/COOL/OFF) and ECO state
      const updatedBaseMode = updatedThermostatModeTrait.mode || 'OFF';
      const updatedMode = isUpdatedEcoMode ? `ECO (${updatedBaseMode})` : updatedBaseMode;
      const updatedAvailableModes = updatedThermostatModeTrait.availableModes || ['HEAT', 'COOL', 'HEATCOOL', 'OFF'];
      
      // Check if device supports ECO mode
      const updatedHasEcoTrait = !!updatedTraits['sdm.devices.traits.ThermostatEco'];
      const updatedEcoMode = updatedHasEcoTrait ? 'ECO' : null;
      
      // Add ECO to available modes if supported
      const updatedAllAvailableModes = updatedEcoMode ? [...updatedAvailableModes, updatedEcoMode] : updatedAvailableModes;

      // Determine device status
      let updatedStatus = 'UNKNOWN';
      if (updatedHvacTrait.status) {
        updatedStatus = updatedHvacTrait.status;
      } else if (isUpdatedEcoMode) {
        updatedStatus = 'IDLE';  // Default to IDLE when in ECO mode
      }

      // Get target temperature based on mode
      let updatedTargetTemp = 'N/A';
      if (isUpdatedEcoMode) {
        const heatTemp = typeof updatedEcoTrait.heatCelsius === 'number' ? Number(updatedEcoTrait.heatCelsius.toFixed(1)) : 'N/A';
        const coolTemp = typeof updatedEcoTrait.coolCelsius === 'number' ? Number(updatedEcoTrait.coolCelsius.toFixed(1)) : 'N/A';
        updatedTargetTemp = `ECO (${heatTemp}°C - ${coolTemp}°C)`;
      } else if (updatedBaseMode === 'COOL') {
        const temp = updatedTraits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;
        updatedTargetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
      } else if (updatedBaseMode === 'HEAT') {
        const temp = updatedTraits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
        updatedTargetTemp = typeof temp === 'number' ? Number(temp.toFixed(1)) : 'N/A';
      }

      // Get the device name, handling both custom names and default names
      let updatedDeviceName = req.session.customNames?.[deviceId];
      if (!updatedDeviceName) {
        // Try to get name from Info trait first
        updatedDeviceName = updatedTraits['sdm.devices.traits.Info']?.customName;
        // If no custom name in Info trait, use the last part of the device name
        if (!updatedDeviceName) {
          updatedDeviceName = updatedDevice.name.split('/').pop();
        }
      }

      const processedUpdatedDevice = {
        id: deviceId,
        name: updatedDeviceName,
        currentTemp: typeof updatedTraits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius === 'number' 
          ? Number(updatedTraits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius.toFixed(1))
          : 'N/A',
        targetTemp: updatedTargetTemp,
        mode: updatedMode,
        status: updatedStatus,
        humidity: typeof updatedTraits['sdm.devices.traits.Humidity']?.ambientHumidityPercent === 'number'
          ? Number(updatedTraits['sdm.devices.traits.Humidity'].ambientHumidityPercent.toFixed(1))
          : 'N/A',
        availableModes: updatedAllAvailableModes,
        hasEcoTrait: updatedHasEcoTrait
      };

      console.log('Processed updated device:', processedUpdatedDevice);

      // CACHE INVALIDATION: Clear device list cache to ensure fresh data on next fetch
      // This prevents stale data from being returned after mode changes
      deviceListCache = null;
      lastDeviceListFetch = 0;

      res.setHeader('Content-Type', 'application/json');
      res.json([processedUpdatedDevice]);
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
          refresh_token: tokens.refresh_token ? 'present' : 'missing',
          expiry_date: tokens.expiry_date ? 'present' : 'missing'
        });
        
        if (!tokens.access_token) {
          console.error('No access token in response:', tokens);
          throw new Error('No access token received from Google');
        }

        // Calculate expiry date if not provided
        if (!tokens.expiry_date && tokens.expires_in) {
          tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
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
            sessionID: req.session?.id,
            expiryDate: req.session?.tokens?.expiry_date
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