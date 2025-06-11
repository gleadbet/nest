# Temperature Monitoring System

A real-time temperature monitoring system built with Next.js, featuring WebSocket support and REST API fallback.

## Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git >= 2.0.0
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Google Cloud Platform account
- Nest Developer account

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
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEST_CLIENT_ID=your-nest-client-id
NEST_CLIENT_SECRET=your-nest-client-secret
```

### 4. Google Cloud Platform Setup

1. Create a new project in Google Cloud Console
2. Enable the following APIs:
   - Google Smart Device Management API
   - Google OAuth2 API
3. Configure OAuth consent screen:
   - Add required scopes:
     - `https://www.googleapis.com/auth/sdm.service`
     - `https://www.googleapis.com/auth/sdm.devices.read`
4. Create OAuth 2.0 credentials:
   - Set authorized redirect URIs
   - Download client credentials

### 5. Nest Developer Setup

1. Create a Nest Developer account
2. Create a new project
3. Configure OAuth settings:
   - Set redirect URIs
   - Configure allowed domains
4. Note down client ID and secret

### 6. Running the Application

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

### 7. Running Tests
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

## Authentication and Authorization

### Token Management

1. **Access Tokens**
   - Short-lived (1 hour)
   - Automatically refreshed using refresh tokens
   - Stored securely in session

2. **Refresh Tokens**
   - Long-lived (up to 6 months)
   - Used to obtain new access tokens
   - Stored securely in database

3. **Token Refresh Flow**
   ```typescript
   // Automatic refresh handled by NextAuth
   const { data: session } = useSession();
   
   // Manual refresh if needed
   const refreshToken = async () => {
     await signIn('google', { callbackUrl: '/' });
   };
   ```

### Authorization Scopes

Required OAuth scopes:
- `https://www.googleapis.com/auth/sdm.service`
- `https://www.googleapis.com/auth/sdm.devices.read`

## Nest API Limitations

### Rate Limits
- 100 requests per minute per project
- 1000 requests per day per project
- WebSocket connections: 1 per device

### Data Limitations
- Temperature updates: Every 30 seconds
- Historical data: 7 days retention
- Maximum devices per project: 100

### Known Issues
1. **WebSocket Disconnections**
   - Automatic reconnection implemented
   - Fallback to REST API polling
   - Maximum retry attempts: 5

2. **Token Expiration**
   - Access tokens expire after 1 hour
   - Refresh tokens expire after 6 months
   - Automatic refresh implemented

3. **API Quotas**
   - Monitor usage in Google Cloud Console
   - Implement rate limiting in your application
   - Use caching when possible

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

4. **Authentication Issues**
   - Verify OAuth credentials
   - Check token expiration
   - Ensure correct redirect URIs
   - Verify required scopes

5. **API Rate Limiting**
   - Monitor request frequency
   - Implement exponential backoff
   - Use WebSocket when possible
   - Cache frequently accessed data

## Contributing

1. Create a new branch for your feature
2. Make your changes
3. Submit a pull request

## License

MIT License 