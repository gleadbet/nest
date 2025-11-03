# Honeywell Resideo Thermostat Integration

This document describes the integration of Honeywell Resideo thermostats into the thermostat control system. The integration allows you to control local Honeywell thermostats that are connected to your network, providing a unified interface alongside Google Nest thermostats.

## Overview

The Honeywell integration provides:
- Automatic device discovery on the local network
- Manual device addition by IP address
- Real-time temperature and status monitoring
- Temperature and mode control
- Support for multiple Honeywell thermostat models

## Supported Devices

The integration supports Honeywell Resideo thermostats that:
- Are connected to your local network
- Have a web interface accessible via HTTP
- Support the standard Honeywell API endpoints

### Common Supported Models
- Honeywell T6 Pro
- Honeywell T9 Smart Thermostat
- Honeywell T10 Pro
- Honeywell Lyric T5
- Honeywell Prestige IAQ
- Other models with web interface

## Network Requirements

### Network Configuration
- Thermostats must be on the same local network as the server
- Thermostats must have static IP addresses or DHCP reservations
- Port 80 (HTTP) must be accessible to the server
- No firewall blocking HTTP access to thermostat IPs

### Finding Your Thermostat's IP Address
1. **From the thermostat display:**
   - Navigate to Settings > Network > Network Info
   - Note the IP address displayed

2. **From your router:**
   - Log into your router's admin interface
   - Check the DHCP client list
   - Look for devices named "Honeywell" or "Thermostat"

3. **Network scan:**
   - Use a network scanner app
   - Look for devices on port 80 with Honeywell-related responses

## Installation

### 1. Install Dependencies

The required dependencies are already included in `package.json`:

```json
{
  "node-ssdp": "^4.0.1",
  "xml2js": "^0.6.2",
  "net": "^1.0.2"
}
```

### 2. Environment Variables

No additional environment variables are required for Honeywell integration. The system uses local network discovery.

### 3. Network Access

Ensure your server has access to:
- Local network interfaces
- HTTP requests to thermostat IPs
- Network discovery capabilities

## API Endpoints

### Device Management

#### GET `/api/devices/honeywell`
Returns all discovered Honeywell devices.

**Response:**
```json
[
  {
    "id": "honeywell_192_168_1_100",
    "name": "Honeywell Thermostat (192.168.1.100)",
    "currentTemp": 22.5,
    "targetTemp": 23.0,
    "mode": "HEAT",
    "humidity": 45.2,
    "status": "ONLINE",
    "type": "honeywell_thermostat",
    "ip": "192.168.1.100",
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  }
]
```

#### POST `/api/devices/honeywell`
Perform device management actions.

**Actions:**
- `discover`: Run network discovery for new devices
- `add`: Manually add a device by IP address
- `initialize`: Initialize the device service

**Example:**
```json
{
  "action": "discover"
}
```

### Device Control

#### GET `/api/devices/honeywell/{deviceId}`
Get status of a specific device.

#### POST `/api/devices/honeywell/{deviceId}`
Control a specific device.

**Actions:**
- `setTemperature`: Set target temperature
- `setMode`: Change thermostat mode

**Example:**
```json
{
  "action": "setTemperature",
  "temperature": 22.0,
  "mode": "HEAT"
}
```

#### DELETE `/api/devices/honeywell/{deviceId}`
Remove a device from the service.

## Web Interface

### Accessing the Honeywell Manager

Navigate to `/honeywell` in your web application to access the Honeywell device manager.

### Features
- **Device Discovery**: Automatically find thermostats on your network
- **Manual Addition**: Add devices by IP address
- **Temperature Control**: Set target temperatures
- **Mode Control**: Change between Heat, Cool, Auto, and Off modes
- **Status Monitoring**: Real-time device status and readings
- **Device Management**: Add and remove devices

## Configuration

### Thermostat Setup

1. **Enable Web Interface:**
   - Access your thermostat's settings
   - Enable web interface/remote access
   - Note the IP address

2. **Network Configuration:**
   - Ensure thermostat has static IP or DHCP reservation
   - Verify port 80 is accessible
   - Test connectivity from server

