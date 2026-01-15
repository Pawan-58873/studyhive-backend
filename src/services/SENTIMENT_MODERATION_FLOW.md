# Sentiment Moderation System - Complete Flow

## 📋 Overview

This document explains the complete flow of the sentiment moderation system from when a user sends a message to how violations are handled.

---

## 🔄 Complete Flow Diagram

```
USER SENDS MESSAGE
       │
       ▼
┌─────────────────────────────────────┐
│ 1. HTTP Request: POST /api/groups/ │
│    :groupId/messages                │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 2. Authentication Middleware         │
│    (checkAuth)                      │
│    ✓ Verifies user is logged in    │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 3. Suspension Check Middleware       │
│    (checkSuspension)                │
│    ├─ Get user moderation status    │
│    ├─ Check if suspension expired   │
│    │  └─ If expired: Auto-remove     │
│    └─ If suspended: BLOCK & RETURN  │
└─────────────────────────────────────┘
       │
       ▼ (User not suspended)
┌─────────────────────────────────────┐
│ 4. Controller: sendGroupMessage()   │
│    ├─ Validate message payload      │
│    └─ Extract message content       │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 5. Moderation Service:              │
│    moderateMessage(userId, content) │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 6. Check Suspension Status          │
│    (Double-check, in case changed)  │
│    └─ If suspended: Return blocked  │
└─────────────────────────────────────┘
       │
       ▼ (Not suspended)
┌─────────────────────────────────────┐
│ 7. Check for Negative Words         │
│    containsNegativeWord(content)    │
│    ├─ Convert to lowercase          │
│    ├─ Check against NEGATIVE_WORDS  │
│    └─ Return: true/false            │
└─────────────────────────────────────┘
       │
       ├─ NO NEGATIVE WORD FOUND ──────┐
       │                                │
       │                                ▼
       │                        ┌──────────────────┐
       │                        │ 8. ALLOW MESSAGE  │
       │                        │ Save to database  │
       │                        │ Broadcast via IO  │
       │                        └──────────────────┘
       │
       ▼ NEGATIVE WORD FOUND
┌─────────────────────────────────────┐
│ 9. Get Current Warning Count        │
│    getUserModerationStatus(userId)  │
│    └─ Returns: warningCount         │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 10. Increment Warning Count         │
│     newCount = currentCount + 1     │
│     Update in database              │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 11. Apply Moderation Rule           │
│     Based on new warning count:     │
│     ├─ Count = 1: WARNING           │
│     ├─ Count = 2: FINAL WARNING     │
│     └─ Count = 3: SUSPEND (7 days) │
└─────────────────────────────────────┘
       │
       ├─ WARNING (1st) ───────────────┐
       │                                │
       ├─ FINAL WARNING (2nd) ─────────┤
       │                                │
       └─ SUSPENSION (3rd) ────────────┤
                                        │
                                        ▼
                            ┌──────────────────────┐
                            │ 12. Log Action       │
                            │ logModerationAction()│
                            │ Save to moderationLogs│
                            └──────────────────────┘
                                        │
                                        ▼
                            ┌──────────────────────┐
                            │ 13. BLOCK MESSAGE    │
                            │ Return 403 error     │
                            │ with warning message │
                            └──────────────────────┘
```

---

## 📝 Step-by-Step Detailed Flow

### **Step 1: User Sends Message**

- User types message in group chat
- Frontend sends POST request to `/api/groups/:groupId/messages`
- Request includes: `{ content: "message text", ... }`

### **Step 2: Authentication Check**

- `checkAuth` middleware verifies user is authenticated
- Extracts `userId` from JWT token
- If not authenticated → Return 401

### **Step 3: Suspension Check (Middleware)**

**Location:** `server/src/middlewares/moderation.middleware.ts`

```typescript
checkSuspension() {
  1. Get userId from request
  2. Call isUserSuspended(userId)
     ├─ getUserModerationStatus(userId)
     │  ├─ Fetch user from database
     │  ├─ Get moderation.warningCount
     │  ├─ Get moderation.suspensionEndTimestamp
     │  ├─ Check if suspension expired
     │  │  └─ If expired: removeExpiredSuspension()
     │  └─ Return status
     └─ Return true/false

  3. If suspended:
     ├─ Calculate days remaining
     └─ Return 403 with error message
  4. If not suspended:
     └─ Call next() to continue
}
```

