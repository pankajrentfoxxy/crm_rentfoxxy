# 🚀 QUICK START GUIDE - Copy & Paste These Commands!

## Prerequisites Check
```bash
node --version   # Need v18+
npm --version    # Need v9+
git --version    # Any version OK
```

If missing, install from:
- Node.js: https://nodejs.org
- Git: https://git-scm.com

---

## 📦 STEP 1: Setup Database (5 minutes)

### Go to Railway.app
1. Open https://railway.app in browser
2. Click "Login" → Sign in with GitHub
3. Click "New Project"
4. Select "Provision PostgreSQL"
5. Click on PostgreSQL box
6. Click "Connect" tab
7. Copy the credentials shown

### Run SQL Setup
1. Click "Query" tab
2. Copy ENTIRE contents of `backend/master_setup.sql`
3. Paste and click "Run"
4. Should see success messages

**✅ Database ready!**

---

## 🔧 STEP 2: Backend Setup (5 minutes)

```bash
# 1. Navigate to backend folder
cd laptop-refurbishment/backend

# 2. Install dependencies
npm install

# 3. Create .env file
# On Windows:
copy .env.example .env

# On Mac/Linux:
cp .env.example .env

# 4. Edit .env file with your Railway credentials
# Use Notepad/VSCode to open .env and fill in:
# - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD from Railway
# - Generate JWT_SECRET with this command:
```

### Generate JWT Secret (run this):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output and paste into JWT_SECRET in .env

### Start Backend
```bash
npm start
```

You should see:
```
🚀 Server running on port 5000
✅ Database connected successfully
```

**Leave this terminal open!**

**✅ Backend running!**

---

## 💻 STEP 3: Frontend Setup (5 minutes)

Open a NEW terminal window:

```bash
# 1. Navigate to frontend folder (from project root)
cd laptop-refurbishment/frontend

# 2. Install dependencies (will take 2-3 minutes)
npm install

# 3. Create .env file
# On Windows:
echo REACT_APP_API_URL=http://localhost:5000/api > .env

# On Mac/Linux:
echo "REACT_APP_API_URL=http://localhost:5000/api" > .env

# 4. Start frontend
npm start
```

Browser will automatically open at http://localhost:3000

**✅ Frontend running!**

---

## 🔑 STEP 4: First Login (1 minute)

1. Browser should show login page
2. Login with:
   - Email: `admin@refurb.com`
   - Password: `admin123`

**✅ You're in!**

---

## 🎯 STEP 5: Create Your First Ticket

1. Click "Create Ticket"
2. Fill in:
   - Serial Number: LAP001
   - Brand: Dell
   - Model: Latitude 5420
   - Condition: "Screen cracked, battery not charging"
3. Click "Create"

**✅ First ticket created!**

---

## 📱 STEP 6: Test on Mobile

1. Find your computer's local IP:
   ```bash
   # Windows:
   ipconfig
   # Look for "IPv4 Address"

   # Mac/Linux:
   ifconfig | grep inet
   # or
   ip addr show
   ```

2. On your phone browser, go to:
   `http://YOUR-IP-ADDRESS:3000`
   Example: `http://192.168.1.100:3000`

3. Login with same credentials

**✅ Works on mobile!**

---

## 🌐 DEPLOY TO INTERNET (15 minutes)

### Backend Deployment (Railway)

```bash
# 1. In backend folder, initialize git
cd backend
git init
git add .
git commit -m "Initial commit"

# 2. Create GitHub repository
# Go to github.com → New Repository → Name it "laptop-refurb-backend"

# 3. Push code
git remote add origin https://github.com/YOUR-USERNAME/laptop-refurb-backend.git
git push -u origin main

# 4. Deploy on Railway
# - Go to railway.app
# - New Project → Deploy from GitHub
# - Select your repository
# - Add environment variables (same as your .env)
# - Wait for deployment (~2 minutes)
# - Copy the URL shown (e.g., https://your-app.railway.app)
```

### Frontend Deployment (Vercel)

```bash
# 1. Update .env in frontend
# Change:
REACT_APP_API_URL=https://your-backend.railway.app/api

# 2. In frontend folder
cd ../frontend
git init
git add .
git commit -m "Initial commit"

# 3. Create GitHub repository
# Go to github.com → New Repository → Name it "laptop-refurb-frontend"

# 4. Push code
git remote add origin https://github.com/YOUR-USERNAME/laptop-refurb-frontend.git
git push -u origin main

# 5. Deploy on Vercel
# - Go to vercel.com
# - Sign in with GitHub
# - New Project → Import your frontend repository
# - Add environment variable: REACT_APP_API_URL=https://your-backend.railway.app/api
# - Deploy
# - You'll get a URL like: https://your-app.vercel.app
```

**✅ Live on internet! Share the Vercel URL with your team!**

---

## 🎨 Customization Ideas

### Change App Name
Edit `frontend/public/index.html` - change `<title>`

### Change Colors
Edit `frontend/src/App.css` - update color values

### Add More Teams
Run SQL in Railway Query tab:
```sql
INSERT INTO teams (team_name) VALUES ('Your New Team');
```

### Add Team Members
In your app, admin can:
1. Go to Settings
2. Click "Add User"
3. Fill in details

---

## 🐛 Common Issues & Fixes

### "Cannot connect to database"
- Check .env file has correct Railway credentials
- Check Railway database is running

### "CORS error"
- Make sure FRONTEND_URL in backend .env matches your frontend URL
- Restart backend server after changing .env

### "Port 5000 already in use"
- Change PORT in backend .env to 5001
- Update frontend .env to match

### "npm install fails"
- Delete node_modules folder
- Delete package-lock.json
- Run `npm install` again

### Can't login
- Check database has admin user
- Run this in Railway Query:
```sql
SELECT * FROM users WHERE email = 'admin@refurb.com';
```

---

## 📞 Need Help?

1. Check the COMPLETE_SETUP_GUIDE.md for detailed explanations
2. Check backend logs in terminal
3. Check browser console (F12) for errors
4. Check Railway logs in dashboard

---

## 🎉 You're All Set!

You now have a fully functional laptop refurbishment tracking system!

**What you can do:**
- ✅ Create and track tickets
- ✅ Assign work to team members
- ✅ Move tickets through stages
- ✅ Track parts inventory
- ✅ View analytics and reports
- ✅ Access from mobile devices
- ✅ Share with your entire team

**Next steps:**
1. Create team members
2. Assign them to teams
3. Start processing laptops!
4. Customize to fit your workflow

Enjoy your new system! 🚀
