# Bot Commands

Homly's WhatsApp bot supports two types of commands: **built-in commands** (always available) and **custom commands** (configured per household from the web app).

---

## Built-in Commands

### `/remind <duration> <message>`

Set a timed reminder. The bot will send the message back to the group at the specified time.

**Duration formats:**

| Format | Example | Means |
|--------|---------|-------|
| `Nm` | `30m` | 30 minutes from now |
| `Nh` | `2h` | 2 hours from now |
| `Nd` | `1d` | 1 day from now |
| Combined | `1h30m` | 1 hour 30 minutes from now |

**Examples:**
```
/remind 30m buy milk
/remind 2h call the plumber
/remind 1d renew road tax
/remind 1h30m check the oven
```

Reminders are stored in Supabase (`reminders` table) and survive bot restarts. The bot polls `/internal/reminders/due` every 60 seconds, marks due reminders as sent, and delivers them to the group.

You can also schedule reminders from the web app under **Expenses → Commands → Reminders**.

---

## Custom Commands

Household admins and members can define their own instant-reply commands from the web app (**Expenses → Commands**).

### How it works

1. Create a command with a **trigger word** (e.g. `wifi`) and a **response** (the message the bot sends back).
2. Any group member types `/wifi` in WhatsApp.
3. The bot replies immediately with the configured response.

### Trigger rules

- 1–30 characters: letters, digits, `_`, `-` only (no spaces)
- Case-insensitive (`/WiFi` = `/wifi`)
- Cannot shadow built-ins: `remind`, `help`, `start`, `stop` are reserved

### Response

- Plain text, up to 2000 characters
- WhatsApp formatting works: `*bold*`, `_italic_`, `` `code` ``

### Example use-cases

| Trigger | Response |
|---------|----------|
| `/wifi` | `Network: HomlyHome \| Password: Homly2024!` |
| `/chores` | `Mon: Alice 🧹 Tue: Bob 🍽️ Wed: Alice 🪣 ...` |
| `/emergency` | `Police: 999 \| Ambulance: 995 \| Gas leak: 1800-752-1800` |
| `/rules` | `House rules: no shoes indoors, quiet after 10pm...` |

### Enabling / disabling

Commands can be toggled on/off from the app without deleting them. Disabled commands are ignored by the bot.

---

## Architecture

```
WhatsApp message (text starting with /)
    ↓
handleMessage()
    ↓
handleReminderCommand()   ← /remind — stores in reminders table
    ↓ (if not handled)
handleCustomCommand()     ← checks customCommandsCache[household_id][trigger]
    ↓ (if not handled)
LangGraph agent           ← AI-powered household queries
```

### Cache refresh

The bot maintains an in-memory map `customCommandsCache`:

```js
{
  "<household_id>": {
    "wifi": "Network: HomlyHome | Password: ...",
    "chores": "Mon: Alice ..."
  }
}
```

The cache is populated on bot connect and refreshed every 2 minutes via `GET /internal/commands`.

---

## API Reference

### User-facing (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/commands` | List all custom commands for the household |
| `POST` | `/commands` | Create a command (`trigger`, `response`, `description?`, `enabled?`) |
| `PATCH` | `/commands/{id}` | Update a command |
| `DELETE` | `/commands/{id}` | Delete a command |
| `GET` | `/reminders` | List upcoming (unsent) reminders |
| `POST` | `/reminders` | Create a reminder (`message`, `remind_at` ISO datetime) |
| `DELETE` | `/reminders/{id}` | Cancel a reminder |

### Internal (X-Internal-Key required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/internal/commands` | All enabled commands keyed by `household_id` |
| `GET` | `/internal/reminders/due` | Fetch and mark as sent any reminders past `remind_at` |

---

## Database Schema

### `reminders`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| group_jid | TEXT | WhatsApp group to send to |
| sender_jid | TEXT | Who set the reminder |
| sender_name | TEXT | Display name |
| message | TEXT | Reminder text |
| remind_at | TIMESTAMPTZ | When to send |
| sent | BOOLEAN | Set to true after delivery |
| created_at | TIMESTAMPTZ | |

### `custom_commands`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| trigger | TEXT | Lowercase, 1–30 chars, unique per household |
| response | TEXT | Up to 2000 chars |
| description | TEXT | Optional, shown in app only |
| enabled | BOOLEAN | Default true |
| created_by | UUID (FK → auth.users) | |
| created_at / updated_at | TIMESTAMPTZ | |