**Key Points:**

- ✅ Auto-removes expired suspensions
- ✅ Blocks suspended users immediately
- ✅ Fails open (allows message if error occurs)

### **Step 4: Controller Processing**

**Location:** `server/src/controllers/group.controller.ts`

```typescript
sendGroupMessage() {
  1. Extract groupId, senderId, message content
  2. Validate message payload (Zod schema)
  3. Get sender profile from database
  4. Call moderateMessage(senderId, content)
}
```

### **Step 5: Message Moderation**

**Location:** `server/src/services/moderation.service.ts`

```typescript
moderateMessage(userId, messageText) {
  // Step 5.1: Double-check suspension
  if (isUserSuspended(userId)) {
    return { isAllowed: false, action: 'suspension' }
  }

  // Step 5.2: Check for negative words
  if (!containsNegativeWord(messageText)) {
    return { isAllowed: true }  // ✅ Message is clean
  }

  // Step 5.3: Negative word found - apply rules
  const status = getUserModerationStatus(userId)
  const newWarningCount = status.warningCount + 1

  // Step 5.4: Increment warning count
  incrementWarningCount(userId, newWarningCount)

  // Step 5.5: Determine action based on count
  if (newWarningCount === 1) {
    action = 'warning'
    message = 'Warning: Your message contains inappropriate content...'
  } else if (newWarningCount === 2) {
    action = 'final_warning'
    message = 'Final Warning: One more violation will result in suspension...'
  } else {
    action = 'suspension'
    suspendUser(userId, 7)  // 7 days
    message = 'You have been suspended for 7 days...'
  }

  // Step 5.6: Log the action
  logModerationAction(userId, { action, reason, warningCount })

  // Step 5.7: Return blocked result
  return { isAllowed: false, action, message, warningCount }
}
```

### **Step 6: Negative Word Detection**

**Location:** `server/src/services/moderation.service.ts`

```typescript
containsNegativeWord(messageText) {
  1. Convert message to lowercase
     Example: "This is SPAM" → "this is spam"

  2. Check each word in NEGATIVE_WORDS array
     For each word:
       if (lowerMessage.includes(word)) {
         return true  // Found negative word
       }

  3. Return false if no matches found
}
```

**Matching Logic:**

- Case-insensitive: "SPAM" = "spam" = "Spam"
- Substring matching: "spam" matches "spamming", "spammer"
- Simple matching (no word boundaries)

### **Step 7: Warning Count Management**

**Database Structure:**

```
users/{userId}/
  moderation/
    warningCount: 0, 1, 2, or 3
    suspensionEndTimestamp: Timestamp | null
    lastAction: string
    lastActionTimestamp: Timestamp
```

**Warning Progression:**

- **0 → 1**: First violation → Warning
- **1 → 2**: Second violation → Final Warning
- **2 → 3**: Third violation → Suspension (7 days)
- **After suspension expires**: Auto-reset to 0

### **Step 8: Suspension Handling**

**When User is Suspended:**

```typescript
suspendUser(userId, 7) {
  1. Calculate suspension end date
     endDate = now + 7 days

  2. Update database:
     moderation.suspensionEndTimestamp = endDate
     moderation.lastAction = 'suspended'

  3. User cannot send messages until suspension expires
}
```

**Auto-Removal on Expiration:**

```typescript
getUserModerationStatus(userId) {
  if (suspensionEndTimestamp exists) {
    if (suspensionEnd < now) {
      // Suspension expired
      removeExpiredSuspension(userId)
        ├─ Set warningCount = 0
        ├─ Delete suspensionEndTimestamp
        └─ Log action
    }
  }
}
```

### **Step 9: Logging**

**Moderation Logs Collection:**

```
moderationLogs/{logId}
  userId: string
  userName: string
  action: 'warning' | 'final_warning' | 'suspension' | 'suspension_removed'
  reason: string
  messageText: string (first 100 chars)
  warningCount: number
  timestamp: Timestamp
```

