# Nexus - Real-Time Chat Application

Nexus is a real-time messaging application for private one-to-one conversations. Users can discover accounts, start a direct conversation, and exchange persisted messages live with Socket.IO. Password-protected collaboration rooms remain available.

## ✨ Features

* 🔐 Secure User Authentication (JWT)
* 💬 Private One-to-One Conversations
* 👥 User discovery and recent conversations
* 🔄 Persisted chat history with live delivery and typing indicators
* ↩ Close the current chat and return to the inbox without deleting its history
* 👁 Quick privacy screen with a one-tap and keyboard shortcut toggle
* 👥 Password-Protected Collaboration Rooms
* 🎮 Live tic-tac-toe in direct conversations, with synced turns and saved game state
* 📎 Direct-message image, video, and document uploads, stored in MongoDB GridFS
* 😀 Emoji Reactions
* 📌 Pin & Unpin Messages
* 📊 Poll Creation & Voting
* ✅ Task Management
* ⚡ Socket.IO Powered Live Communication

## Run locally

1. Install Node.js 20.19+ and start MongoDB, or use a MongoDB Atlas connection string.
2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` and a private `JWT_SECRET`.
3. Copy `frontend/.env.example` to `frontend/.env`. Change the backend URL only if the API is not at `http://localhost:5000`.
4. From the project root, run `npm run install-backend` and `npm run install-frontend`.
5. In separate terminals, run `npm run dev-backend` and `npm run dev-frontend`.
6. Open http://localhost:3000, create an account, and sign in. Use **Open direct messages** to find another account and start a private chat.

## Deploy

The included deployment configuration targets Render for the API/Socket.IO server and Vercel for the React single-page application.

### Backend (Render)

1. Create a Render Web Service from this repository and use the included `render.yaml` Blueprint.
2. Provide `MONGODB_URI` with a MongoDB Atlas connection string and `FRONTEND_URL` with the deployed frontend origin. Multiple allowed origins can be comma-separated.
3. Render generates `JWT_SECRET`; keep it and the MongoDB connection string private.
4. The service exposes `/health`, which checks both the server and MongoDB connection.
Direct-message attachments use MongoDB GridFS, so they persist with the configured MongoDB database rather than the service's local disk. Uploads are limited to 20 MB per file and support PNG/JPEG/GIF/WebP images, MP4/WebM video, and PDF/Office/TXT/CSV documents.

### Frontend (Vercel)

1. Import the repository into Vercel, keeping the project root at the repository root.
2. The included `vercel.json` installs/builds the React app and routes SPA URLs to `index.html`.
3. Set `REACT_APP_BACKEND_URL` to the Render service's public URL, then deploy or redeploy. Add the final Vercel origin to Render's `FRONTEND_URL`.


## Checks

Run `npm test` for backend tests and `npm run build-frontend` to verify the production frontend build.

## 🛠 Tech Stack

* React.js
* Node.js
* Express.js
* Socket.IO
* MongoDB
* JWT Authentication
* Vercel (Frontend)
* Render (Backend)
