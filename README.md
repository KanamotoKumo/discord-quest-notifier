<div align="center">

# 🎮 Discord Quests Notifier

**Advanced Discord Quests tracker with automatic update detection and webhook notifications**

Track new Discord Quests and changes in real-time. Get notified every 5 minutes when a new quest appears or when quest details are updated.

![Status](https://img.shields.io/badge/Status-Update-yellow)
![Node](https://img.shields.io/badge/Node-20+-blue)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

> [!WARNING]
> **DISCLAIMER**: This project is for educational and personal monitoring purposes only. Using Discord user tokens violates Discord's Terms of Service and may result in permanent account suspension. Use entirely at your own risk.

---

## 🚀 Features

✅ **Real-time Quest Tracking** - Fetches Discord quests every 5 minutes  
✅ **New Quest Notifications** - Instant webhook alerts for newly discovered quests  
✅ **Update Detection** - Detects changes in quest details (deadlines, rewards, tasks, etc.)  
✅ **Change Highlighting** - Shows exactly what changed in quest updates  
✅ **Atomic State Management** - Safe data persistence with atomic file writes  
✅ **Role Mentions** - Optional Discord role pinging for alerts  
✅ **Internationalization** - Support for multiple languages (en-US, vi-VN)  
✅ **GitHub Actions** - Free 24/7 cloud hosting  
✅ **Error Tracking** - Optional error webhook for debugging  
✅ **Components V2** - Beautiful formatted Discord messages with images and details  

---

## 📋 Installation

### Method 1: GitHub Actions (Recommended - Free & 24/7)

**Step 1: Create Repository**
1. Fork or create a new repository named `discord-quests-notifier`
2. Clone it locally or use GitHub's web editor

**Step 2: Configure Secrets**
Go to **Settings** → **Secrets and variables** → **Actions**

Add these **Secrets** (Click "New repository secret"):
| Secret | Description | Example |
|--------|-------------|----------|
| `DISCORD_TOKEN` | Your Discord user token | `MzA4M...` |
| `MAIN_WEBHOOK` | Webhook for quest notifications | `https://discord.com/api/webhooks/...` |
| `ERROR_WEBHOOK` | Webhook for error logs (optional) | `https://discord.com/api/webhooks/...` |

Add these **Variables** (Click "New repository variable"):
| Variable | Description | Example |
|----------|-------------|----------|
| `LOCALE` | Language for messages | `en-US` or `vi-VN` |
| `PING_ROLE_ID` | Role ID to mention (optional) | `123456789` |

**Step 3: Enable Actions**
1. Go to **Actions** tab
2. Enable GitHub Actions (if disabled)
3. Select "Discord Quest Tracker" workflow
4. Click "Run workflow"

✅ Done! The bot will run every 5 minutes automatically.

---

### Method 2: Self-Hosted (VPS/Localhost)

**Step 1: Clone Repository**
```bash
git clone https://github.com/yourusername/discord-quests-notifier.git
cd discord-quests-notifier
```
**Step 2: Install Dependencies**
```bash
npm install
```
**Step 3: Configure Environment**
```bash
cp .env.example .env
```
Edit .env
```env
DISCORD_TOKEN="YOUR_TOKEN"
MAIN_WEBHOOK="https://discord.com/api/webhooks/..."
ERROR_WEBHOOK="https://discord.com/api/webhooks/..."
GITHUB_TOKEN="ghp_..."
REPOSITORY="yourname/discord-quests-notifier"
LOCALE="en-US"
PING_ROLE_ID=""
```
**Step 4: Run Tracker**
```bash
node src/main.js
```
**Step 5: Schedule Recurring Task**

Using PM2 (recommended):
```bash
npm install -g pm2
pm2 start src/main.js --cron "*/5 * * * *"
pm2 save
pm2 startup
```
Or using crontab:
```bash
crontab -e
# Add: */5 * * * * cd /path/to/repo && node src/main.js
```
## 📊 How It Works
```code
Every 5 Minutes (GitHub Actions or Cron)
        ↓
Discord API: Fetch /quests/@me
        ↓
Compare with state.json
        ↓
┌─────────────────────────────┐
│  NEW QUEST FOUND?           │
│  ├─ Send notification       │
│  ├─ Mention role (if set)   │
│  └─ Save to state.json      │
└─────────────────────────────┘
        ↓
┌─────────────────────────────┐
│  QUEST UPDATED?             │
│  ├─ Detect changes          │
│  ├─ Send update alert       │
│  ├─ Highlight what changed  │
│  └─ Update state.json       │
└─────────────────────────────┘
        ↓
Cleanup expired quests from state
        ↓
Save state + Commit to GitHub (if Actions)
```
## 🗂️ Project Structure
```code
discord-quests-notifier/
├── src/
│   ├── main.js              ← Main tracker logic
│   ├── config.js            ← Configuration & env vars
│   ├── discord.js           ← Discord API client
│   ├── embed.js             ← Embed builders (new & updated)
│   ├── state.js             ← State management (atomic writes)
│   ├── webhook.js           ← Webhook sender
│   ├── logging.js           ← Logging utilities
│   ├── language.js          ← i18n initialization
│   ├── utils.js             ← Helper functions
│   ├── module.js            ← Module exports
│   └── languages/
│       ├── en-US.json       ← English strings
│       └── vi-VN.json       ← Vietnamese strings
├── .github/workflows/
│   └── questsTracker.yml    ← GitHub Actions workflow
├── .env.example             ← Environment template
├── package.json
├── package-lock.json
├── state.json               ← Quest state (auto-managed)
├── proxy.json
└── README.md
```
## 📝 state.json Format
The `state.json` file automatically tracks all active quests:
```json
{
  "quests": {
    "QUEST_ID": {
      "id": "1234567890",
      "config": { /* full quest config */ },
      "hash": "base64hashofcriticalfields",
      "starts_at": "2026-07-01T17:00:00Z",
      "expires_at": "2026-08-13T00:00:00Z",
      "sent_at": "2026-07-08T13:28:35Z",
      "updated_at": "2026-07-08T15:30:00Z",
      "type": "new" | "updated"
    }
  },
  "last_check": "2026-07-08T09:35:46Z"
}
```
**Manual Management**:

**Reset All**: Clear `quests` object → Bot will resend all active quests
**Reset One Quest**: Delete specific quest ID → Bot will resend only that quest
**View History**: Check `sent_at` and `updated_at` timestamps

**⚠️ Files are written atomically to state.tmp.json first, then renamed to state.json. This prevents data corruption if the script crashes.*
## 🔄 Quest Change Detection
The tracker automatically detects and reports these changes:

✅ Deadline Changes (expires_at)

✅ Start Date Changes (starts_at)

✅ Reward Expiration Changes

✅ Task Count Changes

✅ Reward Type Changes

✅ SKU ID Changes

Each update generates a separate notification highlighting exactly what changed.
## 🌍 Supported Languages
+ 🇺🇸 English (`en-US`)
+ 🇻🇳 Vietnamese (`vi-VN`)
Set `LOCALE` environment variable to switch languages.
## 🛠️ Configuration
**Environment Variables**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | ✅ | `-` | Your Discord user token |
| `MAIN_WEBHOOK` | ✅ | `-` | Webhook URL for quest notifications |
| `ERROR_WEBHOOK` | ❌ | `-` | Webhook URL for error alerts |
| `GITHUB_TOKEN` | ✅ | `-` | GitHub PAT (for committing state) |
| `REPOSITORY` | ✅ | `-` | Repository in format `owner/repo` |
| `LOCALE` | ❌ | `en-US` | Language: `en-US` or `vi-VN`
| `PING_ROLE_ID` | ❌ | `-` | Discord role ID to mention on new quests |
## 📦 Assets
The project uses assets from the `assets/` directory on your repository:

+ `avatar.png` - Bot avatar for webhooks
+ `empty.png` - Fallback image for unknown rewards
+ `discordQuests.png` - Hero image for quests
## 🐛 Troubleshooting
**Token Issues**
**Error**: `Discord API 401: Unauthorized`

❌ Token is invalid or expired
✅ Generate a new user token (go to Discord DevTools Console: `localStorage.token`)
**Webhook Errors**
**Error**: `Webhook error 404`

❌ Webhook URL is incorrect or deleted
✅ Recreate the webhook in Discord and update secrets
**State Issues**
**Issue**: `Bot stops sending notifications`

❌ state.json is corrupted
✅ Delete `state.json` - it will be recreated on next run 
## 🤝 Contributing
Feel free to submit issues and enhancement requests!
## 😍 Acknowledgements
- A special thank you to those who helped me create and refine "Discord Quest Notifier."
+ [@mc-none-vn](https://github.com/mc-none-vn) - The person who created the repository helped me with the work and creation process.
## 📄 License
MIT License - See LICENSE file for details
## ⚠️ Legal Disclaimer
This project is provided as-is for educational purposes. Users assume full responsibility for compliance with Discord's Terms of Service. We are not liable for account suspensions or bans resulting from misuse.


<div align="center">
Built with ❤️ by Korchi Community

[Report Issues](https://github.com/issues) • [Star Us](https://github.com/) • [Fork & Contribute](https://github.com/fork) 
