# Vibetrim

Vibetrim is a web application that allows downloading and trimming YouTube videos. It features a modern frontend built with Vite and an Express.js backend using `@distube/ytdl-core` and `ffmpeg` for media processing.

**Live App URL:** [https://ytdowload-ecru.vercel.app/](https://ytdowload-ecru.vercel.app/)

## What is Included in the Project

The project is structured efficiently to serve both a frontend application and a backend API. Key components included are:

- **Express Backend Server:** (`server.js`) Serves API endpoints for downloading and processing YouTube streams. Uses `ffmpeg-static` for audio/video manipulation.
- **Vite Frontend:** Source code hosted in `src/` and static assets in `public/`. Provides a fast, modern user interface.
- **Deployment Configurations:**
  - `vercel.json`: Configuration for deploying the frontend and serverless API handlers directly on Vercel.
  - `railway.json` & `nixpacks.toml`: Configuration for deploying the Express.js standalone server on Railway.
- **Environment Configurations:** Custom configuration provided via `.env` variables (e.g., `PORT`, `ALLOWED_ORIGINS`, `HTTP_PROXY`).

## Local Development Commands

To run the project locally, start by installing the necessary dependencies:

```bash
npm install
```

### Running the Frontend

To start the Vite development server for the frontend app:

```bash
npm run dev
```

### Running the Backend

To start the Express API server locally:

```bash
npm start
# or alternatively
node server.js
```

### Building for Production

To build the frontend static assets for production:

```bash
npm run build
```

## Deployment Steps

This project contains out-of-the-box configuration files to be easily deployed on both Vercel and Railway platforms.

### Deploying to Vercel (Recommended for Frontend / Serverless)

Vercel is great for hosting the frontend Vite build.

**Via Vercel CLI:**
```bash
npm install -g vercel
vercel
vercel --prod  # For production deployment
```

**Via Vercel Dashboard:**
1. Push your code to a GitHub, GitLab, or Bitbucket repository.
2. Log in to [Vercel](https://vercel.com/) and click **Add New** -> **Project**.
3. Import your chosen repository.
4. Vercel will automatically detect the **Vite** framework and apply the build commands (`npm run build`).
5. Set up your **Environment Variables** in the Vercel dashboard if necessary (e.g., `ALLOWED_ORIGINS`).
6. The `vercel.json` file in the project automatically configures API routing and output directory settings.
7. Click **Deploy**.

### Deploying to Railway (Recommended for Express Backend)

Railway is an excellent platform for hosting the long-running Express server for heavier tasks like `ffmpeg` processing.

**Via Railway CLI:**
```bash
npm i -g @railway/cli
railway login
railway link  # Select your project
railway up
```

**Via Railway Dashboard:**
1. Push your code to a repository.
2. Log in to [Railway](https://railway.app/) and create a **New Project**.
3. Choose **Deploy from GitHub repo** and select your Vibetrim repository.
4. Railway will automatically detect the `railway.json` and `nixpacks.toml` configurations. These files ensure your environment utilizes Node.js 20, properly handles installations, and correctly boots `node server.js`.
5. Go to the project **Variables** settings and configure environments like:
   - `PORT` (Railway usually injects this, but it defaults to 3000 if needed)
   - `ALLOWED_ORIGINS` (Point this to your deployed Vercel frontend URL or `*`)
   - `HTTP_PROXY` (Optional proxies to bypass rate limits)
6. Railway handles the build and deployment dynamically.
