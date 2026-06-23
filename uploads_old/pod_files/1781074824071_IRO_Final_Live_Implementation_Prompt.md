# IRO REFORMER APP — FINAL PRODUCTION PROMPT
## Make Everything Live: Frontend + Backend + Database
### Repos: github.com/pankajrentfoxxy/iro_app_react_native + github.com/pankajrentfoxxy/iro/tree/main/server

---

## ⚠️ CRITICAL CONTEXT — READ FIRST

This is an **Expo Router** app (NOT plain React Native CLI).
- Run with: `npx expo start` → scan QR with Expo Go
- NO `gradlew`, NO `adb`, NO Android Studio needed for development
- Backend: Node.js/Express/PostgreSQL/Prisma at `http://[PC_IP]:4000/api`
- Frontend repo: `iro_app_react_native` (Expo + TypeScript)
- Backend repo: `iro/server` (Node.js + Prisma)

You are implementing ALL features to make the app fully live and dynamic. Every screen must connect to real APIs. No mocks. No static data.

---

## 📋 TASK LIST (Do in this exact order)

---

# PART 1: BACKEND — DATABASE MIGRATION

## Step 1: Read existing schema
Open `iro/server/prisma/schema.prisma` and read every model carefully.

## Step 2: Add ALL missing tables

Add these models to `schema.prisma` (keep all existing models, only ADD):

