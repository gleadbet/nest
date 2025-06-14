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
const CACHE_DURATION = 5000; // 5 seconds

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
  resave: false,
  saveUninitialized: false,
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
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

// Then use session middleware
app.use(sessionMiddleware);

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
    const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
    
    if (!accessToken) {
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

  async function fetchDeviceList(accessToken, forceRefresh = false) {
    const now = Date.now();
    
    // Return cached list if it's fresh enough
    if (!forceRefresh && deviceListCache && (now - lastDeviceListFetch) < CACHE_DURATION) {
      console.log('Returning cached device list');
      return deviceListCache;
    }

    try {
      console.log('Fetching fresh device list...');
      const response = await backOff(
        () => axios.get(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        ),
        {
          numOfAttempts: 3,
          startingDelay: 1000,
          timeMultiple: 2,
          maxDelay: 5000
        }
      );

      if (!response.data?.devices) {
        return [];
      }

      // Update cache
      deviceListCache = response.data.devices;
      lastDeviceListFetch = now;
      
      return response.data.devices;
    } catch (error) {
      console.error('Error fetching device list:', error);
      throw error;
    }
  }

  app.get('/api/devices', async (req, res) => {
    try {
      const accessToken = req.session?.tokens?.access_token || req.session?.accessToken;
      
      if (!accessToken) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Please login first',
          authenticated: false
        });
      }

      const devices = await fetchDeviceList(accessToken);

      const thermostats = devices
        .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
        .map(device => {
          const deviceId = device.name.split('/').pop();
          const traits = device.traits || {};
          
          // Log the device traits for debugging
          console.log('Device traits:', {
            deviceId,
            allTraits: traits,
            targetTemp: traits['sdm.devices.traits.ThermostatTemperatureSetpoint']
          });

          // Get target temperature from the correct trait
          const targetTemp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius || 
                           traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius || 
                           'N/A';

          return {
            id: deviceId,
            name: req.session.customNames?.[deviceId] || device.name.split('/').pop(),
            currentTemp: traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius || 'N/A',
            targetTemp: targetTemp,
            mode: traits['sdm.devices.traits.ThermostatMode']?.mode || 'N/A',
            humidity: traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 'N/A'
          };
        });

      // Log the processed thermostats
      console.log('Processed thermostats:', thermostats);

      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
    } catch (error) {
      if (error.response?.status === 401) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ 
          error: 'Session expired. Please login again.',
          authenticated: false
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
      const devices = await fetchDeviceList(accessToken, true);

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
      const mode = traits['sdm.devices.traits.ThermostatMode']?.mode || 'HEAT';

      // Check if device is in ECO mode
      if (mode === 'ECO') {
        return res.status(400).json({ 
          error: 'Cannot set temperature while in ECO mode',
          details: 'Please change the thermostat mode to HEAT or COOL first'
        });
      }

      // Determine which command to use based on mode
      let command, params;
      if (mode === 'COOL') {
        command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';
        params = { coolCelsius: tempValue };
      } else if (mode === 'HEAT') {
        command = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat';
        params = { heatCelsius: tempValue };
      } else {
        return res.status(400).json({ 
          error: 'Unsupported thermostat mode',
          details: `Cannot set temperature in ${mode} mode`
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
          const mode = traits['sdm.devices.traits.ThermostatMode']?.mode || 'HEAT';
          const availableModes = traits['sdm.devices.traits.ThermostatMode']?.availableModes || ['HEAT', 'COOL', 'ECO', 'OFF'];
          
          // Get target temperature based on mode
          let targetTemp = 'N/A';
          if (mode === 'COOL') {
            targetTemp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;
          } else if (mode === 'HEAT') {
            targetTemp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
          }

          return {
            id: deviceId,
            name: req.session.customNames?.[deviceId] || device.name.split('/').pop(),
            currentTemp: traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius || 'N/A',
            targetTemp: targetTemp || 'N/A',
            mode: mode,
            humidity: traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 'N/A',
            availableModes: availableModes
          };
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

      if (!mode) {
        return res.status(400).json({ error: 'Mode is required' });
      }

      // Update the mode using the Smart Device Management API
      const response = await axios.post(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`,
        {
          command: 'sdm.devices.commands.ThermostatMode.SetMode',
          params: { mode: mode }
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

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
          const mode = traits['sdm.devices.traits.ThermostatMode']?.mode || 'HEAT';
          const availableModes = traits['sdm.devices.traits.ThermostatMode']?.availableModes || ['HEAT', 'COOL', 'ECO', 'OFF'];
          
          // Get target temperature based on mode
          let targetTemp = 'N/A';
          if (mode === 'COOL') {
            targetTemp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;
          } else if (mode === 'HEAT') {
            targetTemp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
          }

          return {
            id: deviceId,
            name: req.session.customNames?.[deviceId] || device.name.split('/').pop(),
            currentTemp: traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius || 'N/A',
            targetTemp: targetTemp || 'N/A',
            mode: mode,
            humidity: traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 'N/A',
            availableModes: availableModes
          };
        });

      res.setHeader('Content-Type', 'application/json');
      res.json(thermostats);
    } catch (error) {
      console.error('Error updating mode:', error);
      res.status(error.response?.status || 500).json({ 
        error: 'Failed to update mode',
        details: error.message,
        response: error.response?.data
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
      hasAccessToken: !!req.session?.accessToken
    });

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

    // Instead of destroying the session, just clear the tokens
    req.session.tokens = null;
    req.session.accessToken = null;
    req.session.oauthState = state;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent',
      include_granted_scopes: true,
      state: state
    });
    
    console.log('Generated auth URL:', authUrl);
    console.log('OAuth2 client config:', {
      clientId: clientId,
      redirectUri: redirectUri,
      scopes: GOOGLE_SCOPES
    });
    
    res.redirect(authUrl);
  });

  app.get('/auth/callback', async (req, res) => {
    console.log('Callback route hit');
    console.log('Full request query:', req.query);
    console.log('Full request headers:', req.headers);
    console.log('Session state:', {
      hasTokens: !!req.session?.tokens,
      hasAccessToken: !!req.session?.accessToken,
      oauthState: req.session?.oauthState
    });
    
    try {
      const { code, error, state } = req.query;
      
      if (error) {
        console.error('OAuth error:', error);
        throw new Error(`OAuth error: ${error}`);
      }
      
      if (!code) {
        console.error('No code in query params:', req.query);
        console.error('Request URL:', req.url);
        console.error('Request method:', req.method);
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

        // Save session before redirect
        req.session.save((err) => {
          if (err) {
            console.error('Error saving session:', err);
            return res.redirect('/auth/login');
          }
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