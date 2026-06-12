# IRO REFORMER APP — REACT NATIVE
## Complete Claude Code Build Prompt + Full Setup Instructions
### Indian Republic Org | Political Organising Platform

---

# ═══════════════════════════════════════════
# PART 1: SETUP INSTRUCTIONS (Do this FIRST)
# ═══════════════════════════════════════════

## Prerequisites — Install These First

### Step 1: Install Node.js
Download from https://nodejs.org (choose LTS version)
Verify: open terminal → `node --version` → should show v18+

### Step 2: Install React Native CLI
```bash
npm install -g react-native-cli
npm install -g @react-native-community/cli
```

### Step 3: Install Android Studio
- Download from https://developer.android.com/studio
- During install, check: Android SDK, Android SDK Platform, Android Virtual Device
- After install → SDK Manager → SDK Platforms → install Android 14 (API 34)
- SDK Manager → SDK Tools → check: Android SDK Build-Tools, Android Emulator, Android SDK Platform-Tools

### Step 4: Set Environment Variables (Windows)
```
Search "Environment Variables" in Windows search
→ System Properties → Environment Variables

Add NEW System Variable:
  Name:  ANDROID_HOME
  Value: C:\Users\bibha\AppData\Local\Android\Sdk

Edit PATH → Add these:
  %ANDROID_HOME%\platform-tools
  %ANDROID_HOME%\emulator
  %ANDROID_HOME%\tools
  %ANDROID_HOME%\tools\bin
```

### Step 5: Create Android Emulator
```
Android Studio → Tools → Device Manager → Create Device
→ Phone → Pixel 7 → Next
→ API Level 34 (Android 14) → Download if needed → Next
→ Finish
```

### Step 6: Create the Project
```bash
cd C:\Users\bibha\Downloads
npx react-native init IRO --template react-native-template-typescript
cd IRO
```

### Step 7: Install All Dependencies
```bash
# Navigation
npm install @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
npm install react-native-screens react-native-safe-area-context

# UI & Animations
npm install react-native-reanimated react-native-gesture-handler
npm install react-native-linear-gradient
npm install react-native-vector-icons
npm install lottie-react-native
npm install react-native-skeleton-placeholder

# Maps
npm install react-native-maps

# Storage & State
npm install @reduxjs/toolkit react-redux
npm install @react-native-async-storage/async-storage
npm install react-native-mmkv
npm install redux-persist

# Network & API
npm install axios
npm install socket.io-client

# Forms & Validation
npm install react-hook-form
npm install zod @hookform/resolvers

# OTP & Phone
npm install react-native-otp-entry
npm install react-native-phone-number-input

# Camera & Media
npm install react-native-image-picker
npm install react-native-camera-roll

# Location & GPS
npm install @react-native-community/geolocation
npm install react-native-permissions

# Charts
npm install react-native-chart-kit
npm install react-native-svg

# Push Notifications
npm install @react-native-firebase/app
npm install @react-native-firebase/messaging

# Biometric
npm install react-native-biometrics

# Share & Clipboard
npm install react-native-share
npm install @react-native-clipboard/clipboard

# QR Code
npm install react-native-qrcode-svg

# Date & Time
npm install @react-native-community/datetimepicker
npm install dayjs

# Offline Sync
npm install @react-native-community/netinfo

# Image
npm install react-native-fast-image

# Haptics
npm install react-native-haptic-feedback

# Splash Screen
npm install react-native-splash-screen

# Fonts
npm install react-native-linear-gradient
```

### Step 8: Link Native Modules
```bash
cd android
./gradlew clean
cd ..
npx react-native link react-native-vector-icons
```

### Step 9: Add Fonts
Create folder: `android/app/src/main/assets/fonts/`

Download these from Google Fonts (fonts.google.com):
- Baloo2-Regular.ttf
- Baloo2-SemiBold.ttf
- Baloo2-Bold.ttf
- Nunito-Regular.ttf
- Nunito-Medium.ttf
- Nunito-SemiBold.ttf
- Nunito-Bold.ttf
- NotoSansDevanagari-Regular.ttf  (for Hindi)
- JetBrainsMono-Regular.ttf

Place ALL .ttf files in: `android/app/src/main/assets/fonts/`

Add to `react-native.config.js` (create if not exists):
```js
module.exports = {
  assets: ['./assets/fonts/'],
};
```

Then run: `npx react-native-asset`

### Step 10: Set Server IP
In `src/config/api.config.ts`:
```typescript
export const API_BASE_URL = 'http://187.77.187.213:4000/api';
export const SOCKET_URL   = 'http://187.77.187.213:4000';
```

### Step 11: Run the App
```bash
# Start Metro bundler (keep this running in one terminal)
npx react-native start

# In another terminal, run on Android
npx react-native run-android
```

---

# ═══════════════════════════════════════════
# PART 2: CLAUDE CODE BUILD PROMPT
# (Paste everything below into Claude Code)
# ═══════════════════════════════════════════

---

You are building **IRO Reformer** — the official React Native Android app for **Indian Republic Org (IRO)**, India's next-generation political-civic movement. Build this as a complete, production-ready application with every screen, every API call, every animation, and every interaction fully implemented.

This is NOT a prototype. Build every screen production-ready.

---

## 🎨 DESIGN SYSTEM

### Brand Colors
```typescript
// src/theme/colors.ts
export const Colors = {
  // Core Brand
  navy:           '#0F172A',   // primary background
  navyLight:      '#1E293B',   // cards, surfaces
  navyMedium:     '#334155',   // secondary cards, inputs
  saffron:        '#EA580C',   // ALL CTAs, active states, key numbers
  saffronLight:   '#F97316',   // saffron hover/gradient end
  saffronPale:    '#FFF7ED',   // saffron tint backgrounds
  slate:          '#F1F5F9',   // primary text on dark

  // Text
  textPrimary:    '#F1F5F9',
  textSecondary:  '#94A3B8',
  textMuted:      '#64748B',
  textDark:       '#0F172A',   // text on light backgrounds

  // Semantic
  success:        '#16A34A',
  successLight:   '#DCFCE7',
  warning:        '#F59E0B',
  warningLight:   '#FEF3C7',
  danger:         '#DC2626',
  dangerLight:    '#FEE2E2',
  info:           '#3B82F6',
  infoLight:      '#DBEAFE',

  // UI
  border:         '#1E293B',
  borderLight:    '#334155',
  overlay:        'rgba(0,0,0,0.6)',
  white:          '#FFFFFF',
  transparent:    'transparent',
};

export const Gradients = {
  hero:    ['#0F172A', '#1E293B'],
  saffron: ['#EA580C', '#F97316'],
  card:    ['#1E293B', '#334155'],
  success: ['#16A34A', '#15803D'],
  danger:  ['#DC2626', '#B91C1C'],
};
```