```prisma
// ─── REFERRAL TREE ────────────────────────────────────────────────────────
// Already exists: User.referredById → User (self-relation)
// Verify these fields exist on User model, ADD if missing:
// referredById   String?
// referredBy     User?    @relation("Referrals", fields: [referredById], references: [id])
// referrals      User[]   @relation("Referrals")
// directCount    Int      @default(0)   ← count of direct referrals
// networkCount   Int      @default(0)   ← count of full tree (all levels)

// ─── LEADERSHIP SCORE ────────────────────────────────────────────────────
model LeadershipScore {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  referralScore   Float    @default(0)
  activityScore   Float    @default(0)
  surveyScore     Float    @default(0)
  taskScore       Float    @default(0)
  peerRating      Float    @default(0)
  totalScore      Float    @default(0)
  updatedAt       DateTime @updatedAt
}

// ─── BOOTHS ──────────────────────────────────────────────────────────────
model Booth {
  id              String   @id @default(cuid())
  boothNumber     String   // Election Commission booth number
  name            String
  stateId         String
  districtId      String
  blockId         String
  totalVoters     Int      @default(0)
  sentiment       String   @default("NEUTRAL") // STRONG/NEUTRAL/WEAK/OPPOSITION
  assignedUserId  String?
  assignedUser    User?    @relation("BoothWorker", fields: [assignedUserId], references: [id])
  reformerCount   Int      @default(0)
  coveragePercent Float    @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  surveys         Survey[]
  issues          BoothIssue[]
}

model BoothIssue {
  id          String   @id @default(cuid())
  boothId     String
  booth       Booth    @relation(fields: [boothId], references: [id])
  reportedBy  String
  reporter    User     @relation("IssueReporter", fields: [reportedBy], references: [id])
  type        String   // WATER/ROAD/POWER/EMPLOYMENT/HEALTH/OTHER
  description String
  photoUrl    String?
  gpsLat      Float?
  gpsLng      Float?
  status      String   @default("REPORTED") // REPORTED/IN_PROGRESS/RESOLVED
  createdAt   DateTime @default(now())
}

// ─── SURVEYS ─────────────────────────────────────────────────────────────
model Survey {
  id          String           @id @default(cuid())
  title       String
  type        String           // PULSE/BOOTH/CANDIDATE/ISSUE/OPPOSITION
  questions   Json
  targetRole  String?          // null = all roles
  boothId     String?
  booth       Booth?           @relation(fields: [boothId], references: [id])
  dueDate     DateTime?
  xpReward    Int              @default(75)
  isActive    Boolean          @default(true)
  createdAt   DateTime         @default(now())
  responses   SurveyResponse[]
}

model SurveyResponse {
  id          String   @id @default(cuid())
  surveyId    String
  survey      Survey   @relation(fields: [surveyId], references: [id])
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  answers     Json
  gpsLat      Float?
  gpsLng      Float?
  submittedAt DateTime @default(now())
  synced      Boolean  @default(true)
}

// ─── TASKS ────────────────────────────────────────────────────────────────
model Task {
  id           String   @id @default(cuid())
  title        String
  description  String?
  type         String   // FIELD/SURVEY/SHARE/CALL/EVENT
  priority     String   @default("MEDIUM") // HIGH/MEDIUM/LOW
  assignedToId String
  assignedTo   User     @relation("TaskAssignee", fields: [assignedToId], references: [id])
  assignedById String
  assignedBy   User     @relation("TaskAssigner", fields: [assignedById], references: [id])
  dueDate      DateTime?
  status       String   @default("PENDING") // PENDING/IN_PROGRESS/DONE
  proofPhotoUrl String?
  gpsLat       Float?
  gpsLng       Float?
  xpReward     Int      @default(100)
  completedAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// ─── ELECTIONS ───────────────────────────────────────────────────────────
model Election {
  id              String      @id @default(cuid())
  title           String
  description     String?
  level           String      // BOOTH/BLOCK/DISTRICT/STATE/NATIONAL
  jurisdictionId  String      // stateId/districtId/blockId/boothId
  startDate       DateTime
  endDate         DateTime
  status          String      @default("UPCOMING") // UPCOMING/OPEN/CLOSED/RESULTS_DECLARED
  createdAt       DateTime    @default(now())
  nominees        Nominee[]
  votes           Vote[]
}

model Nominee {
  id          String   @id @default(cuid())
  electionId  String
  election    Election @relation(fields: [electionId], references: [id])
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  statement   String?  // "Why I should lead"
  status      String   @default("PENDING") // PENDING/APPROVED/REJECTED
  createdAt   DateTime @default(now())
}

model Vote {
  id          String   @id @default(cuid())
  electionId  String
  election    Election @relation(fields: [electionId], references: [id])
  voterId     String
  voter       User     @relation("VoteCaster", fields: [voterId], references: [id])
  candidateId String
  candidate   User     @relation("VoteReceiver", fields: [candidateId], references: [id])
  castAt      DateTime @default(now())

  @@unique([electionId, voterId]) // one vote per person per election
}

// ─── EVENTS ───────────────────────────────────────────────────────────────
model Event {
  id              String          @id @default(cuid())
  title           String
  description     String?
  level           String          // NATIONAL/STATE/DISTRICT/BLOCK
  jurisdictionId  String
  date            DateTime
  endDate         DateTime?
  venueAddress    String
  venueGpsLat     Float?
  venueGpsLng     Float?
  bannerUrl       String?
  expectedCount   Int             @default(0)
  createdById     String
  createdBy       User            @relation("EventCreator", fields: [createdById], references: [id])
  createdAt       DateTime        @default(now())
  attendees       EventAttendee[]
}

model EventAttendee {
  id          String   @id @default(cuid())
  eventId     String
  event       Event    @relation(fields: [eventId], references: [id])
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  rsvpAt      DateTime @default(now())
  checkedIn   Boolean  @default(false)
  checkinAt   DateTime?

  @@unique([eventId, userId])
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────
model Notification {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  type        String   // REFERRAL/TASK/ELECTION/SURVEY/EVENT/ANNOUNCEMENT/URGENT/BADGE
  title       String
  body        String
  deepLink    String?  // route to open on tap
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
}

// ─── XP & BADGES ─────────────────────────────────────────────────────────
model UserXP {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id])
  totalXP     Int      @default(0)
  level       Int      @default(1)
  streak      Int      @default(0)
  lastLoginAt DateTime?
  updatedAt   DateTime @updatedAt
}

model Badge {
  id          String      @id @default(cuid())
  key         String      @unique // JOINED/FIRST_TASK/TEN_CLUB/etc.
  name        String
  description String
  icon        String
  earnedBy    UserBadge[]
}

model UserBadge {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  badgeId   String
  badge     Badge    @relation(fields: [badgeId], references: [id])
  earnedAt  DateTime @default(now())

  @@unique([userId, badgeId])
}

// ─── SOCIAL CONTENT / WAR ROOM ────────────────────────────────────────────
model SocialContent {
  id          String   @id @default(cuid())
  title       String
  captionHindi String?
  captionEnglish String?
  mediaUrl    String?
  mediaType   String   @default("IMAGE") // IMAGE/VIDEO/TEXT
  platforms   String[] // ["whatsapp","instagram","twitter","facebook"]
  scheduledAt DateTime?
  isUrgent    Boolean  @default(false)
  shareCount  Int      @default(0)
  createdAt   DateTime @default(now())
  shares      ContentShare[]
}

model ContentShare {
  id        String   @id @default(cuid())
  contentId String
  content   SocialContent @relation(fields: [contentId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  sharedAt  DateTime @default(now())
  platform  String?
}
```

## Step 3: Update User model — add ALL missing fields

