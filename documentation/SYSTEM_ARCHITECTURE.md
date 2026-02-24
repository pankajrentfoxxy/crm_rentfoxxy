# 📊 SYSTEM ARCHITECTURE & WORKFLOW

## 🏗️ System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    LAPTOP REFURBISHMENT SYSTEM               │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   FRONTEND   │◄────►│   BACKEND    │◄────►│   DATABASE   │
│  (React.js)  │ API  │  (Node.js)   │ SQL  │ (PostgreSQL) │
│              │      │              │      │              │
│ - Dashboard  │      │ - Auth API   │      │ - Users      │
│ - Tickets    │      │ - Tickets    │      │ - Tickets    │
│ - Teams      │      │ - Teams      │      │ - Stages     │
│ - Parts      │      │ - Parts      │      │ - Parts      │
│              │      │ - Analytics  │      │ - Activities │
└──────────────┘      └──────────────┘      └──────────────┘
      │                     │                      │
      │                     │                      │
      ▼                     ▼                      ▼
  Vercel.app          Railway.app            Railway.app
  (FREE Hosting)      (FREE Hosting)        (FREE Database)
```

## 📱 User Flow

```
START → Login Page
           │
           ├─ Valid Credentials? ──No──► Error Message
           │                            │
           Yes                          │
           │                            │
           ▼                            │
       Dashboard ◄──────────────────────┘
           │
           ├──► View Statistics
           │    - Total Tickets
           │    - Active Users
           │    - Tickets by Stage
           │    - Recent Activity
           │
           ├──► My Tickets
           │    │
           │    ├──► View Ticket List
           │    │    │
           │    │    ├──► Filter/Search
           │    │    └──► Click Ticket
           │    │            │
           │    │            ▼
           │    │      Ticket Details
           │    │            │
           │    │            ├──► View Info
           │    │            ├──► View Timeline
           │    │            ├──► View Photos
           │    │            ├──► View Parts
           │    │            ├──► Add Notes
           │    │            └──► Move to Next Stage
           │    │
           │    └──► Create New Ticket
           │         │
           │         ├─ Enter Serial Number
           │         ├─ Enter Brand/Model
           │         ├─ Set Priority
           │         ├─ Describe Condition
           │         └─ Submit
           │
           ├──► Teams Management
           │    └──► View Team Members
           │
           └──► Parts Inventory
                └──► View Available Parts
```

## 🔄 Ticket Lifecycle

```
1. Warehouse Receipt
   ↓
2. Diagnosis
   ↓
3. Dismantle & Tag Parts
   ↓
4. Procurement (if parts needed)
   ↓
5. Body & Paint (if needed)
   ↓
6. Assembly & Repair
   ↓
7. Software Installation
   ↓
8. Testing
   ↓
9. Grading (A/A-/B+/B)
   ↓
10. QC1 (First Quality Check)
   ↓
11. QC2 (Second Quality Check)
   ↓
12. Packaging
   ↓
13. Inventory (Ready for Sale)
```

## 🗄️ Database Schema Relationships

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│  USERS  │◄───────►│  TEAMS  │◄───────►│ STAGES  │
└─────────┘         └─────────┘         └─────────┘
     │                                        │
     │                                        │
     └──────────┐                    ┌────────┘
                │                    │
                ▼                    ▼
           ┌──────────────────────────────┐
           │         TICKETS              │
           └──────────────────────────────┘
                │         │         │
        ┌───────┘         │         └──────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐      ┌──────────┐     ┌────────┐
   │ PHOTOS  │      │ACTIVITIES│     │ PARTS  │
   └─────────┘      └──────────┘     └────────┘
                                          │
                                          ▼
                                  ┌──────────────┐
                                  │TICKET_PARTS  │
                                  └──────────────┘
```

## 🔐 Authentication Flow

```
User Login Request
      │
      ▼
Backend Receives
      │
      ├─► Check Email Exists? ──No──► Error: User not found
      │                              │
      Yes                            │
      │                              │
      ▼                              │
   Hash Password                     │
      │                              │
      ├─► Compare Hash? ──No─────────┘
      │                   
      Yes
      │
      ▼
Generate JWT Token
      │
      ├─► Include: user_id, email, role, team_id
      │
      ▼
Send Token to Frontend
      │
      ▼
Frontend Stores Token
      │
      └─► All future requests include:
          Authorization: Bearer <token>
```

## 📊 API Request Flow

```
Frontend Component
      │
      │ Call API function
      │ (e.g., ticketAPI.getAll())
      ▼
API Service (axios)
      │
      │ Add Authorization Header
      │ Add Content-Type
      ▼
Backend Route
      │
      │ Auth Middleware
      │ ├─ Verify Token
      │ └─ Attach user to request
      ▼
Controller Function
      │
      │ Query Database
      │ Process Data
      ▼
Database Response
      │
      │ Format Response
      ▼
Return JSON to Frontend
      │
      ▼
Update Component State
      │
      ▼
Re-render UI
```

## 🎯 Key Features Map

