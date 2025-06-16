# Nest Thermostat Control System

A web-based thermostat control system for Nest devices, built with Express.js and React, featuring real-time temperature monitoring and control capabilities.

## Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git >= 2.0.0
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Google Cloud Platform account with Smart Device Management API enabled

## Features

- Real-time temperature monitoring and control
- Support for multiple thermostat modes (HEAT, COOL, ECO)
- Temperature unit display in Celsius
- Custom device naming
- Secure Google OAuth2 authentication
- Session-based authentication with automatic token refresh
- Comprehensive error handling and rate limiting protection

## Version History

### Version 3.5
- Fixed ECO mode display and status in device list
- Improved device state processing
- Enhanced error handling for mode changes
- Added detailed logging for device state changes

### Version 3.4
- Fixed mode update endpoint to correctly handle ECO mode
- Improved device state synchronization
- Enhanced error handling for temperature updates

### Version 3.0
- Migrated to Express.js backend with React frontend
- Implemented Google Smart Device Management API integration
- Added comprehensive device state management
- Enhanced security with session-based authentication

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

Create a `.env` file in the root directory with the following variables:

```env
SESSION_SECRET=your-session-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
REDIRECT_URI=http://localhost:3000/auth/callback
GOOGLE_PROJECT_ID=your-google-project-id
PORT=3000
```

### 4. Google Cloud Platform Setup

1. Create a new project in Google Cloud Console
2. Enable the following APIs:
   - Google Smart Device Management API
   - Google OAuth2 API
3. Configure OAuth consent screen:
   - Add required scopes:
     - `https://www.googleapis.com/auth/userinfo.profile`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/sdm.service`
4. Create OAuth 2.0 credentials:
   - Set authorized redirect URIs to match your REDIRECT_URI
   - Download client credentials

### 5. Running the Application

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

## API Routes

- `/api/devices` - Get list of all thermostats
- `/api/devices/:deviceId/mode` - Change thermostat mode
- `/api/devices/:deviceId/temperature` - Update temperature setpoint
- `/api/devices/:deviceId/name` - Update custom device name
- `/api/devices/:deviceId/debug` - Get detailed device information
- `/auth/login` - Google OAuth login
- `/auth/callback` - OAuth callback handler
- `/auth/logout` - Logout endpoint

## Authentication and Authorization

### Session Management

1. **Session Configuration**
   - Secure session storage
   - 24-hour session duration
   - Automatic token refresh handling

2. **OAuth2 Flow**
   - Google OAuth2 authentication
   - Secure token storage in session
   - Automatic token refresh

3. **Security Features**
   - CSRF protection
   - Secure cookie settings
   - Rate limiting protection

## Device Control Features

### Thermostat Modes

1. **HEAT Mode**
   - Single temperature setpoint
   - Heating system control
   - Temperature range: 9-32°C

2. **COOL Mode**
   - Single temperature setpoint
   - Cooling system control
   - Temperature range: 9-32°C

3. **ECO Mode**
   - Dual temperature setpoints (heat/cool)
   - Energy-saving operation
   - Automatic mode selection based on temperature

### Device Information

Each thermostat provides:
- Current temperature
- Target temperature
- Current mode
- System status
- Humidity level
- Available modes
- ECO mode support status

## Error Handling

The system includes comprehensive error handling for:
- API rate limiting
- Authentication failures
- Invalid mode changes
- Temperature range violations
- Network connectivity issues
- Session management

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
