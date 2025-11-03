const HoneywellService = require('./honeywellService');

class UnifiedDeviceService {
  constructor() {
    this.honeywellService = new HoneywellService();
    this.deviceCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
    this.lastDiscovery = 0;
    this.discoveryInterval = 300000; // 5 minutes
  }

  // Initialize the service and discover devices
  async initialize() {
    console.log('Initializing Unified Device Service...');
    
    try {
      // Discover Honeywell devices
      const honeywellDevices = await this.honeywellService.discoverDevices();
      
      // Add discovered devices to Honeywell service
      honeywellDevices.forEach(device => {
        this.honeywellService.discoveredDevices.set(device.id, device);
      });
      
      this.lastDiscovery = Date.now();
      console.log(`Unified Device Service initialized. Found ${honeywellDevices.length} Honeywell devices.`);
      
      return {
        honeywell: honeywellDevices.length,
        total: honeywellDevices.length
      };
    } catch (error) {
      console.error('Error initializing Unified Device Service:', error);
      return { honeywell: 0, total: 0 };
    }
  }

  // Get all devices (both Google Nest and Honeywell)
  async getAllDevices(googleAccessToken = null) {
    try {
      const devices = [];
      
      // Get Google Nest devices if access token is provided
      if (googleAccessToken) {
        try {
          const googleDevices = await this.getGoogleDevices(googleAccessToken);
          devices.push(...googleDevices);
        } catch (error) {
          console.error('Error fetching Google devices:', error);
        }
      }
      
      // Get Honeywell devices
      try {
        const honeywellDevices = await this.honeywellService.getAllDevices();
        devices.push(...honeywellDevices);
      } catch (error) {
        console.error('Error fetching Honeywell devices:', error);
      }
      
      return devices;
    } catch (error) {
      console.error('Error getting all devices:', error);
      return [];
    }
  }

  // Get Google Nest devices (existing functionality)
  async getGoogleDevices(accessToken) {
    try {
      const response = await fetch(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Google API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data?.devices) {
        return [];
      }

      return data.devices
        .filter(device => device.type === 'sdm.devices.types.THERMOSTAT')
        .map(device => {
          const deviceId = device.name.split('/').pop();
          const traits = device.traits || {};
          
          // Get target temperature from the correct trait
          const targetTemp = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius || 
                           traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius || 
                           'N/A';

          return {
            id: deviceId,
            name: device.name.split('/').pop(),
            currentTemp: traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius || 'N/A',
            targetTemp: targetTemp,
            mode: traits['sdm.devices.traits.ThermostatMode']?.mode || 'N/A',
            humidity: traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 'N/A',
            status: 'ONLINE',
            type: 'google_nest',
            lastUpdated: new Date().toISOString()
          };
        });
    } catch (error) {
      console.error('Error fetching Google devices:', error);
      throw error;
    }
  }

  // Set temperature on any device type
  async setTemperature(deviceId, temperature, mode = 'HEAT', googleAccessToken = null) {
    try {
      // Determine device type from deviceId
      if (deviceId.startsWith('honeywell_')) {
        return await this.honeywellService.setTemperature(deviceId, temperature, mode);
      } else {
        // Google Nest device
        if (!googleAccessToken) {
          throw new Error('Google access token required for Nest devices');
        }
        return await this.setGoogleTemperature(deviceId, temperature, mode, googleAccessToken);
      }
    } catch (error) {
      console.error(`Error setting temperature for device ${deviceId}:`, error);
      throw error;
    }
  }