Ensure the `User` model has these fields (add what's missing):
```prisma
model User {
  // ... existing fields ...

  // Hierarchy & Location
  role            String    @default("volunteer")
  // role values: volunteer|booth_worker|block_leader|district_leader|
  //              regional_leader|state_leader|national_exec|president

  stateId         String?
  districtId      String?
  blockId         String?
  villageId       String?
  pincode         String?

  // Profile
  dob             DateTime?
  gender          String?
  occupation      String?
  education       String?
  profilePhotoUrl String?
  reformerId      String?   @unique // IRO-UP-00001

  // Referral tree
  referredById    String?
  referredBy      User?     @relation("Referrals", fields: [referredById], references: [id])
  referrals       User[]    @relation("Referrals")
  directCount     Int       @default(0)
  networkCount    Int       @default(0)

  // Relations to new models
  leadershipScore LeadershipScore?
  boothAssigned   Booth[]          @relation("BoothWorker")
  boothIssues     BoothIssue[]     @relation("IssueReporter")
  surveyResponses SurveyResponse[]
  tasksAssigned   Task[]           @relation("TaskAssignee")
  tasksCreated    Task[]           @relation("TaskAssigner")
  nominees        Nominee[]
  votescast       Vote[]           @relation("VoteCaster")
  votesReceived   Vote[]           @relation("VoteReceiver")
  eventsCreated   Event[]          @relation("EventCreator")
  eventAttendance EventAttendee[]
  notifications   Notification[]
  xp              UserXP?
  badges          UserBadge[]
  contentShares   ContentShare[]
}
```

## Step 4: Run migration
```bash
cd iro/server
npx prisma migrate dev --name "add_full_phase1_schema"
npx prisma generate
```

---

# PART 2: BACKEND — NEW API ROUTES

Add these route files in `iro/server/src/routes/`:

## 2.1 Referral Routes (`referral.routes.ts`)

```typescript
// GET /api/referral/tree
// Returns 3-level referral tree for current user
router.get('/tree', auth, async (req, res) => {
  const userId = req.user.id;

  // Fetch user + direct referrals + their referrals (3 levels)
  const me = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      referrals: {
        include: {
          referrals: {
            include: {
              referrals: true
            }
          }
        }
      }
    }
  });

  // Calculate direct and network counts
  const directCount = me.referrals.length;
  let networkCount = directCount;
  me.referrals.forEach(l1 => {
    networkCount += l1.referrals.length;
    l1.referrals.forEach(l2 => {
      networkCount += l2.referrals.length;
    });
  });

  // Update counts in DB
  await prisma.user.update({
    where: { id: userId },
    data: { directCount, networkCount }
  });

  res.json({ me, directCount, networkCount });
});

// GET /api/referral/leaderboard?level=national&period=month&state=&district=&block=
router.get('/leaderboard', auth, async (req, res) => {
  const { level = 'national', period = 'month', state, district, block } = req.query;

  let where: any = {};
  if (level === 'state' && state) where.stateId = state;
  if (level === 'district' && district) where.districtId = district;
  if (level === 'block' && block) where.blockId = block;

  const users = await prisma.user.findMany({
    where,
    orderBy: { directCount: 'desc' },
    take: 100,
    select: {
      id: true, name: true, stateId: true, districtId: true,
      directCount: true, networkCount: true, profilePhotoUrl: true, reformerId: true
    }
  });

  // Find my rank
  const myRank = users.findIndex(u => u.id === req.user.id) + 1;

  res.json({ leaderboard: users, myRank, total: users.length });
});

// GET /api/referral/stats — my referral stats
router.get('/stats', auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { directCount: true, networkCount: true, reformerId: true }
  });
  res.json(user);
});
```

## 2.2 User Stats Route (`users.routes.ts` — add to existing)

```typescript
// GET /api/users/me/stats — comprehensive stats for home dashboard
router.get('/me/stats', auth, async (req, res) => {
  const userId = req.user.id;

  const [user, xp, badges, tasks, surveys] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, role: true, stateId: true, districtId: true,
        blockId: true, directCount: true, networkCount: true,
        reformerId: true, profilePhotoUrl: true
      }
    }),
    prisma.userXP.findUnique({ where: { userId } }),
    prisma.userBadge.count({ where: { userId } }),
    prisma.task.count({ where: { assignedToId: userId, status: 'DONE' } }),
    prisma.surveyResponse.count({ where: { userId } }),
  ]);

  res.json({ user, xp, badgeCount: badges, tasksCompleted: tasks, surveysSubmitted: surveys });
});

// GET /api/users/live-count — total reformers (for live counter)
router.get('/live-count', async (req, res) => {
  const count = await prisma.user.count();
  res.json({ count });
});
```

## 2.3 Tasks Routes (`tasks.routes.ts`)

```typescript
// GET /api/tasks — my tasks
router.get('/', auth, async (req, res) => {
  const { status, type } = req.query;
  const where: any = { assignedToId: req.user.id };
  if (status) where.status = status;
  if (type) where.type = type;

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
    include: { assignedBy: { select: { name: true, role: true } } }
  });
  res.json(tasks);
});

// PATCH /api/tasks/:id/complete
router.patch('/:id/complete', auth, async (req, res) => {
  const { proofPhotoUrl, gpsLat, gpsLng } = req.body;
  const task = await prisma.task.update({
    where: { id: req.params.id, assignedToId: req.user.id },
    data: { status: 'DONE', proofPhotoUrl, gpsLat, gpsLng, completedAt: new Date() }
  });

  // Award XP
  await prisma.userXP.upsert({
    where: { userId: req.user.id },
    update: { totalXP: { increment: task.xpReward } },
    create: { userId: req.user.id, totalXP: task.xpReward }
  });

  res.json(task);
});

// POST /api/tasks — create task (leaders only)
router.post('/', auth, requireRole(['block_leader','district_leader','state_leader','national_exec','president']), async (req, res) => {
  const task = await prisma.task.create({
    data: { ...req.body, assignedById: req.user.id }
  });
  res.json(task);
});
```

## 2.4 Survey Routes (`surveys.routes.ts`)

```typescript
// GET /api/surveys — surveys assigned to me
router.get('/', auth, async (req, res) => {
  const surveys = await prisma.survey.findMany({
    where: {
      isActive: true,
      OR: [{ targetRole: null }, { targetRole: req.user.role }]
    },
    include: {
      _count: { select: { responses: true } }
    }
  });

  // Mark which ones current user has completed
  const myResponses = await prisma.surveyResponse.findMany({
    where: { userId: req.user.id },
    select: { surveyId: true }
  });
  const completedIds = new Set(myResponses.map(r => r.surveyId));

  const result = surveys.map(s => ({ ...s, completed: completedIds.has(s.id) }));
  res.json(result);
});

// POST /api/surveys/:id/respond
router.post('/:id/respond', auth, async (req, res) => {
  const { answers, gpsLat, gpsLng } = req.body;

  const response = await prisma.surveyResponse.create({
    data: { surveyId: req.params.id, userId: req.user.id, answers, gpsLat, gpsLng }
  });

  // Award XP
  const survey = await prisma.survey.findUnique({ where: { id: req.params.id } });
  await prisma.userXP.upsert({
    where: { userId: req.user.id },
    update: { totalXP: { increment: survey?.xpReward ?? 75 } },
    create: { userId: req.user.id, totalXP: survey?.xpReward ?? 75 }
  });

  res.json(response);
});

// POST /api/surveys/batch — offline sync batch submit
router.post('/batch', auth, async (req, res) => {
  const { responses } = req.body; // array of { surveyId, answers, gpsLat, gpsLng }
  const created = await prisma.surveyResponse.createMany({
    data: responses.map((r: any) => ({ ...r, userId: req.user.id })),
    skipDuplicates: true
  });
  res.json({ synced: created.count });
});
```

## 2.5 Elections Routes (`elections.routes.ts`)

```typescript
// GET /api/elections — elections in my jurisdiction
router.get('/', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const elections = await prisma.election.findMany({
    where: {
      OR: [
        { jurisdictionId: user.stateId ?? '' },
        { jurisdictionId: user.districtId ?? '' },
        { jurisdictionId: user.blockId ?? '' },
      ]
    },
    include: {
      nominees: { include: { user: { select: { name: true, profilePhotoUrl: true, directCount: true } } } },
      _count: { select: { votes: true } }
    },
    orderBy: { startDate: 'desc' }
  });
  res.json(elections);
});

// POST /api/elections/:id/nominate — self-nomination
router.post('/:id/nominate', auth, async (req, res) => {
  // Check eligibility (50+ direct referrals)
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (user.directCount < 50) {
    return res.status(403).json({ error: 'Need 50+ direct referrals to nominate' });
  }

  const nominee = await prisma.nominee.create({
    data: { electionId: req.params.id, userId: req.user.id, statement: req.body.statement }
  });
  res.json(nominee);
});

// POST /api/elections/:id/vote
router.post('/:id/vote', auth, async (req, res) => {
  const { candidateId } = req.body;
  try {
    const vote = await prisma.vote.create({
      data: { electionId: req.params.id, voterId: req.user.id, candidateId }
    });
    res.json(vote);
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Already voted' });
    throw e;
  }
});

// GET /api/elections/:id/results
router.get('/:id/results', auth, async (req, res) => {
  const votes = await prisma.vote.groupBy({
    by: ['candidateId'],
    where: { electionId: req.params.id },
    _count: { candidateId: true }
  });

  const candidates = await prisma.user.findMany({
    where: { id: { in: votes.map(v => v.candidateId) } },
    select: { id: true, name: true, profilePhotoUrl: true, directCount: true }
  });

  const results = votes.map(v => ({
    ...candidates.find(c => c.id === v.candidateId),
    voteCount: v._count.candidateId
  })).sort((a, b) => b.voteCount - a.voteCount);

  res.json(results);
});
```

## 2.6 Events Routes (`events.routes.ts`)

```typescript
// GET /api/events
router.get('/', auth, async (req, res) => {
  const { level } = req.query;
  const events = await prisma.event.findMany({
    where: level ? { level: level as string } : {},
    orderBy: { date: 'asc' },
    include: {
      _count: { select: { attendees: true } },
      attendees: { where: { userId: req.user.id }, take: 1 }
    }
  });

  const result = events.map(e => ({
    ...e,
    rsvpd: e.attendees.length > 0,
    attendeeCount: e._count.attendees,
    attendees: undefined,
    _count: undefined
  }));
  res.json(result);
});

// POST /api/events/:id/rsvp
router.post('/:id/rsvp', auth, async (req, res) => {
  const rsvp = await prisma.eventAttendee.upsert({
    where: { eventId_userId: { eventId: req.params.id, userId: req.user.id } },
    update: {},
    create: { eventId: req.params.id, userId: req.user.id }
  });
  res.json(rsvp);
});
```

## 2.7 Notifications Routes (`notifications.routes.ts`)

```typescript
// GET /api/notifications
router.get('/', auth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  res.json(notifications);
});

// PATCH /api/notifications/read-all
router.patch('/read-all', auth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true }
  });
  res.json({ ok: true });
});
```

## 2.8 Analytics Routes (`analytics.routes.ts` — add to existing)

```typescript
// GET /api/analytics/dashboard — for leaders
router.get('/dashboard', auth, requireRole(['block_leader','district_leader','state_leader','national_exec','president']), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  // Filter by jurisdiction based on role
  let where: any = {};
  if (user.role === 'block_leader') where.blockId = user.blockId;
  if (user.role === 'district_leader') where.districtId = user.districtId;
  if (user.role === 'state_leader') where.stateId = user.stateId;

  const [totalReformers, tasksCompleted, surveysSubmitted] = await Promise.all([
    prisma.user.count({ where }),
    prisma.task.count({ where: { status: 'DONE', assignedTo: where } }),
    prisma.surveyResponse.count({ where: { user: where } }),
  ]);

  // Growth trend: last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const growthData = await prisma.$queryRaw`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM users
    WHERE created_at >= ${thirtyDaysAgo}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  res.json({ totalReformers, tasksCompleted, surveysSubmitted, growthData });
});
```

## 2.9 Update Auth Routes — fix registration to set reformerId and role

In the existing register endpoint, add after user creation:
```typescript
// Generate Reformer ID
const stateCode = user.stateId?.substring(0, 2).toUpperCase() ?? 'IN';
const sequence = String(await prisma.user.count()).padStart(5, '0');
const reformerId = `IRO-${stateCode}-${sequence}`;

