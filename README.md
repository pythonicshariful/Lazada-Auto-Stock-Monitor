# ⚡ Lazada Auto Stock Monitor & Quick Buy Bot

A premium, feature-rich Tampermonkey userscript designed to automate stock monitoring, quantity selection, and checkout flow on Lazada. Built with stealth in mind, it completely avoids traditional bot-detection triggers (like rapid page reloads) by tapping directly into Lazada's MTOP API and page state variables. Featuring a modern, glassmorphic GUI panel, customizable human-like polling rates, Telegram/Discord notifications with local sound alerts, and secure payment auto-fill.

---

## ✨ Features

- **🛡️ Anti-Bot Stealth (Zero Page Reloads):** Uses Lazada's internal `window.__moduleData__` and `fetch`-based MTOP API for real-time stock checks without reloading the page. Completely avoids rate-limits and "Baxia" bot detection systems triggered by normal page refresh extensions.
- **🔄 Smart Human-like Polling:** Configurable random polling intervals (e.g., 3-7 seconds) combined with built-in millisecond jitter (200-800ms) to ensure traffic patterns look exactly like human behavior.
- **📦 Multi-Layer Stock Monitoring:**
  1. **Instant Snapshot:** Checks embedded `__moduleData__` for instantaneous stock confirmation without network requests.
  2. **MTOP API:** Spoofs legitimate mobile-web API calls with valid MD5 HMAC signatures to check backend inventory directly.
  3. **DOM Fallback:** Checks visual cues if API fails.
- **🔄 DOM Sync & Auto-Reload:** If the backend API detects stock but the frontend hasn't loaded it yet, the bot automatically pauses and triggers a single, synchronized page reload to safely expose the "Buy Now" button.
- **🔢 Custom Quantity Selector:** Instantly updates item quantities to your target amount once stock becomes available.
- **⚡ Quick Buy Trigger:** Automatically clicks "Buy Now" and guides the process through the checkout page.
- **💳 Secure Card Auto-Fill:** Auto-fills credit/debit card credentials (Number, Name, Expiry, CVV) during the checkout process to secure high-demand items instantly.
- **🔔 Discord & Telegram Alerts:** Integrated Webhook and Bot notifications to send real-time stock alerts and checkout updates directly to your phone or desktop.
- **🔊 Local Audio Alerts:** Plays a built-in browser digital beep synthesizer when an important event (like stock discovery or captcha) occurs.
- **🤖 Captcha Auto-Solve Logic:** Detects Lazada's "Baxia" slider/captcha popups and can attempt to handle or alert you immediately.
- **🎨 Glassmorphic Interface:** A modern, non-intrusive floating GUI panel integrated directly into Lazada pages to manage configs on the fly without editing the script.

---

## 🚀 Getting Started

### Prerequisites

1. Install a userscript manager browser extension:
   - [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)

### Installation

1. Open the `Lazada Auto Stock Monitor.js` file.
2. Copy the entire JavaScript code.
3. Open your browser's Tampermonkey Dashboard, click the **Add New Script** button (plus icon), and paste the copied code.
4. Save the script (`Ctrl + S` or `File > Save`).

---

## ⚙️ Configuration & GUI Guide

Once installed, navigate to any Lazada product page (e.g., Lazada SG). You will see the floating **Lazada Buy Bot** panel in the bottom-right corner of your browser. You can click the `—` button to collapse it.

| Field | Description |
| :--- | :--- |
| **Quantity** | The number of items to purchase. |
| **Min Ref (s) / Max Ref (s)** | The random range of seconds the script will wait between API stock checks. Jitter (random milliseconds) is added automatically. |
| **Card Number** | Your payment card number (for auto-filling checkout fields). |
| **Name on Card** | Cardholder name. |
| **Expiry** | Expiry date formatted as `MM/YY`. |
| **CVV** | 3-digit or 4-digit card security code. |
| **TG Bot Token** | The HTTP API token from Telegram's `@BotFather` (leave blank to disable). |
| **TG Chat ID** | Your Telegram Chat ID (retrieve via `@userinfobot`). |
| **Discord Webhook** | A Discord channel webhook URL (e.g., `https://discord.com/api/webhooks/...`). |

### 🔊 Note on Audio Alerts
The script will play an audio beep automatically when stock is found or a Captcha occurs. Ensure that your browser allows audio playback for the Lazada domain (sometimes browsers block autoplaying audio until you interact with the page once by clicking anywhere).

---

## ⚠️ Disclaimer

This bot is created for educational and personal convenience purposes. Using automation bots on e-commerce platforms may violate their Terms of Service. Use at your own risk. The developer is not responsible for any account suspensions, incorrect orders, or financial issues resulting from the use of this script.
