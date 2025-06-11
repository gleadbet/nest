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

```env
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