await prisma.user.update({
  where: { id: user.id },
  data: { reformerId, role: 'volunteer' }
});

// Create XP record
await prisma.userXP.create({
  data: { userId: user.id, totalXP: 100 } // registration bonus
});

// If referralCode provided, link the tree
if (referralCode) {
  const referrer = await prisma.user.findUnique({ where: { reformerId: referralCode } });
  if (referrer) {
    await prisma.user.update({
      where: { id: user.id },
      data: { referredById: referrer.id }
    });
    // Increment referrer's direct count
    await prisma.user.update({
      where: { id: referrer.id },
      data: { directCount: { increment: 1 } }
    });
    // Recalculate network counts up the chain (async job)
    // Use BullMQ to queue: updateNetworkCounts(referrer.id)
  }
}
```

## 2.10 Socket.io — Live Counter

In your existing Socket.io setup, emit total count on new registration:
```typescript
// After successful registration
const totalCount = await prisma.user.count();
io.emit('total_reformers', { count: totalCount });
```

---

# PART 3: REFERRAL TREE LOGIC — VERIFY & FIX

## The Correct Logic for Direct vs Network Count:

```
DIRECT COUNT = users who used MY referral code to register (1 level deep)
NETWORK COUNT = direct + their direct + their direct's direct (all levels deep)