**Admin Access:**

- `GET /api/admin/moderation-logs` - View all logs
- `GET /api/admin/moderation-status/:userId` - View user status

---

## 🎯 Key Decision Points

### **Decision Tree:**

```
Message Sent
    │
    ├─ User Suspended?
    │   ├─ YES → Block immediately (403)
    │   └─ NO → Continue
    │
    ├─ Contains Negative Word?
    │   ├─ NO → Allow message ✅
    │   └─ YES → Check warning count
    │       │
    │       ├─ Count = 0 → Warning (count = 1)
    │       ├─ Count = 1 → Final Warning (count = 2)
    │       └─ Count = 2 → Suspend 7 days (count = 3)
    │
    └─ Block message with appropriate message
```

---

## 🔍 Example Scenarios

### **Scenario 1: Clean Message**

```
User: "Hello everyone, how are you?"
Flow:
  1. ✅ Not suspended
  2. ✅ No negative words found
  3. ✅ Message allowed
  4. ✅ Saved to database
```

### **Scenario 2: First Violation**

```
User: "This is spam content"
Flow:
  1. ✅ Not suspended
  2. ❌ Negative word "spam" found
  3. ⚠️ Warning count: 0 → 1
  4. 📝 Log: "warning" action
  5. 🚫 Block message
  6. 📧 Return: "Warning: Your message contains inappropriate content..."
```

### **Scenario 3: Second Violation**

```
User: "More spam here"
Flow:
  1. ✅ Not suspended
  2. ❌ Negative word "spam" found
  3. ⚠️ Warning count: 1 → 2
  4. 📝 Log: "final_warning" action
  5. 🚫 Block message
  6. 📧 Return: "Final Warning: One more violation will result in suspension..."
```

### **Scenario 4: Third Violation (Suspension)**

```
User: "Spam again"
Flow:
  1. ✅ Not suspended
  2. ❌ Negative word "spam" found
  3. ⚠️ Warning count: 2 → 3
  4. 🔒 Suspend user for 7 days
  5. 📝 Log: "suspension" action
  6. 🚫 Block message
  7. 📧 Return: "You have been suspended for 7 days..."
```

### **Scenario 5: Suspended User Tries to Send**

```
User: "Any message"
Flow:
  1. ❌ User is suspended
  2. 🚫 Block immediately (middleware)
  3. 📧 Return: "You are suspended. Suspension ends in X days..."
  4. ⏭️ Never reaches content check
```

### **Scenario 6: Suspension Expires**

```
User: "Hello" (after 7 days)
Flow:
  1. Check suspension status
  2. ✅ Suspension expired
  3. 🔄 Auto-remove suspension
  4. 🔄 Reset warning count to 0
  5. ✅ Allow message
  6. 📝 Log: "suspension_removed" action
```

---

## 🛡️ Error Handling

### **Fail-Open Strategy:**

- If moderation system fails, messages are allowed
- Prevents system errors from blocking all communication
- Errors are logged for debugging

### **Edge Cases Handled:**

- ✅ Uppercase/lowercase text
- ✅ Repeated violations
- ✅ Expired suspensions
- ✅ Database connection errors
- ✅ Missing user data
- ✅ Concurrent message sends

---

## 📊 Data Flow Summary

```
Request → Auth → Suspension Check → Content Check → Word Check
                                                      │
                                                      ├─ Clean → Save Message
                                                      └─ Violation → Increment Warning
                                                                      │
                                                                      ├─ 1st → Warning
                                                                      ├─ 2nd → Final Warning
                                                                      └─ 3rd → Suspend + Log
```

---

## 🔧 Configuration Points

1. **Negative Words List**: `NEGATIVE_WORDS` array in `moderation.service.ts`
2. **Suspension Duration**: `suspendUser(userId, 7)` - change `7` to desired days
3. **Warning Thresholds**: Hardcoded in `moderateMessage()` function
4. **Log Retention**: Stored in `moderationLogs` collection (no auto-deletion)

---

This flow ensures comprehensive moderation while maintaining system reliability and user experience.
