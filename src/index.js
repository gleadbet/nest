require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { backOff } = require('exponential-backoff');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to false for local testing
}));

// Google OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID.trim(),
  process.env.GOOGLE_CLIENT_SECRET.trim(),
  process.env.REDIRECT_URI.trim()
);

// Basic scopes for device access
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  // Add any other scopes your app needs
];

// Routes
app.get('/auth/login', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    prompt: 'consent', // Force consent screen to always show
    include_granted_scopes: true,
    state: Math.random().toString(36).substring(7)
  });
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    console.error('Auth callback error:', error);
    return res.status(400).send(`
      <h1>Authentication Error</h1>
      <p>Error during authentication: ${error}</p>
      <a href="/auth/login">Try Again</a>
    `);
  }

  try {
    // Add delay before token exchange
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    req.session.tokens = tokens;
    
    res.redirect('/');
  } catch (error) {
    console.error('Token error:', error);
    
    res.status(500).send(`
      <h1>Connection Error</h1>
      <p>Unable to complete authentication. Please try:</p>
      <ul>
        <li>Checking your internet connection</li>
        <li>Disabling any VPN or proxy</li>
        <li>Clearing your browser cache</li>
        <li>Waiting a few minutes before trying again</li>
      </ul>
      <a href="/auth/login">Try Again</a>
    `);
  }
});

// Add a route to check authentication status
app.get('/auth/status', (req, res) => {
  if (req.session.tokens) {
    res.json({ 
      authenticated: true,
      tokenExpiry: req.session.tokens.expiry_date 
    });
  } else {
    res.json({ 
      authenticated: false,
      loginUrl: '/auth/login'
    });
  }
});

// Get all devices
app.get('/api/devices', async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const response = await axios.get(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`,
      {
        headers: {
          Authorization: `Bearer ${req.session.tokens.access_token}`
        }
      }
    );

    // Filter to only return thermostats
    const thermostats = response.data.devices.filter(
      device => device.type === 'sdm.devices.types.THERMOSTAT'
    );

    res.json(thermostats);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Get specific thermostat
app.get('/api/devices/:deviceId', async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const response = await axios.get(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${req.params.deviceId}`,
      {
        headers: {
          Authorization: `Bearer ${req.session.tokens.access_token}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).json({ error: 'Failed to fetch device' });
  }
});

// Set temperature for a specific thermostat
app.post('/api/devices/:deviceId/setTemperature', async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const { temperature } = req.body;
    
    const response = await axios.post(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${req.params.deviceId}:executeCommand`,
      {
        command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat',
        params: {
          heatCelsius: temperature
        }
      },
      {
        headers: {
          Authorization: `Bearer ${req.session.tokens.access_token}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error setting temperature:', error);
    res.status(500).json({ error: 'Failed to set temperature' });
  }
});

// Update the root route to handle errors better
app.get('/', (req, res) => {
  if (!req.session.tokens) {
    res.send(`
      <h1>Nest API Test</h1>
      <p>Please <a href="/auth/login">login</a> to continue</p>
    `);
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Nest Devices</title>
      <style>
        .error { color: red; }
        .success { color: green; }
        button { padding: 10px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>Nest Devices</h1>
      <p class="success">✓ Authenticated successfully!</p>
      <button onclick="fetchDevices()">Get Devices</button>
      <div id="devices"></div>
      <p><a href="/auth/logout">Logout</a></p>

      <script>
        async function fetchDevices() {
          const deviceDiv = document.getElementById('devices');
          try {
            deviceDiv.innerHTML = 'Loading devices...';
            const response = await fetch('/api/devices');
            if (!response.ok) throw new Error('Failed to fetch devices');
            const devices = await response.json();
            deviceDiv.innerHTML = '<pre>' + JSON.stringify(devices, null, 2) + '</pre>';
          } catch (error) {
            deviceDiv.innerHTML = '<p class="error">Error: ' + error.message + '</p>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Add a logout route
app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Test server running on http://localhost:${port}`);
});

async function getGoogleToken() {
  try {
    const result = await backOff(
      () => auth.getAccessToken(), // your original token request
      {
        numOfAttempts: 3,
        startingDelay: 1000,
        timeMultiple: 2,
        maxDelay: 5000
      }
    );
    return result;
  } catch (error) {
    console.error('Failed to fetch token after retries:', error);
    throw error;
  }
} 