Example:
  Me → refers A, B, C          (direct = 3)
  A  → refers D, E             
  B  → refers F               
  C  → refers G, H, I          
  D  → refers J               

  My direct count = 3 (A, B, C)
  My network count = 9 (A,B,C,D,E,F,G,H,I,J) — all descendants
```

## Recalculate network count recursively:

```typescript
// BullMQ worker: updateNetworkCounts.worker.ts
async function getNetworkCount(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { referrals: true }
  });

  if (!user || user.referrals.length === 0) return 0;

  let count = user.referrals.length;
  for (const referral of user.referrals) {
    count += await getNetworkCount(referral.id);
  }
  return count;
}

// Call this and update up the chain when new user joins
async function updateNetworkCountsUpChain(userId: string) {
  let current = await prisma.user.findUnique({ where: { id: userId } });
  while (current?.referredById) {
    const networkCount = await getNetworkCount(current.referredById);
    await prisma.user.update({
      where: { id: current.referredById },
      data: { networkCount }
    });
    current = await prisma.user.findUnique({ where: { id: current.referredById } });
  }
}
```

## Top-Level User Referring Someone to a Role:

```typescript
// POST /api/referral/assign-role
// Only president/national_exec can directly assign someone a role
router.post('/assign-role', auth, requireRole(['president', 'national_exec', 'state_leader']), async (req, res) => {
  const { userId, role, jurisdictionId } = req.body;

  // Validate the role assignment is within caller's jurisdiction
  const caller = await prisma.user.findUnique({ where: { id: req.user.id } });

  // president can assign any role
  // state_leader can assign up to district_leader in their state
  // national_exec can assign state_leader and below

  const allowedRoles: Record<string, string[]> = {
    'president':      ['national_exec', 'state_leader', 'regional_leader', 'district_leader', 'block_leader', 'booth_worker', 'volunteer'],
    'national_exec':  ['state_leader', 'regional_leader', 'district_leader', 'block_leader', 'booth_worker'],
    'state_leader':   ['district_leader', 'block_leader', 'booth_worker'],
  };

  const allowed = allowedRoles[caller.role] ?? [];
  if (!allowed.includes(role)) {
    return res.status(403).json({ error: 'Cannot assign this role level' });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role }
  });

  // Send notification to the promoted user
  await prisma.notification.create({
    data: {
      userId,
      type: 'ANNOUNCEMENT',
      title: 'Role Updated',
      body: `You have been assigned the role: ${role}`,
      deepLink: '/profile'
    }
  });

  res.json(updated);
});
```

---

# PART 4: FRONTEND — CONNECT ALL SCREENS TO LIVE APIs

## 4.1 Update `src/config/api.config.ts`

```typescript
import Constants from 'expo-constants';