  // Set temperature on Google Nest device
  async setGoogleTemperature(deviceId, temperature, mode, accessToken) {
    try {
      const command = mode === 'HEAT' 
        ? 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat'
        : 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool';

      const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command,
          params: {
            [mode === 'HEAT' ? 'heatCelsius' : 'coolCelsius']: temperature
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error setting Google temperature for device ${deviceId}:`, error);
      throw error;
    }
  }

  // Set mode on any device type
  async setMode(deviceId, mode, googleAccessToken = null) {
    try {
      // Determine device type from deviceId
      if (deviceId.startsWith('honeywell_')) {
        return await this.honeywellService.setMode(deviceId, mode);
      } else {
        // Google Nest device
        if (!googleAccessToken) {
          throw new Error('Google access token required for Nest devices');
        }
        return await this.setGoogleMode(deviceId, mode, googleAccessToken);
      }
    } catch (error) {
      console.error(`Error setting mode for device ${deviceId}:`, error);
      throw error;
    }
  }

  // Set mode on Google Nest device
  async setGoogleMode(deviceId, mode, accessToken) {
    try {
      const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}:executeCommand`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: 'sdm.devices.commands.ThermostatMode.SetMode',
          params: { mode: mode }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error setting Google mode for device ${deviceId}:`, error);
      throw error;
    }
  }

  // Get device status by ID
  async getDeviceStatus(deviceId, googleAccessToken = null) {
    try {
      // Determine device type from deviceId
      if (deviceId.startsWith('honeywell_')) {
        return await this.honeywellService.getDeviceStatus(deviceId);
      } else {
        // Google Nest device
        if (!googleAccessToken) {
          throw new Error('Google access token required for Nest devices');
        }
        return await this.getGoogleDeviceStatus(deviceId, googleAccessToken);
      }
    } catch (error) {
      console.error(`Error getting status for device ${deviceId}:`, error);
      throw error;
    }
  }

  // Get Google Nest device status
  async getGoogleDeviceStatus(deviceId, accessToken) {
    try {
      const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_PROJECT_ID}/devices/${deviceId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Google API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const traits = data.traits || {};
      
      return {
        id: deviceId,
        name: data.name.split('/').pop(),
        currentTemp: traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius || 'N/A',
        targetTemp: traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius || 
                   traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius || 'N/A',
        mode: traits['sdm.devices.traits.ThermostatMode']?.mode || 'N/A',
        humidity: traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent || 'N/A',
        status: 'ONLINE',
        type: 'google_nest',
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error getting Google device status for ${deviceId}:`, error);
      throw error;
    }
  }

  // Add a Honeywell device manually
  addHoneywellDevice(ip, name = null) {
    return this.honeywellService.addDevice(ip, name);
  }

  // Remove a device
  removeDevice(deviceId) {
    if (deviceId.startsWith('honeywell_')) {
      return this.honeywellService.removeDevice(deviceId);
    } else {
      // For Google devices, we can't remove them from the service
      // but we could mark them as unavailable
      console.log(`Cannot remove Google device ${deviceId} from service`);
      return false;
    }
  }

  // Run device discovery (for Honeywell devices)
  async runDiscovery() {
    try {
      const now = Date.now();
      if (now - this.lastDiscovery < this.discoveryInterval) {
        console.log('Discovery skipped - too recent');
        return { honeywell: this.honeywellService.discoveredDevices.size };
      }

      console.log('Running device discovery...');
      const honeywellDevices = await this.honeywellService.discoverDevices();
      
      // Update discovered devices
      honeywellDevices.forEach(device => {
        this.honeywellService.discoveredDevices.set(device.id, device);
      });
      
      this.lastDiscovery = now;
      
      return {
        honeywell: honeywellDevices.length,
        total: honeywellDevices.length
      };
    } catch (error) {
      console.error('Error during device discovery:', error);
      return { honeywell: 0, total: 0 };
    }
  }

  // Clear all caches
  clearCache() {
    this.deviceCache.clear();
    this.honeywellService.clearCache();
    console.log('All device caches cleared');
  }

  // Get device statistics
  getDeviceStats() {
    const honeywellCount = this.honeywellService.discoveredDevices.size;
    return {
      honeywell: honeywellCount,
      total: honeywellCount
    };
  }
}

module.exports = UnifiedDeviceService; 