### Typography
```typescript
// src/theme/typography.ts
export const Typography = {
  fonts: {
    display:   'Baloo2-Bold',
    heading:   'Baloo2-SemiBold',
    body:      'Nunito-Regular',
    bodyMedium:'Nunito-Medium',
    bodySemi:  'Nunito-SemiBold',
    bodyBold:  'Nunito-Bold',
    mono:      'JetBrainsMono-Regular',
    hindi:     'NotoSansDevanagari-Regular',
  },
  sizes: {
    hero:      32,
    title:     24,
    heading:   20,
    subheading:16,
    body:      14,
    caption:   12,
    micro:     10,
  },
  lineHeights: {
    tight:  1.2,
    normal: 1.5,
    loose:  1.8,
  },
};
```

### Spacing & Radius
```typescript
// src/theme/spacing.ts
export const Spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 20, full: 999,
};
```

---

## 🏗️ PROJECT STRUCTURE

```
src/
├── api/
│   ├── client.ts           (Axios instance + interceptors)
│   ├── auth.api.ts
│   ├── user.api.ts
│   ├── referral.api.ts
│   ├── campaign.api.ts
│   ├── survey.api.ts
│   ├── task.api.ts
│   ├── election.api.ts
│   ├── event.api.ts
│   ├── analytics.api.ts
│   └── booth.api.ts
├── config/
│   └── api.config.ts       (BASE_URL, SOCKET_URL)
├── store/
│   ├── index.ts            (Redux store)
│   ├── auth.slice.ts
│   ├── user.slice.ts
│   ├── referral.slice.ts
│   └── sync.slice.ts       (offline queue)
├── screens/
│   ├── splash/
│   ├── welcome/
│   ├── auth/
│   │   ├── PhoneScreen.tsx
│   │   ├── OTPScreen.tsx
│   │   └── RegisterScreen.tsx  (5-step wizard)
│   ├── home/
│   │   ├── VolunteerHome.tsx
│   │   ├── BoothWorkerHome.tsx
│   │   ├── BlockLeaderHome.tsx
│   │   ├── DistrictLeaderHome.tsx
│   │   ├── StateLeaderHome.tsx
│   │   └── NationalHome.tsx
│   ├── network/
│   │   ├── ReferralTreeScreen.tsx
│   │   ├── LeaderboardScreen.tsx
│   │   └── ShareScreen.tsx
│   ├── tasks/
│   │   ├── TaskListScreen.tsx
│   │   └── TaskDetailScreen.tsx
│   ├── survey/
│   │   ├── SurveyListScreen.tsx
│   │   └── SurveyFormScreen.tsx
│   ├── elections/
│   │   ├── ElectionListScreen.tsx
│   │   ├── VotingScreen.tsx
│   │   └── ResultsScreen.tsx
│   ├── events/
│   │   ├── EventListScreen.tsx
│   │   └── EventDetailScreen.tsx
│   ├── warroom/
│   │   └── WarRoomScreen.tsx
│   ├── analytics/
│   │   └── AnalyticsScreen.tsx
│   ├── booth/
│   │   └── BoothScreen.tsx
│   ├── profile/
│   │   ├── ProfileScreen.tsx
│   │   └── ReformerCardScreen.tsx
│   └── notifications/
│       └── NotificationsScreen.tsx
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Avatar.tsx
│   │   ├── ProgressBar.tsx
│   │   ├── Shimmer.tsx
│   │   ├── MetricCard.tsx
│   │   ├── SectionHeader.tsx
│   │   └── EmptyState.tsx
│   ├── charts/
│   │   ├── LineChart.tsx
│   │   ├── BarChart.tsx
│   │   └── PieChart.tsx
│   ├── referral/
│   │   └── ReferralTree.tsx
│   └── map/
│       └── BoothMap.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useSocket.ts
│   ├── useOfflineSync.ts
│   └── useLocation.ts
├── navigation/
│   ├── AppNavigator.tsx
│   ├── AuthNavigator.tsx
│   └── MainNavigator.tsx    (Bottom tabs + Stack)
├── theme/
│   ├── colors.ts
│   ├── typography.ts
│   └── spacing.ts
├── types/
│   ├── auth.types.ts
│   ├── user.types.ts
│   ├── referral.types.ts
│   └── index.ts
└── utils/
    ├── storage.ts
    ├── format.ts
    └── validation.ts
```

---

## 🔌 API CLIENT

```typescript
// src/api/client.ts
import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import { storage } from '../utils/storage';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
apiClient.interceptors.request.use(async (config) => {
  const token = storage.getString('jwt_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 — auto logout
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      storage.delete('jwt_token');
      // Navigate to login
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

---

## 📱 NAVIGATION STRUCTURE

```typescript
// src/navigation/AppNavigator.tsx
// Root navigator — decides Auth vs Main based on token

// src/navigation/AuthNavigator.tsx
// Stack: Splash → Welcome → Phone → OTP → Register (5 steps)

// src/navigation/MainNavigator.tsx
// Bottom Tab Navigator with 5 tabs:
// Tab 1: Home (role-based)
// Tab 2: Network (Referral Tree + Leaderboard)
// Tab 3: Tasks (with badge count)
// Tab 4: Events
// Tab 5: Profile
// Plus Stack screens accessible from tabs
```

### Bottom Tab Bar Style
```typescript
// Custom tab bar — dark navy, saffron active indicator
tabBarStyle: {
  backgroundColor: Colors.navy,
  borderTopColor: Colors.border,
  borderTopWidth: 1,
  height: 64,
  paddingBottom: 8,
  paddingTop: 4,
},
tabBarActiveTintColor: Colors.saffron,
tabBarInactiveTintColor: Colors.textMuted,
// Custom indicator: 3px saffron underline on active tab
```

---

## 📲 SCREENS — BUILD ALL FULLY

---

### SCREEN 1: SPLASH SCREEN
```
File: src/screens/splash/SplashScreen.tsx

