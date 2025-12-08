# Deployment Guide

This guide explains how to deploy the Klaviyo Dashboard to Vercel (frontend) and Railway (backend).

## Prerequisites

- GitHub account
- Vercel account (sign up at https://vercel.com)
- Railway account (sign up at https://railway.app)

## Backend Deployment (Railway)

### Step 1: Prepare Backend

1. Make sure your `backend/` folder has all necessary files:
   - `server.js`
   - `package.json`
   - `auth.js`
   - `users.json` (will be created automatically)

### Step 2: Deploy to Railway

1. Go to [Railway](https://railway.app) and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo" (or upload the backend folder)
4. Select your repository and choose the `backend` folder
5. Railway will automatically detect Node.js and install dependencies

### Step 3: Configure Environment Variables

In Railway dashboard, go to your project → Variables tab and add:

```
FRONTEND_URL=https://your-vercel-app.vercel.app
JWT_SECRET=your-strong-random-secret-key-here
```

**Important**: Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Get Backend URL

After deployment, Railway will provide a URL like:
```
https://your-app.railway.app
```

Copy this URL - you'll need it for the frontend configuration.

## Frontend Deployment (Vercel)

### Step 1: Prepare Frontend

1. Make sure your `frontend/` folder has all necessary files
2. The `vercel.json` is already configured

### Step 2: Deploy to Vercel

1. Go to [Vercel](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

### Step 3: Configure Environment Variables

In Vercel dashboard, go to your project → Settings → Environment Variables and add:

```
VITE_API_BASE_URL=https://your-railway-app.railway.app
```

Replace `https://your-railway-app.railway.app` with your actual Railway backend URL.

### Step 4: Deploy

Click "Deploy" and wait for the build to complete.

## Post-Deployment

### Update CORS in Backend

After getting your Vercel URL, update the `FRONTEND_URL` environment variable in Railway to match your Vercel deployment URL.

### Test the Deployment

1. Visit your Vercel URL
2. Try registering a new user
3. Login and verify the dashboard loads correctly

## Troubleshooting

### Frontend can't connect to backend

- Check that `VITE_API_BASE_URL` in Vercel matches your Railway URL
- Ensure Railway backend is running (check Railway logs)
- Verify CORS settings in backend allow your Vercel domain

### Authentication not working

- Verify `JWT_SECRET` is set in Railway
- Check that `FRONTEND_URL` in Railway matches your Vercel URL
- Check browser console for CORS errors

### Build errors

- Ensure all dependencies are in `package.json`
- Check build logs in Vercel dashboard
- Verify Node.js version compatibility

## Environment Variables Summary

### Railway (Backend)
- `FRONTEND_URL`: Your Vercel frontend URL
- `JWT_SECRET`: Secret key for JWT tokens
- `PORT`: Automatically set by Railway (optional)

### Vercel (Frontend)
- `VITE_API_BASE_URL`: Your Railway backend URL

## Notes

- The `users.json` file is created automatically on first run
- Make sure to add `backend/users.json` to `.gitignore` (already done)
- Railway provides HTTPS automatically
- Vercel provides HTTPS automatically

