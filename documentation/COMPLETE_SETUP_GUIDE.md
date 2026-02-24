# 🔧 Laptop Refurbishment Workflow Management System

Complete step-by-step guide to build and deploy your system from scratch - **100% FREE**

---

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Database Setup (Railway/Supabase)](#step-1-database-setup)
3. [Step 2: Backend Setup](#step-2-backend-setup)
4. [Step 3: Frontend Setup](#step-3-frontend-setup)
5. [Step 4: Testing Locally](#step-4-testing-locally)
6. [Step 5: Deployment](#step-5-deployment)
7. [API Documentation](#api-documentation)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, make sure you have:
- A computer with internet connection
- Basic knowledge of terminal/command prompt
- A GitHub account (for deployment)
- An email address

**Software to Install:**
1. **Node.js** (v18 or higher) - Download from https://nodejs.org
2. **Git** - Download from https://git-scm.com
3. **VSCode** (optional but recommended) - Download from https://code.visualstudio.com

**Verify installations:**
```bash
node --version   # Should show v18.x.x or higher
npm --version    # Should show 9.x.x or higher
git --version    # Should show git version
```

---

## Step 1: Database Setup

### Option A: Railway.app (Recommended - Easiest)

1. **Go to** https://railway.app
2. **Sign up** with your GitHub account (free)
3. **Create New Project** → Click "Provision PostgreSQL"
4. **Get Database Credentials:**
   - Click on your PostgreSQL service
   - Go to "Connect" tab
   - Copy these values:
     ```
     PGHOST=xxx.railway.app
     PGPORT=5432
     PGDATABASE=railway
     PGUSER=postgres
     PGPASSWORD=your-password
     ```

5. **Connect to Database:**
   - Click "Query" tab or use a PostgreSQL client
   - Copy the contents of `backend/master_setup.sql`
   - Paste and run it
   - You should see tables created successfully!

### Option B: Supabase (Alternative)

1. Go to https://supabase.com
2. Sign up with GitHub
3. Create New Project
4. Go to Settings → Database
5. Copy connection string
6. In SQL Editor, run `backend/master_setup.sql`

---

## Step 2: Backend Setup

### 2.1 Create Backend Project

```bash
# Navigate to your project folder
cd laptop-refurbishment/backend

# Initialize npm (if package.json doesn't exist)
npm install

# If you get errors, install dependencies manually:
npm install express pg dotenv bcryptjs jsonwebtoken cors multer express-validator
npm install --save-dev nodemon
```

### 2.2 Configure Environment Variables

Create a file called `.env` in the `backend` folder:

```env
# Copy from .env.example and fill in your values
DB_HOST=your-railway-host.railway.app
DB_PORT=5432
DB_NAME=railway
DB_USER=postgres
DB_PASSWORD=your-password-from-railway

JWT_SECRET=your-super-secret-key-min-32-characters-long

PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

**Important:** Change `JWT_SECRET` to a random string! You can generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.3 Test Backend

```bash
# Start the server
npm start

# Or for development with auto-reload:
npm run dev
```

You should see:
```
╔══════════════════════════════════════════════╗
║   🚀 Server running on port 5000           ║
║   📝 Environment: development              ║
║   🔗 API: http://localhost:5000            ║
╚══════════════════════════════════════════════╝
✅ Database connected successfully
```

**Test it:**
Open browser and go to http://localhost:5000
You should see: `{"success": true, "message": "Laptop Refurbishment API"}`

---

## Step 3: Frontend Setup

### 3.1 Create React App

```bash
# Go back to project root
cd ..

# Create React app
npx create-react-app frontend

# Install additional dependencies
cd frontend
npm install react-router-dom axios lucide-react
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 3.2 Configure Tailwind CSS

Update `tailwind.config.js`:
```javascript
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Update `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### 3.3 Create API Service

Create `src/services/api.js`:
```javascript
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  getCurrentUser: () => api.get('/auth/me'),
};

export const ticketAPI = {
  getAll: (params) => api.get('/tickets', { params }),
  getMy: () => api.get('/tickets/my'),
  getById: (id) => api.get(`/tickets/${id}`),
  create: (data) => api.post('/tickets', data),
  update: (id, data) => api.put(`/tickets/${id}`, data),
  moveToNextStage: (id, data) => api.post(`/tickets/${id}/next-stage`, data),
  addNote: (id, data) => api.post(`/tickets/${id}/notes`, data),
  assign: (id, data) => api.post(`/tickets/${id}/assign`, data),
  addPart: (id, data) => api.post(`/tickets/${id}/parts`, data),
};

export const stageAPI = {
  getAll: () => api.get('/stages'),
  getChecklist: (id) => api.get(`/stages/${id}/checklist`),
};

export const teamAPI = {
  getAll: () => api.get('/teams'),
  getMembers: (id) => api.get(`/teams/${id}/members`),
};

export const partAPI = {
  getAll: () => api.get('/parts'),
  create: (data) => api.post('/parts', data),
  updateQuantity: (id, data) => api.put(`/parts/${id}/quantity`, data),
};

export const analyticsAPI = {
  getDashboard: () => api.get('/analytics/dashboard'),
  getTeamPerformance: () => api.get('/analytics/team-performance'),
};

export default api;
```

### 3.4 Create Auth Context

Create `src/context/AuthContext.jsx`:
```javascript
import React, { createContext, useState, useContext, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      loadUser();
    } else {
      setLoading(false);
    }
  }, [token]);

  const loadUser = async () => {
    try {
      const response = await authAPI.getCurrentUser();
      setUser(response.data.user);
    } catch (error) {
      console.error('Load user error:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await authAPI.login({ email, password });
    const { token, user } = response.data;
    localStorage.setItem('token', token);
    setToken(token);
    setUser(user);
    return response.data;
  };

  const register = async (userData) => {
    const response = await authAPI.register(userData);
    const { token, user } = response.data;
    localStorage.setItem('token', token);
    setToken(token);
    setUser(user);
    return response.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const value = {
    user,
    login,
    register,
    logout,
    loading,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
```

---

## Step 4: Testing Locally

### 4.1 Start Backend
```bash
# Terminal 1 - Backend
cd backend
npm run dev
```

### 4.2 Start Frontend
```bash
# Terminal 2 - Frontend
cd frontend
npm start
```

### 4.3 Test Login
1. Go to http://localhost:3000
2. Login with:
   - Email: `admin@refurb.com`
   - Password: `admin123`

---

## Step 5: Deployment (FREE)

### 5.1 Deploy Backend to Railway

1. **Push code to GitHub:**
```bash
cd backend
git init
git add .
git commit -m "Initial backend commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

2. **Deploy on Railway:**
   - Go to https://railway.app
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your backend repository
   - Add environment variables from your `.env` file
   - Railway will auto-deploy!
   - Copy your deployment URL (e.g., `https://your-app.railway.app`)

### 5.2 Deploy Frontend to Vercel

1. **Update API URL in frontend:**
Create `.env` in frontend folder:
```env
REACT_APP_API_URL=https://your-backend.railway.app/api
```

2. **Build and deploy:**
```bash
cd frontend
git init
git add .
git commit -m "Initial frontend commit"
git push to github
```

3. **Deploy on Vercel:**
   - Go to https://vercel.com
   - Sign in with GitHub
   - Import your frontend repository
   - Add environment variable: `REACT_APP_API_URL`
   - Deploy!

---

## API Documentation

### Authentication

**POST /api/auth/register**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "team_member",
  "team_id": 1
}
```

**POST /api/auth/login**
```json
{
  "email": "admin@refurb.com",
  "password": "admin123"
}
```

**GET /api/auth/me**
Headers: `Authorization: Bearer YOUR_TOKEN`

### Tickets

**POST /api/tickets** - Create ticket
**GET /api/tickets** - Get all tickets
**GET /api/tickets/my** - Get my tickets
**GET /api/tickets/:id** - Get ticket details
**PUT /api/tickets/:id** - Update ticket
**POST /api/tickets/:id/next-stage** - Move to next stage

### Others
- **GET /api/stages** - Get all stages
- **GET /api/teams** - Get all teams
- **GET /api/parts** - Get all parts
- **GET /api/analytics/dashboard** - Get dashboard stats

---

## Troubleshooting

### Database Connection Error
- Check your `.env` file has correct credentials
- Verify database is running on Railway/Supabase
- Check firewall settings

### CORS Error
- Make sure `FRONTEND_URL` in backend `.env` matches your frontend URL
- Check cors configuration in `server.js`

### Login Not Working
- Check if database has the admin user
- Verify password hash is correct
- Check JWT_SECRET is set

### Can't Access After Deployment
- Check environment variables are set on hosting platform
- View deployment logs for errors
- Make sure both frontend and backend are deployed

---

## 🎉 You're Done!

Your laptop refurbishment system is now live and accessible from anywhere!

**Default Login:**
- Email: `admin@refurb.com`
- Password: `admin123`

**IMPORTANT:** Change the admin password immediately after first login!

---

## Next Steps

1. Create team members and assign them to teams
2. Start creating tickets
3. Customize the workflow for your needs
4. Add more features as needed

Need help? Check the code comments or create an issue on GitHub!
