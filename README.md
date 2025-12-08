# Klaviyo Campaign & Flow Dashboard

A full-stack dashboard for viewing Klaviyo campaign and flow metrics with revenue attribution.

## Project Structure

```
.
├── backend/          # Express.js API server
│   ├── server.js     # Main server file
│   ├── auth.js       # Authentication logic
│   └── package.json  # Backend dependencies
├── frontend/         # React + Vite frontend application
│   ├── src/
│   │   ├── pages/    # React page components
│   │   │   ├── Login.jsx
│   │   │   ├── Register.jsx
│   │   │   └── Dashboard.jsx
│   │   ├── contexts/ # React contexts
│   │   │   └── AuthContext.jsx
│   │   ├── App.jsx   # Main app component
│   │   └── main.jsx  # Entry point
│   ├── index.html    # HTML template
│   ├── vite.config.js # Vite configuration
│   └── package.json  # Frontend dependencies
└── package.json      # Root package.json with convenience scripts
```

## Setup

### 1. Install Dependencies

```bash
npm run install:all
```

Or install manually:
```bash
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 2. Authentication System

This application uses a multi-client authentication system where each client has their own Klaviyo API key.

**First Time Setup:**
1. Start the backend server
2. Navigate to `http://localhost:5173/register`
3. Register a new client with:
   - Username
   - Email
   - Password
   - Klaviyo Private API Key (starts with `pk_` or `sk_`)

**Login:**
- Navigate to `http://localhost:5173/` (root URL)
- Login with your email and password
- The dashboard will use your registered Klaviyo API key automatically

## Development

### Run Both Frontend and Backend

```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:3000`
- Frontend dev server on `http://localhost:5173`

### Run Separately

**Backend only:**
```bash
npm run dev:backend
```

**Frontend only:**
```bash
npm run dev:frontend
```

## Production

### Build Frontend

```bash
npm run build
```

The built files will be in `frontend/dist/`

### Start Backend

```bash
npm run start:backend
```

## API Endpoints

### Authentication (No auth required)
- `POST /api/auth/register` - Register a new client
  - Body: `{ username, email, password, klaviyoApiKey }`
- `POST /api/auth/login` - Login
  - Body: `{ email, password }`
  - Returns: `{ token, user }`
- `GET /api/auth/me` - Get current user (requires auth)

### Dashboard Endpoints (Requires authentication)
All endpoints require `Authorization: Bearer <token>` header.

- `GET /api/campaigns` - Get all campaigns with metrics
- `GET /api/flows` - Get all flows with metrics
- `GET /api/campaigns/by-status?status=Placed Order` - Get events by status
- `GET /api/flows/by-status?status=Placed Order` - Get flow events by status
- `GET /api/campaigns/:campaignId/attribution` - Get campaign attribution
- `GET /api/flows/:flowId/attribution` - Get flow attribution

## Technologies

- **Backend**: Express.js, Axios, JWT, bcrypt
- **Frontend**: React 18, Vite, React Router
- **API**: Klaviyo API

