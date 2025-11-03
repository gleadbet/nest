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

      // Check rate limit before proceeding
      checkRateLimit('temperature');

      // RACE CONDITION FIX: Check debounce to prevent rapid successive changes
      checkTemperatureDebounce(req.params.deviceId);

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

      // OPTIMIZATION: Get current device state to check ECO mode and prevent conflicts
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
        hasEcoTrait: !!updatedTraits['sdm.devices.traits.ThermostatEco']
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