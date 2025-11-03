const HoneywellService = require('./src/services/honeywellService');

async function testHoneywellIntegration() {
  console.log('Testing Honeywell Resideo Thermostat Integration...\n');

  const honeywellService = new HoneywellService();

  try {
    // Test 1: Initialize service
    console.log('1. Testing service initialization...');
    console.log('Service initialized successfully\n');

    // Test 2: Manual device addition
    console.log('2. Testing manual device addition...');
    const testDevice = honeywellService.addDevice('192.168.1.100', 'Test Thermostat');
    console.log('Added test device:', testDevice);
    console.log('');

    // Test 3: Device discovery (this will scan the network)
    console.log('3. Testing device discovery...');
    console.log('This will scan your local network for Honeywell thermostats...');
    const discoveredDevices = await honeywellService.discoverDevices();
    console.log(`Discovery complete. Found ${discoveredDevices.length} devices:`);
    discoveredDevices.forEach(device => {
      console.log(`  - ${device.name} at ${device.ip}`);
    });
    console.log('');

    // Test 4: Get all devices
    console.log('4. Testing device status retrieval...');
    const allDevices = await honeywellService.getAllDevices();
    console.log(`Retrieved ${allDevices.length} devices:`);
    allDevices.forEach(device => {
      console.log(`  - ${device.name}: ${device.currentTemp}°C, Mode: ${device.mode}, Status: ${device.status}`);
    });
    console.log('');

    // Test 5: Test device status (if devices found)
    if (allDevices.length > 0) {
      console.log('5. Testing individual device status...');
      const firstDevice = allDevices[0];
      try {
        const status = await honeywellService.getDeviceStatus(firstDevice.id);
        console.log(`Status for ${firstDevice.name}:`, status);
      } catch (error) {
        console.log(`Error getting status for ${firstDevice.name}:`, error.message);
      }
      console.log('');
    }

    // Test 6: Test temperature setting (if devices found)
    if (allDevices.length > 0) {
      console.log('6. Testing temperature setting (simulation)...');
      const firstDevice = allDevices[0];
      console.log(`Would set temperature for ${firstDevice.name} to 22°C in HEAT mode`);
      console.log('(This is a simulation - actual temperature setting requires a real device)');
      console.log('');
    }

    console.log('✅ Honeywell integration test completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Ensure your Honeywell thermostat is on the same network');
    console.log('2. Find your thermostat\'s IP address');
    console.log('3. Add the device manually if auto-discovery doesn\'t work');
    console.log('4. Access the web interface at /honeywell to manage devices');
    console.log('');
    console.log('For more information, see HONEYWELL_INTEGRATION.md');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testHoneywellIntegration(); 