// Auto-detect PC IP from Expo's hostUri (works with Expo Go on same WiFi)
const hostUri = Constants.expoConfig?.hostUri;
const host = hostUri ? hostUri.split(':').shift() : '187.77.187.213';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? `http://${host}:4000/api`;
export const SOCKET_URL   = process.env.EXPO_PUBLIC_API_BASE_URL?.replace('/api', '') ?? `http://${host}:4000`;
```

## 4.2 Update `src/api/client.ts`

```typescript
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/api.config';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('jwt_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.multiRemove(['jwt_token', 'current_user']);
      // Navigate to welcome — import router here or use event emitter
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

## 4.3 Add all API service files

Create `src/api/referral.api.ts`:
```typescript
import apiClient from './client';

export const getReferralTree = () => apiClient.get('/referral/tree');
export const getLeaderboard = (params: any) => apiClient.get('/referral/leaderboard', { params });
export const getReferralStats = () => apiClient.get('/referral/stats');
```

Create `src/api/tasks.api.ts`:
```typescript
import apiClient from './client';

export const getTasks = (params?: any) => apiClient.get('/tasks', { params });
export const completeTask = (id: string, data: any) => apiClient.patch(`/tasks/${id}/complete`, data);
export const createTask = (data: any) => apiClient.post('/tasks', data);
```

Create `src/api/surveys.api.ts`:
```typescript
import apiClient from './client';

export const getSurveys = () => apiClient.get('/surveys');
export const submitSurveyResponse = (id: string, data: any) => apiClient.post(`/surveys/${id}/respond`, data);
export const batchSyncSurveys = (responses: any[]) => apiClient.post('/surveys/batch', { responses });
```

Create `src/api/elections.api.ts`:
```typescript
import apiClient from './client';

export const getElections = () => apiClient.get('/elections');
export const nominateSelf = (id: string, statement: string) => apiClient.post(`/elections/${id}/nominate`, { statement });
export const castVote = (id: string, candidateId: string) => apiClient.post(`/elections/${id}/vote`, { candidateId });
export const getElectionResults = (id: string) => apiClient.get(`/elections/${id}/results`);
```

Create `src/api/events.api.ts`:
```typescript
import apiClient from './client';

export const getEvents = (level?: string) => apiClient.get('/events', { params: { level } });
export const rsvpEvent = (id: string) => apiClient.post(`/events/${id}/rsvp`);
```

Create `src/api/notifications.api.ts`:
```typescript
import apiClient from './client';

export const getNotifications = () => apiClient.get('/notifications');
export const markAllRead = () => apiClient.patch('/notifications/read-all');
```

Create `src/api/users.api.ts`:
```typescript
import apiClient from './client';

export const getMyStats = () => apiClient.get('/users/me/stats');
export const getLiveCount = () => apiClient.get('/users/live-count');
export const assignRole = (userId: string, role: string) => apiClient.post('/referral/assign-role', { userId, role });
```

## 4.4 Update Home Dashboard (`src/screens/home/VolunteerHomeScreen.tsx`)

