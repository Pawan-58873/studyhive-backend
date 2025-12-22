# StudyHive Backend

A Node.js/Express backend server for the StudyHive collaborative learning platform.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Firebase project with Firestore and Authentication enabled

### Local Development

1. **Install dependencies:**

   ```bash
   cd server
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Start the development server:**

   ```bash
   npm run dev
   ```

4. **Or start production server:**
   ```bash
   npm start
   ```

The server will start on `http://localhost:8000` (or the PORT specified in environment variables).

---

## 🔧 Environment Variables

### Required for Production (Render Deployment)

| Variable                  | Description                                  | Example                                                         |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `PORT`                    | Server port (Render sets this automatically) | `10000`                                                         |
| `CLIENT_ORIGIN`           | Frontend URL for CORS                        | `https://studyhive.vercel.app`                                  |
| `FIREBASE_PROJECT_ID`     | Firebase project ID                          | `studyhive-9079d`                                               |
| `FIREBASE_CLIENT_EMAIL`   | Firebase service account email               | `firebase-adminsdk-xxx@project.iam.gserviceaccount.com`         |
| `FIREBASE_PRIVATE_KEY`    | Firebase service account private key         | `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` |
| `FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket name                 | `studyhive-9079d.appspot.com`                                   |
| `LIVEBLOCKS_SECRET_KEY`   | Liveblocks API secret key                    | `sk_prod_xxx...`                                                |

### Optional

| Variable                     | Description                                | Default                                 |
| ---------------------------- | ------------------------------------------ | --------------------------------------- |
| `GEMINI_API_KEY`             | Google Gemini API key for AI features      | _(AI features disabled if not set)_     |
| `FIREBASE_WEB_API_KEY`       | Firebase Web API key (for password change) | _(Password change disabled if not set)_ |
| `REQUIRE_EMAIL_VERIFICATION` | Enforce email verification                 | `false`                                 |

---

## 🌐 Render Deployment Guide

### Step 1: Create a New Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Select the `server` directory as the root directory

### Step 2: Configure Build Settings

| Setting            | Value                        |
| ------------------ | ---------------------------- |
| **Name**           | `studyhive-backend`          |
| **Environment**    | `Node`                       |
| **Region**         | Choose closest to your users |
| **Branch**         | `main`                       |
| **Root Directory** | `server` (if in monorepo)    |
| **Build Command**  | `npm install`                |
| **Start Command**  | `npm start`                  |

### Step 3: Add Environment Variables

In the Render dashboard, go to **Environment** tab and add:

```
PORT=10000
CLIENT_ORIGIN=https://your-frontend-url.vercel.app
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...(full key)...\n-----END PRIVATE KEY-----\n
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
LIVEBLOCKS_SECRET_KEY=sk_prod_xxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxx
```

> ⚠️ **Important**: For `FIREBASE_PRIVATE_KEY`, paste the entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`. The `\n` characters will be converted to actual newlines by the server.

### Step 4: Deploy

Click **Create Web Service** and wait for deployment to complete.

---

## 🔑 Getting Firebase Credentials

### Service Account Credentials

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Click ⚙️ **Settings** → **Project Settings**
4. Go to **Service Accounts** tab
5. Click **Generate new private key**
6. Download the JSON file
7. Extract these values:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY`

### Storage Bucket

1. In Firebase Console, go to **Storage**
2. Your bucket name is shown at the top (e.g., `gs://your-project.appspot.com`)
3. Use `your-project.appspot.com` as `FIREBASE_STORAGE_BUCKET`

---

## 🔑 Getting Other API Keys

### Liveblocks

1. Go to [Liveblocks Dashboard](https://liveblocks.io/dashboard)
2. Create or select a project
3. Go to **API Keys**
4. Copy the **Secret key** (starts with `sk_`)

### Google Gemini (for AI features)

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click **Create API Key**
3. Copy the generated key

---

## 📁 Project Structure

```
server/
├── index.ts              # Main entry point
├── package.json          # Dependencies and scripts
├── src/
│   ├── api/              # Route handlers
│   │   ├── ai.routes.ts
│   │   ├── chat.routes.ts
│   │   ├── file.routes.ts
│   │   ├── group.routes.ts
│   │   ├── liveblocks.routes.ts
│   │   ├── session.routes.ts
│   │   └── user.routes.ts
│   ├── config/
│   │   └── firebase.ts   # Firebase initialization
│   ├── controllers/      # Business logic
│   ├── middlewares/      # Auth and upload middleware
│   └── shared/
│       └── schema.ts     # TypeScript types
└── README.md
```

---

## 🧪 API Endpoints

### Health Check

- `GET /api/health` - Server health check (no auth)

### Authentication Required Endpoints

- `GET /api/users/me` - Get current user profile
- `PUT /api/users/me` - Update user profile
- `GET /api/groups` - Get user's groups
- `POST /api/groups` - Create a new group
- `GET /api/groups/:id` - Get group details
- `POST /api/groups/:id/files` - Upload file to group
- `GET /api/groups/:id/files` - Get group files
- `POST /api/ai/summarize` - Summarize text/document
- `POST /api/liveblocks/auth` - Liveblocks authentication

---

## 🔒 Security Notes

- ⚠️ **Never commit `.env` files to git**
- ⚠️ **Never commit `serviceAccountKey.json` to git**
- ⚠️ **All Firebase credentials should be in environment variables**
- ⚠️ **Use different API keys for development and production**

---

## 📝 Scripts

| Script          | Description                              |
| --------------- | ---------------------------------------- |
| `npm start`     | Start production server                  |
| `npm run dev`   | Start development server with hot reload |
| `npm run build` | Compile TypeScript                       |
| `npm test`      | Run tests                                |

---

## 🐛 Troubleshooting

### "Firebase initialization failed"

- Check that all `FIREBASE_*` environment variables are set correctly
- Ensure `FIREBASE_PRIVATE_KEY` includes the full key with proper newlines

### "LIVEBLOCKS_SECRET_KEY is not defined"

- Add the `LIVEBLOCKS_SECRET_KEY` environment variable
- Get it from [Liveblocks Dashboard](https://liveblocks.io/dashboard)

### "AI summarization not configured"

- Add the `GEMINI_API_KEY` environment variable
- Get it from [Google AI Studio](https://makersuite.google.com/app/apikey)

### CORS errors

- Ensure `CLIENT_ORIGIN` matches your frontend URL exactly
- Include the full URL with protocol (e.g., `https://studyhive.vercel.app`)

---

## 📄 License

MIT License