```
DASHBOARD
├── Statistics Cards
│   ├── Total Tickets
│   ├── Active Users
│   ├── Avg Completion Time
│   └── Completed Count
├── Tickets by Stage Chart
└── Recent Tickets List

TICKETS
├── My Tickets List
│   ├── Search & Filter
│   ├── Status Badges
│   └── Click to View Details
├── Create New Ticket
│   ├── Serial Number (required)
│   ├── Brand/Model
│   ├── Priority Selection
│   └── Initial Condition
└── Ticket Details
    ├── Overview Tab
    ├── Timeline (Activity Log)
    ├── Parts Used
    ├── Photos Uploaded
    ├── Add Notes
    └── Move to Next Stage

TEAMS
├── Team List
├── Team Members
└── Assign Tickets

PARTS
├── Parts Inventory
├── Add New Parts
└── Track Usage
```

## 🚀 Deployment Architecture

```
┌─────────────────────────────────────────────┐
│              INTERNET                        │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│   FRONTEND   │        │   BACKEND    │
│              │        │              │
│  Vercel.app  │◄──────►│ Railway.app  │
│              │  HTTPS │              │
│ Static Files │        │  REST API    │
│  React App   │        │  Node.js     │
└──────────────┘        └──────────────┘
                               │
                               │ PostgreSQL
                               │ Connection
                               ▼
                        ┌──────────────┐
                        │   DATABASE   │
                        │              │
                        │ Railway.app  │
                        │ PostgreSQL   │
                        │              │
                        └──────────────┘
```

## 📋 Workflow Example: Processing a Laptop

```
Day 1: Warehouse receives laptop
├─ Warehouse team creates ticket
├─ Serial: LAP001, Brand: Dell, Model: Latitude 5420
└─ Status: "Screen cracked, battery dead"

Day 2: Diagnosis
├─ Diagnosis team opens ticket
├─ Fills checklist (all hardware checks)
├─ Notes: "Needs new screen, battery, SSD upgrade"
├─ Adds before photos
└─ Moves to "Dismantle" stage

Day 3: Dismantle
├─ Dismantle team receives ticket
├─ Opens laptop, removes parts
├─ Tags each part with LAP001
├─ Updates ticket with parts removed
└─ Moves to "Procurement" stage

Day 4: Procurement
├─ Procurement team sees needed parts
├─ Creates procurement request
├─ Orders: 15.6" screen, 6-cell battery, 512GB SSD
├─ Links parts to ticket LAP001
└─ Waits for delivery

Day 7: Parts arrive
└─ Moves to "Assembly" stage

Day 8: Assembly
├─ Assembly team replaces parts
├─ Cleans motherboard, applies thermal paste
├─ Uploads after photos
└─ Moves to "Software Installation"

Day 9: Software Installation
├─ IT team installs Windows 11
├─ Installs drivers, apps
├─ Activates license
└─ Moves to "Testing"

Day 10: Testing
├─ Testing team runs full diagnostics
├─ Stress test 30 minutes
├─ All tests pass
└─ Moves to "Grading"

Day 11: Grading
├─ Grading team inspects
├─ Grade: B+ (minor scratches on body)
├─ Applies warranty sticker
└─ Moves to "QC1"

Day 11: QC1
├─ QC1 team: 50-point inspection
├─ All checks pass
└─ Moves to "QC2"

Day 12: QC2
├─ QC2 team: Final verification
├─ Confirms grade B+
└─ Moves to "Packaging"

Day 12: Packaging
├─ Packaging team wraps laptop
├─ Includes charger, guide, warranty card
└─ Moves to "Inventory"

Day 12: Inventory
├─ Inventory manager adds to stock
├─ LAP001 marked as "Available for Sale"
└─ Status: COMPLETED ✓

Total time: 12 days from receipt to ready-for-sale
```

## 🔍 Example API Calls

### Login
```bash
POST http://localhost:5000/api/auth/login
{
  "email": "admin@refurb.com",
  "password": "admin123"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "user_id": 1,
    "name": "Admin User",
    "email": "admin@refurb.com",
    "role": "admin"
  }
}
```

### Get My Tickets
```bash
GET http://localhost:5000/api/tickets/my
Authorization: Bearer <token>

Response:
{
  "success": true,
  "count": 5,
  "tickets": [
    {
      "ticket_id": 1,
      "serial_number": "LAP001",
      "brand": "Dell",
      "model": "Latitude 5420",
      "status": "in_progress",
      "stage_name": "Diagnosis",
      "assigned_user_name": "John Doe"
    }
  ]
}
```

### Create Ticket
```bash
POST http://localhost:5000/api/tickets
Authorization: Bearer <token>
{
  "serial_number": "LAP002",
  "brand": "HP",
  "model": "EliteBook 840",
  "priority": "high",
  "initial_condition": "Keyboard not working, needs cleaning"
}

Response:
{
  "success": true,
  "message": "Ticket created successfully",
  "ticket": { ... }
}
```

## 🎨 Color Coding

```
STATUS COLORS:
├─ In Progress: Blue (#2563eb)
├─ Completed: Green (#16a34a)
├─ Failed: Red (#dc2626)
└─ On Hold: Yellow (#ca8a04)

PRIORITY COLORS:
├─ Low: Gray
├─ Normal: Blue
├─ High: Orange
└─ Urgent: Red

STAGE INDICATORS:
├─ Current Stage: Bold Blue
├─ Completed Stages: Green ✓
└─ Pending Stages: Gray
```

This system provides complete visibility and tracking of every laptop through
the entire refurbishment process, with real-time updates and accountability!
