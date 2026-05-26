# 🏛️ Colosseum Ticket Sniper

**Automatically grab sold-out Colosseum tickets the moment they become available.**

Beat the bots, bypass rate limits, and secure your Full Experience tickets with Arena access.

## ✨ Features

- **Stealth Mode** - Bypasses Octofence bot detection
- **Proxy Rotation** - Rotates through 10 residential proxies to avoid IP blocks
- **Auto-Purchase Flow** - Selects time slot → Sets participants → Adds tickets to cart
- **Real-time Monitoring** - Checks availability every 30 seconds
- **Telegram Alerts** - Get notified instantly when tickets are found
- **Human-like Behavior** - Random delays, realistic mouse movements

## 🎯 What It Does

1. Monitors the Colosseum ticketing site for your chosen date
2. Detects when tickets become available (even cancellations!)
3. Automatically selects the time slot and ticket types
4. Adds tickets to your cart
5. Alerts you to complete payment

## 📋 Requirements

- Node.js 18+
- Google Chrome installed
- Residential proxy credentials (Webshare, IPRoyal, Bright Data, etc.)
- Optional: 2Captcha API key for CAPTCHA solving

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/ticket-sniper.git
cd ticket-sniper
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your settings

# 3. Run
npm run snipe
```

## ⚙️ Configuration

Edit `.env` file:

```env
# Target date (YYYY-MM-DD format)
TARGET_DATE=2026-04-04

# Ticket quantities
ADULT_TICKETS=2
CHILD_TICKETS=2

# Your email for booking
EMAIL=your@email.com

# Proxy list (IP:PORT:USER:PASS format, comma-separated)
PROXIES=1.2.3.4:8080:user:pass,5.6.7.8:8080:user:pass

# Telegram notifications (optional)
TELEGRAM_CHAT_ID=your_chat_id

# Check interval in milliseconds
CHECK_INTERVAL=30000
```

## 🎫 Supported Ticket Types

- Full Experience with Arena Entry (€24/adult, free under 18)
- Standard Colosseum Entry
- Colosseum + Roman Forum combo

## ⚠️ Disclaimer

This tool is for educational purposes. Use responsibly and respect the ticketing site's terms of service. The seller is not responsible for any misuse.

## 📞 Support

Includes 7 days of setup support via Telegram/Discord.

---

**Works for other ticketing sites too!** Can be adapted for concerts, museums, events, etc. Ask about customization.
