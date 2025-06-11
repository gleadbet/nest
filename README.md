# Temperature Monitoring System

A real-time temperature monitoring system built with Next.js, featuring WebSocket support and REST API fallback.

## Features

- Real-time temperature monitoring via WebSocket
- Automatic fallback to REST API polling
- Temperature unit toggle (Fahrenheit/Celsius)
- Custom device naming
- Configurable update intervals
- Secure authentication with token refresh handling

## Version History

### Version 2.0.0
- Added comprehensive token refresh handling
- Improved WebSocket reconnection logic
- Enhanced error handling and retry mechanisms
- Added detailed code documentation

### Version 1.0.0
- Initial release with basic temperature monitoring

## Accessing Specific Versions

### Using Git Tags

To access a specific version of the code, you can use the following commands:

```bash
# List all available versions
git tag -l

# Checkout a specific version (e.g., v2.0.0)
git checkout v2.0.0

# Create a new branch from a specific version
git checkout -b new-branch-name v2.0.0
```

### Current Versions

- `v2.0.0` - Latest stable version with token refresh handling
- `v1.0.0` - Initial release

## Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

## Environment Setup

Create a `.env.local` file with the following variables:
```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key
```

## API Routes

- `/api/devices/[deviceId]` - Device data endpoint
- `/api/devices/[deviceId]/temperature-history` - Historical temperature data
- `/api/socket` - WebSocket connection endpoint
- `/api/socketio` - Socket.IO connection endpoint

## Contributing

1. Create a new branch for your feature
2. Make your changes
3. Submit a pull request

## License

MIT License 