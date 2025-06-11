# Temperature Monitoring System

A real-time temperature monitoring system built with Next.js, featuring WebSocket support and REST API fallback.

## Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git >= 2.0.0
- A modern web browser (Chrome, Firefox, Safari, or Edge)

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

## Installation and Setup

### 1. Clone the Repository

```bash
# Clone the repository
git clone https://github.com/gleadbet/nest.git

# Navigate to project directory
cd nest
```

### 2. Install Dependencies

```bash
# Install all required packages
npm install
```

### 3. Environment Configuration

Create a `.env.local` file in the root directory with the following variables:
```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key
```

### 4. Running the Application

#### Development Mode
```bash
# Start the development server
npm run dev

# The application will be available at http://localhost:3000
```

#### Production Build
```bash
# Create a production build
npm run build

# Start the production server
npm start
```

### 5. Running Tests
```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage
```

## API Routes

- `/api/devices/[deviceId]` - Device data endpoint
- `/api/devices/[deviceId]/temperature-history` - Historical temperature data
- `/api/socket` - WebSocket connection endpoint
- `/api/socketio` - Socket.IO connection endpoint

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Find process using port 3000
   lsof -i :3000
   
   # Kill the process
   kill -9 <PID>
   ```

2. **Node Version Issues**
   ```bash
   # Check Node version
   node -v
   
   # Install correct version using nvm
   nvm install 18
   nvm use 18
   ```

3. **WebSocket Connection Issues**
   - Ensure your firewall allows WebSocket connections
   - Check browser console for connection errors
   - Verify environment variables are set correctly

## Contributing

1. Create a new branch for your feature
2. Make your changes
3. Submit a pull request

## License

MIT License 