3. **Security Considerations:**
   - Change default passwords if applicable
   - Consider network segmentation for IoT devices
   - Monitor access logs

### Server Configuration

The integration automatically:
- Discovers network interfaces
- Scans local subnets for thermostats
- Caches device responses for performance
- Handles connection timeouts and errors

## Troubleshooting

### Common Issues

#### 1. No Devices Found
**Symptoms:** Discovery returns 0 devices
**Solutions:**
- Verify thermostat IP address
- Check network connectivity
- Ensure thermostat web interface is enabled
- Try manual device addition

#### 2. Connection Timeouts
**Symptoms:** Devices show "ERROR" status
**Solutions:**
- Check firewall settings
- Verify thermostat is powered on
- Test direct HTTP access to thermostat IP
- Check network routing

#### 3. Temperature Not Updating
**Symptoms:** Temperature changes don't take effect
**Solutions:**
- Verify thermostat mode (Heat/Cool/Auto)
- Check temperature range (4.4°C - 32.2°C)
- Ensure thermostat is not in hold mode
- Check thermostat permissions

#### 4. Mode Changes Not Working
**Symptoms:** Mode buttons don't change thermostat state
**Solutions:**
- Verify supported modes for your thermostat model
- Check thermostat is not locked
- Ensure proper authentication if required

### Debug Information

Enable debug logging by checking server console output:

```bash
# Look for these log messages:
"Starting Honeywell device discovery..."
"Discovered Honeywell device: {...}"
"Error getting status for device..."
"Setting temperature on 192.168.1.100: {...}"
```

### Manual Testing

Test thermostat connectivity manually:

```bash
# Test HTTP access to thermostat
curl -v http://192.168.1.100/tstat

# Expected response format:
{
  "t_heat": 72,
  "t_cool": 76,
  "t_current": 74,
  "tmode": 1,
  "humidity": 45
}
```

## Security Considerations

### Network Security
- Honeywell thermostats communicate over HTTP (not HTTPS)
- Consider network segmentation for IoT devices
- Monitor network traffic for unusual activity
- Use strong network passwords

### Access Control
- The web interface requires no authentication
- Consider implementing access controls if needed
- Monitor device access logs
- Regularly review connected devices

### Data Privacy
- Temperature and status data is stored locally
- No data is transmitted to external services
- Consider data retention policies
- Implement logging for audit trails

## Performance Optimization

### Caching
- Device responses are cached for 30 seconds
- Discovery runs every 5 minutes maximum
- Cache is cleared when devices are updated

### Network Efficiency
- Discovery scans local subnets only
- Timeout settings prevent hanging requests
- Connection pooling reduces overhead

### Error Handling
- Failed devices are marked with "ERROR" status
- Automatic retry mechanisms for temporary failures
- Graceful degradation when devices are unavailable

## Integration with Existing System

### Unified Device Interface
The Honeywell integration works alongside Google Nest devices:
- Both device types appear in the main device list
- Unified temperature control interface
- Consistent API responses
- Shared web interface components

### API Compatibility
Honeywell devices follow the same API patterns as Google Nest:
- Same device object structure
- Compatible temperature units (Celsius)
- Similar mode definitions
- Consistent error handling

## Future Enhancements

### Planned Features
- HTTPS support for secure communication
- Advanced scheduling capabilities
- Energy usage monitoring
- Integration with home automation systems
- Mobile app support

### Potential Improvements
- Support for additional thermostat brands
- Advanced device discovery protocols
- Enhanced security features
- Performance optimizations
- Extended API capabilities

## Support

For issues with the Honeywell integration:

1. **Check the troubleshooting section above**
2. **Review server logs for error messages**
3. **Test network connectivity manually**
4. **Verify thermostat configuration**
5. **Check device compatibility**

### Getting Help
- Review this documentation
- Check server console output
- Test with manual HTTP requests
- Verify network configuration
- Contact support with specific error messages

## Changelog

### Version 1.0.0
- Initial Honeywell Resideo integration
- Device discovery and management
- Temperature and mode control
- Web interface for device management
- Unified API with Google Nest devices 