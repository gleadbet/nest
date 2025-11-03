# Nest Thermostat Control System

A web-based thermostat control system for Nest devices, built with Express.js and React, featuring real-time temperature monitoring and control capabilities.

## 3 Thermostats - Controllable setpoints - mode - real time graphic display

<img width="2636" height="1440" alt="image" src="https://github.com/user-attachments/assets/0f085dc5-2b47-4177-a0c9-0c4417736295" />

## Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git >= 2.0.0
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Google Cloud Platform account with Smart Device Management API enabled
- MongoDB (v4.4 or higher)

## Features

- Real-time temperature monitoring and control
- Support for multiple thermostat modes (HEAT, COOL, ECO)
- Temperature unit display in Celsius
- Custom device naming
- Secure Google OAuth2 authentication
- Session-based authentication with automatic token refresh
- Comprehensive error handling and rate limiting protection

## Version History

### Version 3.7 (2024-03-21)
- Improved temperature setpoint persistence
- Enhanced verification process for temperature changes
- Added multiple verification attempts with configurable delays
- Improved error handling and logging for temperature updates
- Fixed issue where temperature changes required multiple attempts
- Added robust temperature increment handling with:
  - Initial 2-second delay for API processing
  - Up to 5 verification attempts with 1-second intervals
  - Final 3-second verification attempt for edge cases
  - Temperature precision handling within 0.1°C
  - Detailed logging of verification process

### Version 3.6
- Added automatic token refresh handling
- Implemented rate limiting protection
- Enhanced error handling for API limits
- Improved caching mechanism for device data
- Added better logging for debugging

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

### v3.8 (2024-03-21)
- Improved rate limiting handling for temperature updates
- Added per-endpoint rate limit tracking
- Enhanced error recovery for rate limit errors
- Reduced API request limits to prevent throttling
- Added better error messages with retry information

## Installation and Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- Google Cloud Platform account with Smart Device Management API enabled

### Environment Variables
Create a `.env` file in the root directory with the following variables:
```env
SESSION_SECRET=your_session_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
REDIRECT_URI=your_redirect_uri
GOOGLE_PROJECT_ID=your_project_id
MONGODB_URI=mongodb://localhost:27017/thermostat
PORT=3000
```

### Database Setup
The application uses MongoDB to store thermostat data and history. The database schema includes:
- Current thermostat state
- Historical data (last 100 entries per device)
- Timestamps for all readings
- Indexed fields for efficient querying

To set up MongoDB:
1. Install MongoDB on your system
2. Create a database named 'thermostat'
3. The application will automatically create the necessary collections and indexes

### Installation Steps

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

### 3. Google Cloud Platform Setup

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

## API Routes

- `/api/devices` - Get list of all thermostats
- `/api/devices/:deviceId/mode` - Change thermostat mode
- `/api/devices/:deviceId/temperature` - Update temperature setpoint
- `/api/devices/:deviceId/name` - Update custom device name
- `/api/devices/:deviceId/debug` - Get detailed device information
- `/auth/login` - Google OAuth login
- `/auth/callback` - OAuth callback handler
- `/auth/logout` - Logout endpoint

## API Endpoints

### Device History
- `GET /api/devices/:deviceId/history`
  - Returns historical data for a specific device
  - Optional query parameters:
    - `startDate`: Filter data from this date (ISO format)
    - `endDate`: Filter data until this date (ISO format)
  - Returns up to 100 most recent entries

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
