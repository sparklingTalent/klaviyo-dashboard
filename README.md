# Klaviyo Campaign & Flow Dashboard

A full-stack dashboard for viewing Klaviyo campaign and flow metrics with revenue attribution.

## Project Structure

```
.
├── backend/          # Express.js API server
│   ├── server.js     # Main server file
│   └── package.json  # Backend dependencies
├── frontend/         # Vite frontend application
│   ├── index.html    # Main HTML file
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

### 2. Configure Backend

Edit `backend/server.js` and update the Klaviyo API key:

```javascript
const KLAVIYO_API_KEY = 'your-api-key-here';
```

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

- `GET /api/campaigns` - Get all campaigns with metrics
- `GET /api/flows` - Get all flows with metrics
- `GET /api/campaigns/by-status?status=Placed Order` - Get events by status
- `GET /api/flows/by-status?status=Placed Order` - Get flow events by status
- `GET /api/campaigns/:campaignId/attribution` - Get campaign attribution
- `GET /api/flows/:flowId/attribution` - Get flow attribution

## Technologies

- **Backend**: Express.js, Axios
- **Frontend**: Vite, Vanilla JavaScript
- **API**: Klaviyo API