Connect to real APIs:
```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getMyStats, getLiveCount } from '../../api/users.api';
import { SOCKET_URL } from '../../config/api.config';

export default function VolunteerHomeScreen() {
  const [stats, setStats] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch stats
    getMyStats().then(r => {
      setStats(r.data);
      setLoading(false);
    });

    // Fetch initial live count
    getLiveCount().then(r => setLiveCount(r.data.count));

    // Connect Socket.io for live updates
    const socket = io(SOCKET_URL);
    socket.on('total_reformers', (data) => setLiveCount(data.count));

    return () => { socket.disconnect(); };
  }, []);

  // Render with real stats.user, stats.xp, stats.directCount etc.
  // Replace ALL hardcoded numbers with real data
  // Show loading shimmer while loading=true
}
```

## 4.5 Update Referral Tree (`src/screens/network/ReferralTreeScreen.tsx`)

```typescript
import { getReferralTree } from '../../api/referral.api';

// On mount: fetch real tree data
useEffect(() => {
  getReferralTree().then(r => {
    setTreeData(r.data.me);
    setDirectCount(r.data.directCount);
    setNetworkCount(r.data.networkCount);
  });
}, []);

// Render SVG tree from real data
// Me (center saffron node)
// r.data.me.referrals (level 1 nodes)
// r.data.me.referrals[i].referrals (level 2 nodes)
// r.data.me.referrals[i].referrals[j].referrals (level 3 nodes)
```

## 4.6 Update Login Flow

The login is already dynamic per your note. Verify these are wired:
- `POST /api/auth/otp/request` → called on phone submit
- `POST /api/auth/otp/verify` → called on OTP submit → saves JWT + user to AsyncStorage + Redux
- Role extracted from user response → routes to correct home screen

Add role-based routing after login:
```typescript
// After successful OTP verify
const { token, user } = response.data;
await AsyncStorage.setItem('jwt_token', token);
await AsyncStorage.setItem('current_user', JSON.stringify(user));
dispatch(setCredentials({ token, user }));

// Route based on role
const roleRoutes: Record<string, string> = {
  'volunteer':        '/home',
  'booth_worker':     '/home',
  'block_leader':     '/home',
  'district_leader':  '/home',
  'state_leader':     '/home',
  'national_exec':    '/home',
  'president':        '/home',
};
// All go to /home but home screen reads role from Redux and renders different dashboard
router.replace(roleRoutes[user.role] ?? '/home');
```

## 4.7 Add Network Connectivity & Offline Sync

Create `src/hooks/useOfflineSync.ts`:
```typescript
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { batchSyncSurveys } from '../api/surveys.api';

export function useOfflineSync() {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      if (state.isConnected) {
        // Sync pending surveys
        const pending = await AsyncStorage.getItem('pending_surveys');
        if (pending) {
          const responses = JSON.parse(pending);
          try {
            await batchSyncSurveys(responses);
            await AsyncStorage.removeItem('pending_surveys');
          } catch (e) {
            console.log('Sync failed, will retry');
          }
        }
      }
    });
    return () => unsubscribe();
  }, []);
}
```

## 4.8 Add Notification Badge on Tab Bar

```typescript
// In app/(tabs)/_layout.tsx
// Fetch unread notification count on mount
const [unreadCount, setUnreadCount] = useState(0);

useEffect(() => {
  getNotifications().then(r => {
    const unread = r.data.filter((n: any) => !n.isRead).length;
    setUnreadCount(unread);
  });
}, []);

// Pass to tab bar badge
<Tabs.Screen
  name="notifications"
  options={{
    tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
  }}
/>
```

---

# PART 5: PERSONA ENGINE (Based on Referral Tree Analysis)

This is the logic to determine a user's "persona" based on their direct vs network count — used to show the right content and tasks.

```typescript
// src/utils/personaEngine.ts

export type Persona = 
  | 'PASSIVE'        // 0 referrals, just joined
  | 'ACTIVE'         // 1-9 referrals, engaged
  | 'CONNECTOR'      // 10-49 direct, good recruiter
  | 'INFLUENCER'     // 50-99 direct OR 200+ network
  | 'SUPER_NODE'     // 100+ direct OR 500+ network
  | 'NATURAL_LEADER' // 50+ direct + high activity score

export function getPersona(directCount: number, networkCount: number, activityScore: number): Persona {
  if (directCount >= 100 || networkCount >= 500) return 'SUPER_NODE';
  if (directCount >= 50 && activityScore >= 70) return 'NATURAL_LEADER';
  if (directCount >= 50 || networkCount >= 200) return 'INFLUENCER';
  if (directCount >= 10) return 'CONNECTOR';
  if (directCount >= 1) return 'ACTIVE';
  return 'PASSIVE';
}

// Used for:
// 1. Home dashboard message: "You are an Influencer 🌟 — keep growing!"
// 2. Task suggestions: SUPER_NODE gets leadership tasks
// 3. Election eligibility: INFLUENCER+ can nominate
// 4. Leadership score boost: NATURAL_LEADER gets +20 to leadership score
// 5. Analytics: show persona distribution per block/district

export function getPersonaMessage(persona: Persona, name: string): string {
  const messages: Record<Persona, string> = {
    'PASSIVE':        `Welcome to IRO, ${name}! Share your link and bring the first Reformer.`,
    'ACTIVE':         `Great start, ${name}! Keep sharing — you're building momentum.`,
    'CONNECTOR':      `${name}, you are a Connector 🔗 Your network is growing! Aim for 50 referrals.`,
    'INFLUENCER':     `${name}, you are an Influencer 🌟 You have real reach. Consider leading your Booth.`,
    'SUPER_NODE':     `${name}, you are a Super Node ⚡ Your network is massive. You should lead at Block level.`,
    'NATURAL_LEADER': `${name}, data shows you are a Natural Leader 🏆 We want you to run in the upcoming election.`,
  };
  return messages[persona];
}
```

Add persona display to home dashboard:
```typescript
// In VolunteerHomeScreen
const persona = getPersona(stats.user.directCount, stats.user.networkCount, stats.xp?.activityScore ?? 0);
const personaMessage = getPersonaMessage(persona, stats.user.name);

