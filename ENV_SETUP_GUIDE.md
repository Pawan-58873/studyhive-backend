# 🔑 StudyHive Backend - Environment Variables Setup Guide

## 📋 Quick Setup

1. **Copy the template:**

   ```bash
   cp .env.example .env
   ```

2. **Fill in your actual values** (see instructions below)

3. **Never commit `.env`** - it's already in `.gitignore`

---

## 🔍 Where to Get Each Key

### 1. **PORT** ✅

```env
PORT=10000
```

- **What it is:** Server port number
- **Your value:** `10000` (as you specified)
- **No setup needed** - just use the value you want

---

### 2. **FIREBASE_API_KEY** 🔥

```env
FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- **Where to get it:**
  1. Go to [Firebase Console](https://console.firebase.google.com/)
  2. Select your project
  3. Click ⚙️ **Settings** → **Project Settings**
  4. Scroll to **"Your apps"** section
  5. Click on your **Web app** (or create one)
  6. Copy the **apiKey** value
- **Format:** Starts with `AIzaSy...`
- **Example:** `AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567`

---

### 3. **FIREBASE_AUTH_DOMAIN** 🔥

```env
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
```

- **Where to get it:** Same place as above (Firebase Console)
- **Format:** `your-project-id.firebaseapp.com`
- **Example:** `studyhive-9079d.firebaseapp.com`

---

### 4. **FIREBASE_PROJECT_ID** 🔥

```env
FIREBASE_PROJECT_ID=your-project-id
```

- **Where to get it:** Same place as above (Firebase Console)
- **Format:** Your project ID (usually lowercase with hyphens)
- **Example:** `studyhive-9079d`

---

### 5. **FIREBASE_PRIVATE_KEY** & **FIREBASE_CLIENT_EMAIL** 🔥

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

**⚠️ RECOMMENDED: Use serviceAccountKey.json instead!**

- **Option A (Recommended):** Download service account JSON file

  1. Go to [Firebase Console](https://console.firebase.google.com/)
  2. ⚙️ **Settings** → **Project Settings** → **Service Accounts** tab
  3. Click **"Generate new private key"**
  4. Download the JSON file
  5. Rename it to `serviceAccountKey.json`
  6. Place it in: `server/serviceAccountKey.json`
  7. The server will automatically use this file (no need for env vars)

- **Option B:** Extract from JSON file
  - If you downloaded the service account JSON, you can extract:
    - `private_key` → `FIREBASE_PRIVATE_KEY`
    - `client_email` → `FIREBASE_CLIENT_EMAIL`
  - **Note:** Private key must include `\n` characters (newlines)

---

### 6. **JWT_SECRET** 🔐

```env
JWT_SECRET=your-random-secure-string-here
```

- **What it is:** Secret key for signing/verifying JWT tokens
- **How to generate:**

  ```bash
  # Using Node.js
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

  # Or use an online generator
  # https://randomkeygen.com/
  ```

- **Requirements:**
  - At least 32 characters
  - Random and secure
  - Keep it secret!
- **Example:** `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`

---

### 7. **HUGGINGFACE_API_KEY** 🤗

```env
HUGGINGFACE_API_KEY=hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HF_API_KEY=hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- **Where to get it:**
  1. Go to [Hugging Face](https://huggingface.co/)
  2. Sign up / Log in
  3. Go to [Settings → Access Tokens](https://huggingface.co/settings/tokens)
  4. Click **"New token"**
  5. Name it (e.g., "StudyHive")
  6. Select **"Read"** permissions
  7. Click **"Generate token"**
  8. Copy the token (starts with `hf_`)
- **Format:** Starts with `hf_`
- **Note:** Set both `HUGGINGFACE_API_KEY` and `HF_API_KEY` to the same value

---

## 📝 Complete .env File Example

```env
# Server
PORT=10000
CLIENT_ORIGIN=http://localhost:5173

# Firebase (Frontend Config)
FIREBASE_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567
FIREBASE_AUTH_DOMAIN=studyhive-9079d.firebaseapp.com
FIREBASE_PROJECT_ID=studyhive-9079d

# Firebase Service Account (Backend - Optional if using JSON file)
# FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
# FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@studyhive-9079d.iam.gserviceaccount.com

# JWT Secret
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6

# Hugging Face API
HUGGINGFACE_API_KEY=hf_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890
HF_API_KEY=hf_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890
```

---

## ✅ Verification Steps

After setting up your `.env` file:

1. **Check file exists:**

   ```bash
   ls -la server/.env
   ```

2. **Verify no secrets in git:**

   ```bash
   git status
   # .env should NOT appear in the list
   ```

3. **Test server starts:**

   ```bash
   cd server
   npm install
   npm start
   ```

4. **Check for errors:**
   - ✅ Good: Server starts on port 10000
   - ❌ Bad: "Missing environment variable" errors

---

## 🚨 Security Reminders

- ⚠️ **NEVER commit `.env` file to git**
- ⚠️ **NEVER share your API keys publicly**
- ⚠️ **Use different keys for development and production**
- ⚠️ **Rotate keys if they're exposed**
- ⚠️ **Use `serviceAccountKey.json` file instead of env vars for Firebase (more secure)**

---

## 🆘 Troubleshooting

### "Firebase API key invalid"

- Check you copied the full key (starts with `AIzaSy`)
- No extra spaces or quotes

### "Missing FIREBASE_PRIVATE_KEY"

- Either set the env vars OR use `serviceAccountKey.json` file
- The server prefers the JSON file if it exists

### "JWT_SECRET is not set"

- Generate a new secret using the command above
- Make sure it's at least 32 characters

### "Hugging Face API error"

- Check your token starts with `hf_`
- Verify token has "Read" permissions
- Make sure both `HUGGINGFACE_API_KEY` and `HF_API_KEY` are set

---

## 📚 Additional Resources

- [Firebase Console](https://console.firebase.google.com/)
- [Hugging Face Tokens](https://huggingface.co/settings/tokens)
- [JWT Best Practices](https://jwt.io/introduction)
