const axios = require('axios');

async function testBackendIntegration() {
  console.log('Testing Backend Integration with Honeywell Support...\n');

  const baseUrl = 'http://localhost:3000';

  try {
    // Test 1: Check if server is running
    console.log('1. Testing server connectivity...');
    try {
      const response = await axios.get(`${baseUrl}/api/test`);
      console.log('✅ Server is running:', response.data);
    } catch (error) {
      console.log('❌ Server not running. Please start the server with: npm start');
      return;
    }
    console.log('');

    // Test 2: Test Honeywell device discovery
    console.log('2. Testing Honeywell device discovery...');
    try {
      const response = await axios.post(`${baseUrl}/api/devices/honeywell`, {
        action: 'discover'
      });
      console.log('✅ Discovery result:', response.data);
    } catch (error) {
      console.log('❌ Discovery failed:', error.response?.data || error.message);
    }
    console.log('');

    // Test 3: Test adding a Honeywell device manually
    console.log('3. Testing manual device addition...');
    try {
      const response = await axios.post(`${baseUrl}/api/devices/honeywell`, {
        action: 'add',
        ip: '192.168.1.100',
        name: 'Test Honeywell Thermostat'
      });
      console.log('✅ Device added:', response.data);
    } catch (error) {
      console.log('❌ Device addition failed:', error.response?.data || error.message);
    }
    console.log('');

    // Test 4: Test getting Honeywell devices
    console.log('4. Testing get Honeywell devices...');
    try {
      const response = await axios.get(`${baseUrl}/api/devices/honeywell`);
      console.log(`✅ Found ${response.data.length} Honeywell devices:`, response.data);
    } catch (error) {
      console.log('❌ Failed to get Honeywell devices:', error.response?.data || error.message);
    }
    console.log('');

    // Test 5: Test unified devices endpoint (if authenticated)
    console.log('5. Testing unified devices endpoint...');
    try {
      const response = await axios.get(`${baseUrl}/api/devices`);
      console.log(`✅ Unified devices endpoint returned ${response.data.length} devices`);
      console.log('Device types found:');
      const deviceTypes = response.data.reduce((acc, device) => {
        const type = device.type || 'unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});
      Object.entries(deviceTypes).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count}`);
      });
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('⚠️  Unified devices endpoint requires authentication (expected)');
      } else {
        console.log('❌ Unified devices endpoint failed:', error.response?.data || error.message);
      }
    }
    console.log('');

    console.log('✅ Backend integration test completed!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Start the server: npm start');
    console.log('2. Access the web interface at http://localhost:3000');
    console.log('3. Navigate to /honeywell to manage Honeywell devices');
    console.log('4. Add your Honeywell thermostat IP address');
    console.log('5. Test temperature and mode controls');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testBackendIntegration(); 