Design:
- Full screen background: Colors.navy (#0F172A)
- Center: IRO flame logo SVG (custom, saffron colored)
  - Logo animates: scale 0.5 → 1.0 with spring (duration 800ms)
  - Opacity 0 → 1 (duration 600ms)
- Below logo: "IRO" in Baloo2-Bold 48sp Colors.saffron, letter-spacing 8
- Below: "INDIAN REPUBLIC ORG" in Nunito-Medium 13sp Colors.textSecondary
  letter-spacing 4, margin-top 4
- Below: thin saffron horizontal line (width 40, height 1.5)
- Below: "Join. Refer. Lead. Reform." in Nunito-Regular 14sp Colors.textMuted
- Bottom: version "v1.0" in Colors.textMuted 11sp
- Subtle pulsing ring around logo: Animated opacity 0.3→0.7→0.3 loop

Logic:
- useEffect on mount:
  - Check AsyncStorage for 'jwt_token'
  - If token exists: verify with GET /api/auth/me
    - Success → navigate to MainNavigator (role-based home)
    - Fail (401) → clear token → navigate to Welcome
  - If no token → 2.5s delay → navigate to Welcome
- Total display: minimum 2.5 seconds
```

---

### SCREEN 2: WELCOME SCREEN
```
File: src/screens/welcome/WelcomeScreen.tsx

Design:
- Background: LinearGradient Colors.navy → Colors.navyLight, vertical
- Top 60% of screen:
  - Large IRO emblem (SVG) centered, 120×120
  - Animated glowing saffron ring around emblem (Animated.loop)
  - "भारत बदलेगा" in Baloo2-Bold 36sp Colors.white, text-center, margin-top 24
  - "Be a Reformer. Build the movement." in Nunito-Regular 16sp Colors.textSecondary
    text-center, margin-top 8, padding-horizontal 32
- 3 floating feature pills (staggered animation — slide up from bottom with 100ms delay each):
    "🌐  Real-time Network"
    "📊  Data-Driven Strategy"
    "🗳️  Democratic Leadership"
  Each pill: background Colors.navyLight, border 1px Colors.border,
  border-radius 999, padding 8 16, Nunito-Medium 13sp Colors.textSecondary

- Bottom sheet (always visible, not a real sheet):
  Padding 32, background transparent
  [JOIN AS REFORMER] — LinearGradient saffron, border-radius 14,
    padding 16, Nunito-Bold 16sp white, full width
    onPress → navigate to PhoneScreen with {mode: 'register'}
  
  [I ALREADY HAVE AN ACCOUNT] — marginTop 12, no background,
    border 1px Colors.saffron, border-radius 14, padding 16,
    Nunito-SemiBold 16sp Colors.saffron, full width
    onPress → navigate to PhoneScreen with {mode: 'login'}

  Bottom: "IRO • Indian Republic Org" in Colors.textMuted 11sp, text-center
```

---

### SCREEN 3: PHONE SCREEN
```
File: src/screens/auth/PhoneScreen.tsx

Design:
- Background: Colors.navy
- Back arrow top-left (if mode=login)
- Progress indicator (mode=register): "Step 1 of 5" dots row
  Active dot: saffron 8px circle. Inactive: navyLight 6px circle
- Centered content:
  - Phone icon (SVG, 64px, saffron)
  - "What's your number?" in Baloo2-Bold 28sp Colors.white, margin-top 16
  - "We'll send you a one-time password" in Nunito-Regular 15sp Colors.textSecondary
    margin-top 8, text-center
  - margin-top 40
  - Phone input row:
      Country code badge "+91" in navyLight box, Baloo2-Bold 18sp saffron, padding 16 12
      Phone number TextInput: background navyLight, border-radius 12,
      padding 16, Baloo2-Bold 22sp white, flex 1, keyboardType='numeric', maxLength=10
      Focus state: 1.5px saffron border
  - Error text in Colors.danger 13sp, margin-top 6 (if invalid)
  - margin-top 32
  - [GET OTP] button: LinearGradient saffron, full width, border-radius 14, padding 16
    Nunito-Bold 16sp white
    Disabled state: opacity 0.4
    Loading state: ActivityIndicator white

API:
  POST /api/auth/otp/request { phone: '+91XXXXXXXXXX' }
  On success → navigate to OTPScreen with {phone, mode}
  On error → show error toast
```

---

### SCREEN 4: OTP SCREEN
```
File: src/screens/auth/OTPScreen.tsx

Design:
- Background: Colors.navy
- Back arrow top-left
- Progress: "Step 2 of 5" (register mode)
- Center:
  - SMS icon SVG 64px saffron
  - "Enter OTP" in Baloo2-Bold 28sp white
  - "Sent to +91 XXXXX XXXXX" in Nunito-Regular 15sp textSecondary, margin-top 8
  - margin-top 40
  - 6-box OTP input using react-native-otp-entry:
      Each box: 54×54, background navyLight, border-radius 12
      Empty border: 1.5px Colors.border
      Active border: 1.5px Colors.saffron with saffron glow shadow
      Filled: Baloo2-Bold 24sp white
  - margin-top 24
  - Countdown: "Resend in 0:45" in Nunito-Regular 14sp textSecondary
    When 0: "Resend OTP" in saffron, tappable
  - margin-top 40
  - [VERIFY OTP] button: saffron gradient, full width
    Auto-triggers when all 6 digits entered

API:
  POST /api/auth/otp/verify { phone, otp }
  On success:
    - Store JWT in MMKV storage as 'jwt_token'
    - Store user object as 'current_user'
    - If mode='login' → navigate to MainNavigator
    - If mode='register' → navigate to RegisterScreen Step 3
```

---

### SCREEN 5: REGISTRATION WIZARD (Steps 3-5)
```
File: src/screens/auth/RegisterScreen.tsx

This is a single screen with internal step state (step 3, 4, 5 of the 5-step flow)

== STEP 3: Personal Details ==
Progress: "Step 3 of 5"
Header: "Tell us about yourself" in Baloo2-Bold 26sp white

Fields (each in dark card with navyLight background, border-radius 12, padding 16, margin-bottom 12):

Full Name:
  Label: "Full Name *" in Nunito-Medium 12sp textSecondary
  TextInput: Nunito-Regular 16sp white, no border, flex
  
Date of Birth:
  Label: "Date of Birth *"
  Pressable row → opens DateTimePicker
  Shows selected date or "Select date" placeholder
  
Gender (chip selector row):
  [Male] [Female] [Other]
  Each chip: border-radius 999, padding 10 20
  Selected: saffron background, white text
  Unselected: navyLight bg, textSecondary text

Occupation (dropdown):
  Options: Student | Farmer | Business | Service/Job | Professional | Other
  Custom dropdown: tapping opens Modal with option list

Education (dropdown):
  Options: Below 10th | 10th Pass | 12th Pass | Graduate | Post Graduate | PhD

[NEXT →] button at bottom: saffron gradient, full width

== STEP 4: Your Location ==
Progress: "Step 4 of 5"
Header: "Where are you from?" in Baloo2-Bold 26sp white
Subtext: "This connects you with your local IRO network"

Cascading dropdowns (each auto-populated from JSON data):
  State → District → Block/Taluka → Village/Ward
  
  Each selector: navyLight card, chevron right icon, saffron
  Selected value shown in Baloo2-SemiBold 16sp white
  Unselected: "Select [State/District...]" in textMuted

[Use My Location 📍] button:
  - Outline style, saffron border
  - Calls Geolocation.getCurrentPosition()
  - Reverse geocodes to fill State/District/Block
  - Shows "Location detected ✓" in success color

[NEXT →] button: saffron gradient

== STEP 5: Referral & Welcome ==
Progress: "Step 5 of 5"
Header: "Almost there!" in Baloo2-Bold 26sp white

Referral code input:
  Label: "Referral Code (optional)"
  Pre-filled if came via deep link
  TextInput: navyLight bg, Nunito-Regular 16sp white, UPPERCASE
  OR: "Find by name" toggle — shows search input → shows matching user card

[SKIP - Join Without Referral] link: textMuted, center

[JOIN IRO →] button: saffron gradient, full width
  onPress → calls POST /api/auth/register with all collected data
  Loading state: ActivityIndicator

On success:
  - Confetti animation (Lottie saffron/white/green confetti json)
  - "Welcome to IRO, [Name]! 🔥" fullscreen celebration card
  - Show Reformer ID card preview
  - [GO TO MY DASHBOARD] button after 3 seconds

API:
  POST /api/auth/register {
    name, dob, gender, phone, state, district, block,
    village, pincode, occupation, education, referralCode
  }
```

---

### SCREEN 6: HOME DASHBOARDS (Role-Based)

#### 6A: VOLUNTEER / REFORMER HOME
```
File: src/screens/home/VolunteerHome.tsx

Top Bar:
  Left: IRO logo (small, 32px)
  Center: "जय IRO 🔥" in Nunito-SemiBold 16sp saffron
  Right: Bell icon with red dot badge (unread count)
  Background: Colors.navy

ScrollView content (background Colors.navy, padding 16):

1. WELCOME CARD (LinearGradient navy→navyLight, border-radius 16, padding 20):
   Row: Avatar (48px circle saffron bg with initials) | "Jai IRO, [Name]!" Baloo2-Bold 22sp white
   Row below: Role badge "REFORMER" in saffron pill + State name in textMuted
   margin-top 16:
   Large metric: "[47]" in Baloo2-Bold 48sp Colors.saffron
   Label: "Reformers in your network" in Nunito-Regular 14sp textSecondary
   ProgressBar: saffron fill, 6px height, border-radius 999
   "53 more → 🏅 Bronze Badge" in Nunito-Regular 12sp textMuted, margin-top 6

2. LIVE COUNTER CARD (navyLight bg, border-radius 14, padding 16, margin-top 12):
   Row: pulsing green dot (8px) + "LIVE" in success 11sp Nunito-Medium
   "8,42,391" in Baloo2-Bold 36sp white (animated count-up on mount)
   "Total IRO Reformers" in Nunito-Regular 13sp textSecondary
   "+1,247 joined today" in success 13sp, arrow up icon

3. QUICK ACTIONS (4 icon chips in a row, margin-top 12):
   [📤 Share] [📋 Survey] [✅ Tasks] [🎪 Events]
   Each: navyLight bg, border-radius 12, padding 12 8, flex 1, centered
   Icon 24px above, label Nunito-Medium 11sp textSecondary

4. MY STATS GRID (2×2, margin-top 12, gap 8):
   Card 1: "12" in Baloo2-Bold 28sp saffron | "Direct Referrals" in textSecondary
   Card 2: "#247" in Baloo2-Bold 28sp info | "National Rank" in textSecondary
   Card 3: "🔥 12" in Baloo2-Bold 28sp warning | "Day Streak" in textSecondary
   Card 4: "4.7" in Baloo2-Bold 28sp success | "Survey Score" in textSecondary
   Each card: navyLight bg, border-radius 12, padding 14, centered

5. TODAY'S TASK CARD (navyLight bg, saffron left border 3px, border-radius 12, padding 16):
   "📋 TODAY'S TASK" in saffron 11sp Nunito-SemiBold, letter-spacing 1
   Task title in white 15sp Nunito-Medium, margin-top 4
   "Due: 6:00 PM" in textMuted 12sp
   [DO NOW →] button: small saffron outline, border-radius 8, right side

6. LATEST ANNOUNCEMENT (navyLight, border-radius 12, padding 16):
   "📢 ANNOUNCEMENT" badge in info
   Announcement text in white 14sp
   Timestamp in textMuted 12sp

7. CONTENT TO SHARE CARD (navyLight, border-radius 12, padding 16):
   "📱 SHARE NOW" badge in saffron
   Content preview text in white 14sp
   "3,421 Reformers shared" in textSecondary 12sp
   [SHARE →] button: saffron gradient, border-radius 10, padding 10 20

Real-time:
   - Connect Socket.io on mount
   - Listen to 'total_reformers' event → update live counter with animated count-up
   - Disconnect on unmount
```

#### 6B: BOOTH LEVEL WORKER HOME
```
File: src/screens/home/BoothWorkerHome.tsx

Additional sections compared to Volunteer:

BOOTH CARD (saffron gradient header):
  "MY BOOTH" label in white 11sp
  "Booth #B-247 | Sector 12, [District]" in Baloo2-Bold 20sp white
  Row: [Total Voters 800] [IRO Members 127] [Coverage 47%]
  Circular progress ring (saffron, 80px): 47% in center Baloo2-Bold 24sp

DAILY TASKS CHECKLIST (navyLight card):
  Title: "Today's Tasks" + "[3/5 done]" in saffron
  Each task row: checkbox (custom saffron) | task label | XP badge
  Completed: strikethrough, success color checkbox
  Swipe right to complete (react-native-gesture-handler)

BOOTH ALERTS (danger left border card, if any):
  "⚠️ 2 inactive Reformers — tap to reach out"
  List of inactive Reformers with [CALL] button

MY AREA REFORMERS (horizontal ScrollView):
  "Reformers Near Me" section header
  Each: Avatar circle 44px | Name below | Join date
```

#### 6C-6H: DISTRICT+ LEADER DASHBOARDS
```
District Leader (src/screens/home/DistrictLeaderHome.tsx):
  - Summary row: 3 MetricCards (Total Reformers | Booths Covered | Tasks Done %)
  - Bar chart (react-native-chart-kit): Block-wise reformer count, saffron bars
  - Influencer list: Top 5 connectors in district
  - Growth line chart: Last 30 days, saffron line
  - Weak booths alert list with [ASSIGN] buttons

State + National: Aggregate the above by jurisdiction
Party President: Full "God View" — national map + all states drilldown
```

---

### SCREEN 7: NETWORK SCREEN (3 Tabs)

```
File: src/screens/network/

TabView with 3 tabs (saffron underline indicator):

== TAB 1: MY TREE ==
File: ReferralTreeScreen.tsx

Visual Referral Tree using react-native-svg:
  - Me: Large saffron circle 64px, white initials, Baloo2-Bold
  - Level 1 referrals: 48px navy circles with saffron border, avatars
  - Level 2: 36px circles
  - Connecting lines: saffron, 1.5px, animated path drawing on mount
  - Tap any node → slide-up mini profile card:
      Name | Location | Join Date | "Referred by you" label
      [WhatsApp] [Call] buttons
  - Pan & zoom enabled (react-native-gesture-handler)

Bottom sheet:
  "You've brought 12 Reformers directly"
  "Your extended network: 47 total"
  Progress bar to next milestone

== TAB 2: LEADERBOARD ==
File: LeaderboardScreen.tsx

Filter rows:
  Row 1: [National] [My State] [My District] [My Block] — chip selector, saffron active
  Row 2: [This Week] [This Month] [All Time]

Top 3 Podium (custom SVG podium):
  🥇 Gold: Large card, saffron border, avatar 56px
  🥈 Silver: Medium card, slate border, avatar 48px
  🥉 Bronze: Medium card, saffron100 border, avatar 48px
  Each shows: Name, State, referral count (Baloo2-Bold saffron)

FlatList (positions 4+):
  Each row: rank | avatar | name + state | count | ↑↓ change arrow
  Alternating: navy / navyLight backgrounds
  My rank: sticky bottom bar "You are ranked #247 nationally" in navyLight card

API: GET /api/referral/leaderboard?level=national&period=month

== TAB 3: SHARE ==
File: ShareScreen.tsx

My QR Code (react-native-qrcode-svg):
  White background card, 200×200 QR
  IRO logo watermark in center of QR
  "IRO-UP-00247" below in JetBrainsMono-Regular 16sp

"My Referral Code" row:
  "IRO-XXXXX" in JetBrainsMono-Bold 22sp saffron
  [Copy 📋] button → Clipboard + haptic feedback

Share buttons (2×2 grid):
  [📱 WhatsApp] → react-native-share with pre-written message
  [💬 SMS]      → SMS with short link
  [📋 Copy Link]→ Clipboard
  [📷 Save QR]  → Save QR image to gallery

WhatsApp message (copy-paste ready):
  "नमस्ते! मैं IRO का सदस्य हूँ — भारत बदलने का एक आंदोलन।\n
  मेरे link से join करें और Reformer बनें 🔥\n
  https://iro.in/join?ref=IRO-XXXXX"
```

---

### SCREEN 8: TASKS SCREEN

```
File: src/screens/tasks/TaskListScreen.tsx

Tab bar: [Today] [Upcoming] [Completed]

Each task card (navyLight bg, border-radius 14, padding 16, margin-bottom 10):
  Top row: Priority badge (HIGH=red/MEDIUM=amber/LOW=green) | Type icon | Due time countdown
  Title: Nunito-SemiBold 16sp white
  "Assigned by: [Name] — [Role]" in textSecondary 12sp
  Bottom row: XP reward badge | [VIEW] button in saffron outline
  
  Swipe right → Complete (green overlay "✓ Done!" + haptic)
  Swipe left → View Details

Task type icons (24px saffron):
  📍 FIELD | 📋 SURVEY | 📢 SHARE | 📞 CALL | 🎪 EVENT

FAB (bottom right, for leaders):
  Saffron circle 56px, "+" white 24sp
  Tap → navigate to CreateTaskScreen

File: src/screens/tasks/TaskDetailScreen.tsx
  Full task description
  Map view (if location-based, 200px height embedded map)
  [Submit Proof] section:
    Photo: [Take Photo 📷] → ImagePicker → thumbnail preview
    GPS: auto-captured, shows "📍 Location: [address]"
    Notes: multiline TextInput
  [MARK AS DONE] button: saffron gradient, full width

API:
  GET /api/tasks?status=pending
  PATCH /api/tasks/:id/complete { proof_photo_url, gps_lat, gps_lng, notes }
```

---

### SCREEN 9: SURVEY SCREEN

```
File: src/screens/survey/SurveyListScreen.tsx

Survey cards:
  Color-coded by type:
    PULSE: blue left border
    BOOTH: saffron left border
    CANDIDATE: purple left border
    ISSUE: red left border
  Title | Deadline countdown | "+75 XP" badge | [START] button

File: src/screens/survey/SurveyFormScreen.tsx

Single question per screen (slide transition between questions):
  Progress bar top: saffron fill, Nunito-Regular 12sp textSecondary "Q 3 of 8"
  
  Question types:
  
  SINGLE_CHOICE:
    Large radio option chips (full width, navyLight bg, border-radius 12, padding 16)
    Selected: saffron background + white checkmark circle right
    Tap → auto-advance 300ms after selection
  
  MULTI_CHOICE:
    Checkbox chips (same style)
    Custom checkbox: saffron square with checkmark when selected
    [NEXT] button appears after any selection
  
  RATING_5:
    5 star icons (64px total row)
    Tap star → fills saffron, haptic feedback
    Stars animate (scale 1→1.3→1) on selection
  
  RATING_10:
    Horizontal slider (saffron thumb, navyLight track, saffron fill)
    Large number display: Baloo2-Bold 48sp saffron, centered
  
  TEXT:
    Multiline TextInput: navyLight bg, border-radius 12, padding 16
    white text, Nunito-Regular 15sp
    Character count bottom-right in textMuted
  
  PHOTO:
    [📷 Take Photo] button: saffron outline
    After capture: thumbnail 120×90 preview with [Remove ×] overlay
  
  GPS_LOCATION:
    Auto-captured on question load
    Shows: "📍 Location captured" in success, address below
    OR: "📍 Tap to capture location" if not auto

Offline support:
  Store responses in AsyncStorage with key 'pending_surveys'
  Show "Saved offline, will sync when connected" banner when no internet
  useNetInfo() to detect connection → sync on reconnect

Completion screen:
  Lottie confetti animation (saffron/white/green)
  "+75 XP Earned!" in Baloo2-Bold 36sp saffron
  "Thank you for your contribution!" in Nunito-Regular 16sp white
  [BACK TO HOME] button
```

---

### SCREEN 10: INTERNAL ELECTIONS

```
File: src/screens/elections/ElectionListScreen.tsx

Active Elections (saffron header banner if any exist):
  "🗳️ VOTE NOW — Elections Open" in saffron, animated pulse

Each election card:
  ACTIVE: saffron border, "VOTE NOW" badge
  UPCOMING: info border, "STARTS IN X DAYS"
  CLOSED: muted, "RESULTS"

  Title: "Block Leader Election — Sector 12"
  Level badge: BOOTH / BLOCK / DISTRICT (color-coded)
  Deadline: large countdown timer (HH:MM:SS for active)
  Jurisdiction: "For Reformers in your Block"

File: src/screens/elections/VotingScreen.tsx

Header: "Cast Your Vote" | Deadline countdown top-right

Election info card (navyLight, padding 16):
  What this election is for, jurisdiction explanation

Candidates (ScrollView, each in navyLight card border-radius 14 padding 16 margin-bottom 10):
  Row: Avatar 56px | Name Baloo2-SemiBold 18sp | Role badge | Location
  
  Stats row (3 columns):
    "124" Baloo2-Bold saffron | "Referrals" textSecondary 11sp
    "92%" Baloo2-Bold success  | "Activity" textSecondary 11sp
    "4.7" Baloo2-Bold info     | "Survey Score" textSecondary 11sp
  
  Leadership Score bar (saffron fill, label above):
    "Leadership Score: 78/100"
  
  [VIEW PROFILE] text button in saffron

  Selection: tap card → saffron border 2px + checkmark overlay top-right
  Only one candidate selectable at a time

[CONFIRM VOTE] button (saffron gradient, full width):
  Disabled until candidate selected
  Tap → BiometricPrompt (fingerprint/face) for confirmation
  On biometric success → POST /api/elections/:id/vote { candidateId }
  
Success state:
  Full-screen navy overlay
  "✓ Vote Cast!" in Baloo2-Bold 36sp success
  Timestamp in textSecondary
  Confetti animation

File: src/screens/elections/ResultsScreen.tsx

Live results (updates via WebSocket 'election_update' event):
  Each candidate: avatar | name | vote bar (horizontal, saffron fill)
  Vote percentage: Baloo2-Bold 20sp right of bar
  
  Winner (if declared):
    Large animated saffron banner: "🏆 ELECTED"
    Candidate photo large, name, role
    Confetti on results declaration

API:
  GET /api/elections — list
  GET /api/elections/:id — detail with candidates
  POST /api/elections/:id/vote { candidateId }
  GET /api/elections/:id/results
```

---

### SCREEN 11: EVENTS SCREEN

```
File: src/screens/events/EventListScreen.tsx

Filter chips (horizontal scroll): [All] [National] [State] [District] [Block]

UPCOMING EVENTS:
Each event card (navyLight, border-radius 14, overflow hidden):
  Banner image: 180px height, react-native-fast-image
  Level badge overlay (top-left): NATIONAL=red / STATE=blue / DISTRICT=saffron
  Padding 16:
  Title: Nunito-SemiBold 16sp white
  Date row: 📅 "Sat, 15 June • 10:00 AM" in textSecondary 13sp
  Location row: 📍 "Ramlila Maidan, Delhi" in textSecondary 13sp
  Bottom row: Avatar stack (5 attendees) + "1,247 attending" | [RSVP] button
  
  RSVP button states:
    Default: saffron outline "RSVP"
    RSVP'd: saffron filled "✓ Going"

File: src/screens/events/EventDetailScreen.tsx

  Hero banner image: 240px
  Level badge overlay
  Title Baloo2-Bold 24sp white, padding 16
  
  Info cards row (3 MetricCards):
    Date | Time | Expected Attendees
  
  Location card (navyLight, border-radius 12):
    Address text
    Embedded MapView: 160px height, marker at venue
    [Open in Maps] button
  
  Speakers/Organiser section
  
  Attendees: Avatar stack + count
  
  [RSVP / I'M GOING] button: saffron gradient, full width
  
  When event is LIVE (within 2h of start time):
    Red pulsing "LIVE NOW" banner replaces RSVP
    [I'M HERE — CHECK IN 📍] button: shows QR scanner to scan venue QR
    
  Post-event:
    [VIEW PHOTOS] button → photo gallery grid
    [GIVE FEEDBACK] button → 3-question quick survey modal

API:
  GET /api/events
  POST /api/events/:id/rsvp
  POST /api/events/:id/checkin { qr_code }
```

---

### SCREEN 12: WAR ROOM SCREEN

```
File: src/screens/warroom/WarRoomScreen.tsx

Header: "📡 War Room" in Baloo2-Bold 22sp white
"Content Hub & Rapid Response"

RAPID RESPONSE SECTION (only if active):
  Red pulsing border card:
    "🚨 URGENT — Share This NOW"
    Topic text in white 16sp
    "Posted 12 minutes ago" in textMuted
    [SHARE NOW] button: danger gradient, full width, large

CONTENT FEED (FlatList, refreshable):
  Each content card (navyLight, border-radius 14, overflow hidden):
    Thumbnail: 200px height banner (image/video preview)
    Platform badges row: [📸 Insta] [🐦 Twitter] [💬 WhatsApp] [📘 FB]
    Caption preview: 2 lines, white 14sp
    "3,421 Reformers shared" in textSecondary 12sp
    Share count progress bar (saffron, vs. target)
    
    [SHARE NOW →] button: saffron gradient, border-radius 10, padding 12
    Tap → react-native-share with pre-built ShareContent
    On share: +10 XP animation, haptic feedback

CONTENT CALENDAR (collapsible section):
  Today's drops: "9 AM ✓" | "1 PM →" | "7 PM 🔔"
  Each: thumbnail + caption preview
  [Remind me] toggle per slot → local notification scheduled

MY STATS:
  "You've shared 47 posts this month" in white
  "🔥 12-day sharing streak" in saffron
```

---

### SCREEN 13: ANALYTICS SCREEN (District Leader+)

```
File: src/screens/analytics/AnalyticsScreen.tsx

Show only if user.role in ['district_leader','state_leader','national_exec','president']

Time filter: [7D] [30D] [90D] — chip row, saffron active

OVERVIEW TAB:
Metric cards (2×2 grid):
  Total Reformers | Growth Rate % | Active % | Booth Coverage %

Growth chart (react-native-chart-kit LineChart):
  saffron line, navy background, white labels
  Shows daily new Reformers for selected period

Geography breakdown (FlatList):
  Each area: name | reformer count | progress bar | growth arrow

INTELLIGENCE TAB:
SWING ZONES (amber cards):
  "⚡ These areas need attention"
  List of booth names with [ASSIGN WORKER] buttons

GROWTH HOTSPOTS (success cards):
  "🔥 Explosive growth here"
  Top 5 areas with highest referral velocity

DEAD ZONES (danger cards):
  "💀 Zero activity — intervene now"
  List with [ASSIGN] quick action

TOP INFLUENCERS:
  FlatList: Avatar | Name | Network size | Location | [MESSAGE] button

API:
  GET /api/analytics/scores
  GET /api/analytics/influencers
  GET /api/public/stats
```

---

### SCREEN 14: PROFILE + REFORMER ID CARD

```
File: src/screens/profile/ProfileScreen.tsx

HEADER (LinearGradient navy→navyLight):
  Avatar: 80px circle, saffron ring 3px, initials or photo
  Tap avatar → ImagePicker → upload to backend
  Name: Baloo2-Bold 24sp white
  Reformer ID: "IRO-UP-00247" JetBrainsMono 14sp textSecondary
  Role badge + State

STATS ROW (3 columns):
  Referrals | Network | Tasks Done
  Each: Baloo2-Bold 22sp saffron, label textSecondary 12sp

LEADERSHIP SCORE (navyLight card, border-radius 14, padding 16):
  "Leadership Score" label + info icon
  Circular progress ring (100px, saffron): score/100 in center
  Sub-scores: Referrals | Activity | Survey | Peer
  Each: small progress bar + score

ACHIEVEMENTS (navyLight card):
  "My Badges" header
  4-column grid of badges:
    Earned: full color + name below
    Unearned: grayscale + lock overlay
  Badges: 🌱 Joined | ✅ First Task | 📋 First Survey | 🎪 First Event
          🔟 10 Club | 💯 100 Club | 🌐 Network Star | 🔥 Streak | etc.

[VIEW MY REFORMER CARD 🪪] button: saffron gradient, full width, margin-top 16

SETTINGS section:
  [Language] [Notification Preferences] [Privacy] [Logout]

---

File: src/screens/profile/ReformerCardScreen.tsx

Full-screen portrait card (capture as PNG using react-native-view-shot):

Card design (320×480 container):
  Background: LinearGradient navy → navyLight
  Top strip: thin tricolor bar (saffron-white-green, 3px each)
  IRO logo top-left (40px) | "INDIAN REPUBLIC ORG" top-right
  "REFORMER" in Nunito-Medium 12sp saffron, letter-spacing 3, centered, margin-top 8
  Avatar circle: 80px, saffron ring, centered, margin-top 12
  Name: Baloo2-Bold 24sp white, centered
  Reformer ID: JetBrainsMono 14sp textSecondary, centered
  State: Nunito-Regular 14sp textSecondary, centered
  Join date: "Reformer since Jan 2025" in textMuted 12sp
  QR code: 80×80, bottom-right corner
  Bottom strip: tricolor bar again

[📤 SHARE MY CARD] button below card:
  Captures card as PNG (react-native-view-shot)
  Opens share sheet
  
[💾 SAVE TO GALLERY] button:
  Saves PNG to device gallery
```

---

### SCREEN 15: NOTIFICATIONS

```
File: src/screens/notifications/NotificationsScreen.tsx

[Mark all read] button top-right in saffron

Grouped sections: Today | Yesterday | Earlier

Each notification (navyLight card, border-radius 10, padding 14, margin-bottom 6):
  Left: type icon circle (24px, colored by type)
  Center: title (Nunito-SemiBold 14sp white) | body 2-line (textSecondary 13sp) 
  Right: time (textMuted 11sp) | unread dot (saffron 8px)
  Unread state: saffron left border 3px
  
  Tap → deep link to relevant screen (election, task, event, etc.)
  Swipe left to dismiss

Notification type icons + colors:
  🔥 Referral joined → saffron
  ✅ Task update → success
  🗳️ Election → info
  📋 Survey → warning
  🚨 Urgent → danger
  🏆 Milestone → gold (#F59E0B)
  🎪 Event → teal (#0D9488)
  📢 Announcement → navy (info border)

Empty state:
  Bell illustration (SVG, 80px, textMuted)
  "All caught up!" in Nunito-SemiBold 18sp white
  "No new notifications" in textSecondary 14sp

FCM Setup:
  Request permission on first app launch (graceful dialog)
  Subscribe to topics: 'national', 'state_{stateId}', 'district_{districtId}', 'role_{role}'
  On FCM message received → add to local notifications list
  On notification tap → navigate to relevant screen
```

---

## 🔄 REDUX STATE MANAGEMENT

```typescript
// src/store/auth.slice.ts
interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  error: string | null;
}

// src/store/user.slice.ts
interface UserState {
  profile: UserProfile | null;
  referralStats: ReferralStats | null;
  leadershipScore: LeadershipScore | null;
  badges: Badge[];
}

// src/store/sync.slice.ts
interface SyncState {
  pendingSurveyResponses: SurveyResponse[];
  pendingTaskCompletions: TaskCompletion[];
  isOnline: boolean;
  lastSyncedAt: string | null;
}
```

---

## 📶 OFFLINE STRATEGY

```typescript
// src/hooks/useOfflineSync.ts
// Monitor network state with @react-native-community/netinfo
// On connection restored: flush pending survey responses, task completions
// Show offline banner: "📡 Offline — responses saved, will sync when connected"
// All reads: try API first, fall back to AsyncStorage cache
// All writes: save to AsyncStorage queue → sync when online
```

---

## 🎬 ANIMATIONS (ALL REQUIRED)

```typescript
// Use react-native-reanimated for all animations

1. Splash logo: useSharedValue + withSpring (scale 0.3→1)
2. Welcome pills: FadeInDown with 100ms stagger delay each
3. OTP boxes: withSpring on focus (slight scale 1→1.05)
4. Progress bars: withTiming 800ms on mount
5. Number counters: custom interpolation 0→target over 1200ms (all dashboards)
6. Referral tree: SVG path drawing animation (strokeDashoffset)
7. Card appear: FadeInDown stagger in FlatLists (50ms per item)
8. Leaderboard podium: spring scale from 0 on mount, staggered
9. Election results bar: withTiming on results load
10. Shimmer loading: Animated.loop + LinearGradient for skeleton screens
11. FAB: withSpring scale 0→1 on mount
12. Confetti: Lottie animation (saffron/white/green json)
13. Tab switch: sliding indicator withTiming
14. Bottom sheet: withSpring translateY
15. Swipe actions: interpolation on swipe gesture
```

---

## 🔐 SECURITY

```typescript
// Token: react-native-mmkv (encrypted storage, NOT AsyncStorage for auth)
import { MMKV } from 'react-native-mmkv';
const storage = new MMKV({ id: 'iro-secure', encryptionKey: 'iro-aes-key' });

// Biometric: react-native-biometrics for vote confirmation
// Root detection: warn user on rooted device
// Certificate pinning: axios adapter with pinned certificate
// Screenshot prevention: on sensitive screens (analytics, booth data)
//   use react-native-prevent-screenshot
```

---

## 🌐 MULTILINGUAL

```typescript
// i18n: react-i18next
// Languages: hi (default), en, pa, ta, te, bn, mr, gu, kn, ml
// All UI strings in translation JSON files
// Language selector in Profile → Settings
// Persisted in MMKV storage
// Push notification content: sent by backend in user's language
```

---

## 🏆 GAMIFICATION

```typescript
// XP System:
const XP_REWARDS = {
  register:         100,
  completeProfile:   50,
  directReferral:   200,
  completeTask:      50, // up to 200 based on priority
  submitSurvey:      75,
  attendEvent:      100,
  shareContent:      10,
  dailyLogin:         5,
};

// Show XP animation on earn:
// Floating "+75 XP" text animates up and fades over 1.5s
// Haptic feedback: HapticFeedback.trigger('notificationSuccess')
```

---

## 🚀 BUILD & RUN COMMANDS

```bash
# Development
npx react-native start          # Start Metro bundler
npx react-native run-android    # Run on Android emulator/device

# Build release APK
cd android
./gradlew assembleRelease
# APK at: android/app/build/outputs/apk/release/app-release.apk

# Build release AAB (for Play Store)
./gradlew bundleRelease
# AAB at: android/app/build/outputs/bundle/release/app-release.aab
```

---

## 📋 BUILD ORDER FOR CLAUDE CODE

Build in this exact order:

1. `src/theme/` — colors, typography, spacing
2. `src/config/api.config.ts` — set server IP
3. `src/api/client.ts` — Axios with interceptors
4. `src/utils/storage.ts` — MMKV wrapper
5. `src/types/` — all TypeScript interfaces
6. `src/components/ui/` — Button, Card, Badge, Avatar, MetricCard, ProgressBar, Shimmer
7. `src/navigation/` — full navigation structure
8. `src/screens/splash/` + `src/screens/welcome/` — Splash + Welcome
9. `src/screens/auth/` — Phone + OTP + Register (all 5 steps)
10. `src/store/` — Redux slices
11. `src/screens/home/VolunteerHome.tsx` — first role dashboard
12. `src/screens/network/` — Referral tree, Leaderboard, Share
13. `src/screens/tasks/` — Task list + detail
14. `src/screens/survey/` — Survey list + form
15. `src/screens/profile/` — Profile + Reformer ID card
16. `src/screens/elections/` — Election list, voting, results
17. `src/screens/events/` — Events list + detail
18. `src/screens/warroom/` — War room
19. `src/screens/analytics/` — Analytics (leaders only)
20. `src/screens/notifications/` — Notifications
21. Remaining role dashboards: BoothWorker, BlockLeader, District, State, National, President
22. `src/hooks/useOfflineSync.ts` — offline sync
23. FCM push notification setup
24. i18n multilingual setup

---

## 🎯 MVP (Run this first to demo)

Build only these 7 screens for the first working demo:
1. Splash
2. Welcome
3. Phone + OTP
4. Registration (all 5 steps)
5. Volunteer Home Dashboard
6. Referral + Share screen
7. Profile + Reformer ID Card

These 7 give you a fully working, shareable demo to show party leadership.

---

*App Name: IRO Reformer*
*Bundle ID: com.iro.reformer*
*Backend: http://187.77.187.213:4000/api*
*GitHub: https://github.com/pankajrentfoxxy/iro*
*Tech: React Native + TypeScript + Redux Toolkit + Reanimated + MMKV*
*Design: Deep Navy #0F172A | Saffron #EA580C | Dark War Room Aesthetic*
*Target: Android (API 24+) | Future: iOS same codebase*