// Show as card on dashboard:
// "🌟 You are an Influencer"
// personaMessage below
// [Nominate Yourself] button if INFLUENCER+ and election open
```

---

# PART 6: SCREENS TO BUILD/COMPLETE

Build these screens that are not yet done:

## 6.1 TaskListScreen (`src/screens/tasks/TaskListScreen.tsx`)
- Fetch from GET /api/tasks
- Tab bar: Today | Upcoming | Completed
- Swipe right to complete → open proof submission modal
- Proof modal: take photo + GPS auto-capture → PATCH /api/tasks/:id/complete

## 6.2 SurveyListScreen + SurveyFormScreen
- Fetch from GET /api/surveys
- Dynamic form renderer based on question types in JSON
- Offline: save to AsyncStorage if no internet
- Submit to POST /api/surveys/:id/respond

## 6.3 ElectionsScreen
- Fetch from GET /api/elections
- Show active elections with countdown timer
- Voting screen with candidate cards + biometric confirm
- Results screen with live bars

## 6.4 EventsScreen
- Fetch from GET /api/events
- RSVP button → POST /api/events/:id/rsvp

## 6.5 NotificationsScreen
- Fetch from GET /api/notifications
- Mark all read on open → PATCH /api/notifications/read-all

## 6.6 BoothIntelligenceScreen (booth_worker+ only)
- Fetch booth data from GET /api/booths/:id
- Show coverage map with Google Maps
- Issue reporting → POST /api/booths/:id/issues

## 6.7 AnalyticsDashboard (district_leader+ only)
- Fetch from GET /api/analytics/dashboard
- Line chart for growth trend
- Bar chart for jurisdiction breakdown

---

# PART 7: RUN INSTRUCTIONS

## Backend:
```bash
cd iro/server
npm run db:generate   # after schema changes
npx prisma migrate dev --name "full_phase1"
npm run dev           # starts on port 4000
```

## Frontend:
```bash
cd iro_app_react_native
npm install
npx expo start        # scan QR with Expo Go app
```

## Seed initial data (create in `iro/server/prisma/seed.ts`):
```typescript
// Seed badges
const badges = [
  { key: 'JOINED', name: 'Joined IRO', description: 'Welcome to the movement', icon: '🌱' },
  { key: 'FIRST_TASK', name: 'First Task', description: 'Completed first task', icon: '✅' },
  { key: 'FIRST_SURVEY', name: 'First Survey', description: 'Submitted first survey', icon: '📋' },
  { key: 'TEN_CLUB', name: '10 Club', description: '10 direct referrals', icon: '🔟' },
  { key: 'HUNDRED_CLUB', name: '100 Club', description: '100 direct referrals', icon: '💯' },
  { key: 'NATURAL_LEADER', name: 'Natural Leader', description: 'Data-identified leader', icon: '🏆' },
];
await prisma.badge.createMany({ data: badges, skipDuplicates: true });
```

---

# SUMMARY — WHAT THIS PROMPT DELIVERS

When implemented completely:

✅ Full referral tree with correct direct/network count logic
✅ Persona engine: identifies PASSIVE → NATURAL_LEADER based on data
✅ Top-level role assignment with jurisdiction validation
✅ All 22 backend API routes live and connected
✅ Complete Prisma schema with all Phase 1 tables
✅ Migration script ready to run
✅ All frontend screens connected to real APIs
✅ Live counter via Socket.io
✅ Offline survey sync
✅ XP awarded on task/survey completion
✅ Notification system wired end-to-end
✅ Role-based dashboard routing
✅ Elections with voting and results

After this is implemented, the app is fully live and ready for real Reformers to join.

---

*Backend: github.com/pankajrentfoxxy/iro/tree/main/server*
*Frontend: github.com/pankajrentfoxxy/iro_app_react_native*
*Stack: Expo Router + Node.js + PostgreSQL + Prisma + Redis + Socket.io*
