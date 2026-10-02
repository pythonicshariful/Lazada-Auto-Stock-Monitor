// ==UserScript==
// @name         Lazada Auto Stock Monitor & Quick Buy Bot
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Automated stock checker using Lazada's internal MTOP API (no page refresh = anti-bot safe), with DOM fallback. Includes quantity selector and Buy Now trigger with modern GUI.
// @author       Pythonic Shariful
// @match        https://*.lazada.sg/*
// @match        https://s.lazada.sg/*
// @match        https://*.lazada.com/*
// @match        https://lazada.sg/*
// @match        http://*.lazada.sg/*
// @match        http://s.lazada.sg/*
// @match        http://*.lazada.com/*
// @match        http://lazada.sg/*
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    console.log('🤖 [Lazada Bot] Script loaded and running!');

    // Default configuration & State Keys
    const STORAGE_KEY = 'lazada_bot_config';

    const defaultConfig = {
        enabled: false,
        quantity: 1,
        minRefresh: 8, // min random refresh in seconds
        maxRefresh: 15, // max random refresh in seconds
        cardNumber: '3746 7590 3972 476',
        cardName: 'Shariful Islam',
        expiryDate: '11/27',
        cvv: '444',
        tgBotToken: '8156587833:AAEwTAIdqcTkT6U8fSj4uD49AdKklG2nfdc',
        tgChatId: '7809021498',
        discordWebhook: '',
        lastStatus: 'Idle'
    };

    function setConfig(newConfig) {
        try {
            const stateToSave = { ...newConfig };
            stateToSave.scriptDefaults = {};
            for (const key of Object.keys(defaultConfig)) {
                stateToSave.scriptDefaults[key] = defaultConfig[key];
            }

            const str = JSON.stringify(stateToSave);
            localStorage.setItem(STORAGE_KEY, str);

            // Set domain-wide cookie so checkout subdomains share active bot state
            const hostname = window.location.hostname;
            const parts = hostname.split('.');
            let domain = hostname;
            if (parts.length >= 2) {
                domain = '.' + parts.slice(-2).join('.');
            }
            document.cookie = `${STORAGE_KEY}=${encodeURIComponent(str)}; domain=${domain}; path=/; max-age=86400; SameSite=Lax`;
        } catch (e) {
            console.error('Lazada Bot: Failed to save config', e);
        }
    }

    function getConfig() {
        try {
            let config = { ...defaultConfig };
            // 1. Try reading domain-wide Cookie first to bridge cross-subdomain navigation
            const nameEQ = STORAGE_KEY + "=";
            const ca = document.cookie.split(';');
            let parsed = null;

            for (let i = 0; i < ca.length; i++) {
                let c = ca[i].trim();
                if (c.indexOf(nameEQ) === 0) {
                    const cookieVal = decodeURIComponent(c.substring(nameEQ.length));
                    parsed = JSON.parse(cookieVal);
                    break;
                }
            }

            // 2. Fallback to LocalStorage
            if (!parsed) {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) parsed = JSON.parse(saved);
            }

            if (parsed && typeof parsed === 'object') {
                const savedDefaults = parsed.scriptDefaults || {};
                config = { ...defaultConfig, ...parsed };

                // If any value in the script's defaultConfig is different from the saved defaults,
                // it means the user edited the hardcoded value in the script. Override the loaded value.
                for (const key of Object.keys(defaultConfig)) {
                    if (key === 'scriptDefaults' || key === 'lastStatus') continue;
                    if (savedDefaults[key] !== undefined && defaultConfig[key] !== savedDefaults[key]) {
                        config[key] = defaultConfig[key];
                    }
                }

                // Ensure hardcoded defaults are preserved if token/chatId in saved state is empty
                if (!config.tgBotToken || !config.tgBotToken.trim()) {
                    config.tgBotToken = defaultConfig.tgBotToken;
                }
                if (!config.tgChatId || !config.tgChatId.trim()) {
                    config.tgChatId = defaultConfig.tgChatId;
                }
            }

            // Keep local storage and cookie in sync
            const stateToSave = { ...config };
            stateToSave.scriptDefaults = {};
            for (const key of Object.keys(defaultConfig)) {
                stateToSave.scriptDefaults[key] = defaultConfig[key];
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
            
            return config;
        } catch (e) {
            return defaultConfig;
        }
    }

    let state = getConfig();
    let checkLoopTimer = null;
    let reloadTimer = null;
    let timeUntilReload = 0;

    // --- UI Creation ---
    function injectUI() {
        if (document.getElementById('lazada-bot-root')) return;

        console.log('🤖 [Lazada Bot] Injecting UI...');
        const container = document.createElement('div');
        container.id = 'lazada-bot-root';
        container.innerHTML = `
            <div id="lazada-bot-panel">
                <div class="bot-header">
                    <div class="bot-title">
                        <span class="bot-status-dot ${state.enabled ? 'active' : ''}"></span>
                        ⚡ Lazada Buy Bot
                    </div>
                    <button type="button" id="bot-toggle-btn" class="bot-icon-btn">—</button>
                </div>
                <div id="bot-body" class="bot-body">
                    <div class="bot-field-row">
                        <div class="bot-field-group flex-1">
                            <label for="bot-qty">Quantity</label>
                            <input type="number" id="bot-qty" min="1" max="99" value="${state.quantity}">
                        </div>
                        <div class="bot-field-group flex-1">
                            <label for="bot-min-refresh">Min Ref (s)</label>
                            <input type="number" id="bot-min-refresh" min="1" max="120" value="${state.minRefresh}">
                        </div>
                        <div class="bot-field-group flex-1">
                            <label for="bot-max-refresh">Max Ref (s)</label>
                            <input type="number" id="bot-max-refresh" min="1" max="120" value="${state.maxRefresh}">
                        </div>
                    </div>
                    <div class="bot-field-group">
                        <label for="bot-card-number">Card Number</label>
                        <input type="text" id="bot-card-number" placeholder="Card Number" value="${state.cardNumber || ''}">
                    </div>
                    <div class="bot-field-row">
                        <div class="bot-field-group flex-1">
                            <label for="bot-card-name">Name on Card</label>
                            <input type="text" id="bot-card-name" placeholder="Name" value="${state.cardName || ''}">
                        </div>
                        <div class="bot-field-group" style="width: 65px;">
                            <label for="bot-expiry">Expiry</label>
                            <input type="text" id="bot-expiry" placeholder="MM/YY" value="${state.expiryDate || ''}">
                        </div>
                        <div class="bot-field-group" style="width: 55px;">
                            <label for="bot-cvv">CVV</label>
                            <input type="text" id="bot-cvv" placeholder="CVV" value="${state.cvv || ''}">
                        </div>
                    </div>
                    <div class="bot-field-row">
                        <div class="bot-field-group flex-1">
                            <label for="bot-tg-token">TG Bot Token</label>
                            <input type="password" id="bot-tg-token" placeholder="Bot Token" value="${state.tgBotToken || ''}">
                        </div>
                        <div class="bot-field-group flex-1">
                            <label for="bot-tg-chatid">TG Chat ID</label>
                            <input type="text" id="bot-tg-chatid" placeholder="Chat ID" value="${state.tgChatId || ''}">
                        </div>
                    </div>
                    <div class="bot-field-row">
                        <div class="bot-field-group flex-1">
                            <label for="bot-discord">Discord Webhook</label>
                            <input type="text" id="bot-discord" placeholder="https://discord.com/api/webhooks/..." value="${state.discordWebhook || ''}">
                        </div>
                    </div>
                    <div class="bot-action-row">
                        <button type="button" id="bot-start-btn" class="bot-btn bot-btn-primary ${state.enabled ? 'hidden' : ''}">▶ Start Bot</button>
                        <button type="button" id="bot-stop-btn" class="bot-btn bot-btn-danger ${!state.enabled ? 'hidden' : ''}">⏹ Stop Bot</button>
                    </div>
                    <div class="bot-status-box">
                        <div class="bot-status-label">STATUS</div>
                        <div id="bot-status-text">${state.lastStatus || 'Idle'}</div>
                    </div>
                </div>
            </div>
        `;

        // Prevent events inside Bot UI from leaking to page forms
        container.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Inject to html or body (some frameworks clear body, html is safer)
        (document.body || document.documentElement).appendChild(container);
        
        if (!document.getElementById('lazada-bot-styles')) {
            addStyles();
        }
        bindUIEvents();
    }

    function addStyles() {
        const style = document.createElement('style');
        style.id = 'lazada-bot-styles';
        style.textContent = `
            #lazada-bot-root {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                font-size: 13px;
                color: #e2e8f0;
            }
            #lazada-bot-panel {
                width: 320px;
                background: rgba(15, 23, 42, 0.92);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 14px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .bot-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.8));
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .bot-title {
                font-weight: 700;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 8px;
                background: linear-gradient(90deg, #38bdf8, #818cf8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .bot-status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: #64748b;
                display: inline-block;
                transition: background-color 0.3s ease;
            }
            .bot-status-dot.active {
                background-color: #22c55e;
                box-shadow: 0 0 8px #22c55e;
            }
            .bot-icon-btn {
                background: transparent;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                font-size: 14px;
                padding: 2px 6px;
                border-radius: 4px;
            }
            .bot-icon-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
            .bot-body {
                padding: 14px 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .bot-body.collapsed {
                display: none;
            }
            .bot-field-group {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .bot-field-row {
                display: flex;
                gap: 10px;
            }
            .flex-1 { flex: 1; }
            .bot-field-group label {
                font-size: 11px;
                color: #94a3b8;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .bot-field-group input {
                background: rgba(30, 41, 59, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 8px 10px;
                color: #f8fafc;
                font-size: 12px;
                outline: none;
                transition: border-color 0.2s;
            }
            .bot-field-group input:focus {
                border-color: #38bdf8;
            }
            .bot-action-row {
                margin-top: 4px;
            }
            .bot-btn {
                width: 100%;
                padding: 10px;
                border-radius: 8px;
                border: none;
                font-weight: 700;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .bot-btn-primary {
                background: linear-gradient(135deg, #0284c7, #2563eb);
                color: #ffffff;
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            }
            .bot-btn-primary:hover {
                background: linear-gradient(135deg, #0369a1, #1d4ed8);
            }
            .bot-btn-danger {
                background: linear-gradient(135deg, #dc2626, #b91c1c);
                color: #ffffff;
                box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
            }
            .bot-btn-danger:hover {
                background: linear-gradient(135deg, #b91c1c, #991b1b);
            }
            .hidden { display: none !important; }
            .bot-status-box {
                background: rgba(15, 23, 42, 0.7);
                border-radius: 8px;
                padding: 8px 12px;
                border-left: 3px solid #38bdf8;
            }
            .bot-status-label {
                font-size: 10px;
                color: #64748b;
                font-weight: 700;
            }
            #bot-status-text {
                font-size: 12px;
                color: #38bdf8;
                font-weight: 600;
                margin-top: 2px;
                word-break: break-word;
            }
        `;
        document.head.appendChild(style);
    }

    function updateStatus(text, type = 'info') {
        state.lastStatus = text;
        setConfig(state);
        const statusEl = document.getElementById('bot-status-text');
        if (statusEl) {
            statusEl.textContent = text;
            if (type === 'success') statusEl.style.color = '#4ade80';
            else if (type === 'warn') statusEl.style.color = '#fbbf24';
            else if (type === 'error') statusEl.style.color = '#f87171';
            else statusEl.style.color = '#38bdf8';
        }
        console.log(`🤖 [Lazada Bot] ${text}`);
    }

    function bindUIEvents() {
        const toggleBtn = document.getElementById('bot-toggle-btn');
        const bodyEl = document.getElementById('bot-body');
        const startBtn = document.getElementById('bot-start-btn');
        const stopBtn = document.getElementById('bot-stop-btn');
        const qtyInput = document.getElementById('bot-qty');
        const minInput = document.getElementById('bot-min-refresh');
        const maxInput = document.getElementById('bot-max-refresh');
        const cardNumInput = document.getElementById('bot-card-number');
        const cardNameInput = document.getElementById('bot-card-name');
        const expiryInput = document.getElementById('bot-expiry');
        const cvvInput = document.getElementById('bot-cvv');
        const tgTokenInput = document.getElementById('bot-tg-token');
        const tgChatIdInput = document.getElementById('bot-tg-chatid');
        const discordInput = document.getElementById('bot-discord');
        const statusDot = document.querySelector('.bot-status-dot');

        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            bodyEl.classList.toggle('collapsed');
            toggleBtn.textContent = bodyEl.classList.contains('collapsed') ? '+' : '—';
        });

        startBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const qtyVal = parseInt(qtyInput.value, 10) || 1;
            const minVal = parseInt(minInput.value, 10) || 3;
            const maxVal = parseInt(maxInput.value, 10) || 7;

            state.enabled = true;
            state.quantity = qtyVal;
            state.minRefresh = minVal;
            state.maxRefresh = Math.max(minVal, maxVal);
            state.cardNumber = cardNumInput ? cardNumInput.value.trim() : state.cardNumber;
            state.cardName = cardNameInput ? cardNameInput.value.trim() : state.cardName;
            state.expiryDate = expiryInput ? expiryInput.value.trim() : state.expiryDate;
            state.cvv = cvvInput ? cvvInput.value.trim() : state.cvv;
            state.tgBotToken = tgTokenInput ? tgTokenInput.value.trim() : state.tgBotToken;
            state.tgChatId = tgChatIdInput ? tgChatIdInput.value.trim() : state.tgChatId;
            state.discordWebhook = discordInput ? discordInput.value.trim() : state.discordWebhook;
            setConfig(state);

            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            if (statusDot) statusDot.classList.add('active');

            updateStatus('Bot started. Checking navigation...', 'info');
            checkAndRunBot();
        });

        stopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            state.enabled = false;
            setConfig(state);

            if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
            if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
            if (mtopPollTimer) { clearInterval(mtopPollTimer); mtopPollTimer = null; }
            isMtopPolling = false;

            stopBtn.classList.add('hidden');
            startBtn.classList.remove('hidden');
            if (statusDot) statusDot.classList.remove('active');

            updateStatus('Bot stopped by user.', 'warn');
        });

        qtyInput.addEventListener('change', () => {
            state.quantity = parseInt(qtyInput.value, 10) || 1;
            setConfig(state);
        });
        minInput.addEventListener('change', () => {
            state.minRefresh = parseInt(minInput.value, 10) || 3;
            if (state.maxRefresh < state.minRefresh) state.maxRefresh = state.minRefresh;
            maxInput.value = state.maxRefresh;
            setConfig(state);
        });
        maxInput.addEventListener('change', () => {
            state.maxRefresh = parseInt(maxInput.value, 10) || 7;
            if (state.maxRefresh < state.minRefresh) state.maxRefresh = state.minRefresh;
            maxInput.value = state.maxRefresh;
            setConfig(state);
        });
        cardNumInput?.addEventListener('change', () => {
            state.cardNumber = cardNumInput.value.trim();
            setConfig(state);
        });
        cardNameInput?.addEventListener('change', () => {
            state.cardName = cardNameInput.value.trim();
            setConfig(state);
        });
        expiryInput?.addEventListener('change', () => {
            state.expiryDate = expiryInput.value.trim();
            setConfig(state);
        });
        cvvInput?.addEventListener('change', () => {
            state.cvv = cvvInput.value.trim();
            setConfig(state);
        });
        tgTokenInput?.addEventListener('change', () => {
            state.tgBotToken = tgTokenInput.value.trim();
            setConfig(state);
        });
        tgChatIdInput?.addEventListener('change', () => {
            state.tgChatId = tgChatIdInput.value.trim();
            setConfig(state);
        });
        discordInput?.addEventListener('change', () => {
            state.discordWebhook = discordInput.value.trim();
            setConfig(state);
        });
    }

    // --- Audio Notification ---
    function playAlertSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch(e) { console.error('Audio play failed', e); }
    }

    // --- Notifications ---
    function sendTelegramNotification(message) {
        playAlertSound();

        // Discord Notification
        if (state.discordWebhook && state.discordWebhook.trim().startsWith('http')) {
            console.log(`🤖 [Lazada Bot] Sending Discord notification...`);
            const payload = JSON.stringify({ content: `🔔 **Lazada Bot Alert**\n${message}` });
            if (typeof GM_xmlhttpRequest === 'function') {
                try {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: state.discordWebhook.trim(),
                        headers: { "Content-Type": "application/json" },
                        data: payload
                    });
                } catch(e){}
            } else {
                fetch(state.discordWebhook.trim(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                }).catch(()=>{});
            }
        }

        const token = (state.tgBotToken && state.tgBotToken.trim()) ? state.tgBotToken.trim() : defaultConfig.tgBotToken;
        const chatId = (state.tgChatId && state.tgChatId.trim()) ? state.tgChatId.trim() : defaultConfig.tgChatId;
        
        if (!token || !chatId) {
            console.log('🤖 [Lazada Bot] Telegram notification skipped: Bot token or Chat ID missing.');
            return;
        }

        const encodedText = encodeURIComponent(`🔔 Lazada Bot Alert\n${message}`);
        const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodedText}&parse_mode=HTML`;

        console.log(`🤖 [Lazada Bot] Sending Telegram notification to Chat ID ${chatId}...`);

        // 1. Try GM_xmlhttpRequest if available dynamically
        if (typeof GM_xmlhttpRequest === 'function') {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: (res) => console.log('🤖 [Lazada Bot] Telegram GM_xmlhttpRequest Success:', res.responseText),
                    onerror: (err) => console.error('🤖 [Lazada Bot] Telegram GM_xmlhttpRequest Error:', err)
                });
                return;
            } catch (e) {}
        }

        // 2. Fetch with no-cors mode
        fetch(url, { mode: 'no-cors' })
            .then(() => console.log('🤖 [Lazada Bot] Telegram fetch (no-cors) dispatched.'))
            .catch(() => {
                // 3. Image Beacon fallback (bypasses all CORS blocks)
                const img = new Image();
                img.src = url;
                console.log('🤖 [Lazada Bot] Telegram Image Beacon dispatched.');
            });
    }

    // SPA URL Change Observer & Interceptor
    let lastKnownUrl = window.location.href;

    function observeUrlChanges() {
        const checkUrl = () => {
            const currentUrl = window.location.href;
            if (currentUrl !== lastKnownUrl) {
                lastKnownUrl = currentUrl;
                console.log(`🤖 [Lazada Bot] SPA URL changed: ${currentUrl}`);
                ensureUI();
                state = getConfig();
                if (state.enabled) {
                    checkAndRunBot();
                }
            }
        };

        const wrapHistory = (type) => {
            const orig = history[type];
            if (orig) {
                history[type] = function (...args) {
                    const result = orig.apply(this, args);
                    setTimeout(checkUrl, 100);
                    return result;
                };
            }
        };

        wrapHistory('pushState');
        wrapHistory('replaceState');
        window.addEventListener('popstate', checkUrl);
        window.addEventListener('hashchange', checkUrl);
    }

    // --- Anti-Bot / Baxia Security Check Detection ---
    function checkBaxiaPunish() {
        return document.querySelector(
            '#baxia-dialog-content, ' +
            'iframe[src*="bixi.alicdn.com/punish"], ' +
            'iframe[src*="action=deny"], ' +
            'iframe[src*="punish:resource"], ' +
            'iframe[src*="_____tmd_____/punish"], ' +
            'iframe[src*="action=captcha"]'
        );
    }

    let baxiaAutoSolveTimer = null;   // monitors captcha disappearance
    let baxiaClickAttempts = 0;       // how many times we've tried clicking
    let baxiaSolveMode = false;       // true while we're in captcha-solve mode

    function handleBaxiaPunishDetected(iframeEl) {
        // Pause timers but don't disable the bot - we'll resume after solve
        if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
        if (mtopPollTimer) { clearInterval(mtopPollTimer); mtopPollTimer = null; }
        isMtopPolling = false;
        // NOTE: we intentionally keep checkLoopTimer running but at reduced rate
        //       so botTick keeps monitoring until the captcha is gone.

        if (baxiaSolveMode) return; // Already handling - don't double-fire
        baxiaSolveMode = true;
        baxiaClickAttempts = 0;

        updateStatus('🤖 Captcha detected! Attempting auto-solve...', 'warn');

        const iframeSrc = iframeEl ? (iframeEl.src || iframeEl.getAttribute('src') || 'Unknown') : 'Detected';
        const isRecaptcha = iframeSrc.includes('captcharecaptcha') || iframeSrc.includes('recaptcha');

        // Send Telegram alert (non-blocking)
        sendTelegramNotification(
            `⚠️ <b>Baxia Captcha Triggered</b>\n\n` +
            `🔍 <b>Type:</b> ${isRecaptcha ? 'reCAPTCHA' : 'Baxia Punish'}\n` +
            `🔗 <b>Page:</b> ${window.location.href}\n` +
            `⏰ <b>Time:</b> ${new Date().toLocaleString()}\n` +
            `<i>Attempting auto-click... Bot will resume if solved.</i>`
        );

        // Try auto-clicking the reCAPTCHA checkbox
        tryAutoClickCaptcha(iframeEl, isRecaptcha);

        // Monitor for captcha disappearance (MutationObserver)
        watchForCaptchaResolution();
    }

    // Attempt to auto-click the reCAPTCHA "I am not a robot" checkbox
    function tryAutoClickCaptcha(baxiaIframe, isRecaptcha) {
        if (!state.enabled && !baxiaSolveMode) return;
        baxiaClickAttempts++;

        // Strategy 1: Find the nested Google reCAPTCHA iframe by title/name
        //   Google reCAPTCHA embeds: <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/...">
        //   We can find it in the main document (if Lazada injected it at top-level)
        const recaptchaIframes = document.querySelectorAll(
            'iframe[title="reCAPTCHA"], ' +
            'iframe[src*="recaptcha/api2/anchor"], ' +
            'iframe[src*="recaptcha/enterprise/anchor"], ' +
            'iframe[src*="www.google.com/recaptcha"]'
        );

        if (recaptchaIframes.length > 0) {
            for (const rcIframe of recaptchaIframes) {
                if (rcIframe.offsetWidth > 0 && rcIframe.offsetHeight > 0) {
                    updateStatus(`🤖 Found reCAPTCHA iframe! Clicking checkbox (attempt ${baxiaClickAttempts})...`, 'warn');
                    clickInsideRecaptchaIframe(rcIframe);
                    break;
                }
            }
        } else {
            // Strategy 2: Click on baxia iframe itself at the expected checkbox position.
            // reCAPTCHA checkbox is at roughly (35, 35) inside the iframe widget.
            // The baxia iframe is the container - we find the expected offset.
            if (baxiaIframe && baxiaIframe.offsetWidth > 0) {
                updateStatus(`🤖 Clicking baxia container at checkbox position (attempt ${baxiaClickAttempts})...`, 'warn');
                clickAtIframeCheckboxPosition(baxiaIframe);
            }
        }

        // Retry auto-click every 2s for up to 10 attempts
        if (baxiaClickAttempts < 10) {
            setTimeout(() => {
                if (!baxiaSolveMode) return; // Already resolved
                const stillPresent = checkBaxiaPunish();
                if (stillPresent) {
                    tryAutoClickCaptcha(stillPresent, isRecaptcha);
                }
            }, 2000);
        } else {
            // Gave up auto-solving - notify user to solve manually, keep waiting
            updateStatus('⚠️ Auto-solve failed. Please solve CAPTCHA manually. Bot will auto-resume.', 'error');
            sendTelegramNotification(
                `🚨 <b>Auto-solve FAILED</b>\n` +
                `Please solve the Lazada CAPTCHA manually.\n` +
                `🔗 ${window.location.href}\n` +
                `<i>Bot will auto-resume once CAPTCHA is solved.</i>`
            );
        }
    }

    // Click the checkbox inside a Google reCAPTCHA iframe
    // The checkbox element is inside a cross-origin iframe, so we use
    // simulated pointer events at the element's screen position instead.
    function clickInsideRecaptchaIframe(iframe) {
        try {
            const rect = iframe.getBoundingClientRect();
            // reCAPTCHA checkbox is at approx (28, 28) inside the iframe
            const clickX = rect.left + 28;
            const clickY = rect.top + 28;

            // Simulate realistic pointer event sequence at the checkbox position
            const evtOpts = (type, x, y) => new PointerEvent(type, {
                bubbles: true, cancelable: true,
                clientX: x, clientY: y,
                pointerId: 1, pointerType: 'mouse',
                view: window
            });

            document.elementFromPoint(clickX, clickY)?.dispatchEvent(evtOpts('pointerdown', clickX, clickY));
            document.elementFromPoint(clickX, clickY)?.dispatchEvent(evtOpts('pointerup', clickX, clickY));

            // Use elementFromPoint to get the element at that exact coordinate
            const el = document.elementFromPoint(clickX, clickY);
            if (el) {
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: clickX, clientY: clickY, view: window }));
            }

            // Also dispatch directly on the iframe
            iframe.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: clickX, clientY: clickY, view: window }));

            console.log(`🤖 [Lazada Bot] Clicked reCAPTCHA at (${clickX.toFixed(0)}, ${clickY.toFixed(0)})`);
        } catch (e) {
            console.warn('🤖 [Lazada Bot] reCAPTCHA click error:', e);
        }
    }

    // Fallback: click the baxia wrapper iframe at the expected inner checkbox position
    function clickAtIframeCheckboxPosition(baxiaIframe) {
        try {
            const rect = baxiaIframe.getBoundingClientRect();
            // Guess that the reCAPTCHA widget is rendered ~40px from left, ~50% of height
            // Typical Lazada baxia dialog has reCAPTCHA centered; try multiple positions
            const positions = [
                { x: rect.left + 35, y: rect.top + (rect.height * 0.5) },  // centre-left
                { x: rect.left + 35, y: rect.top + 60 },                   // fixed 60px from top
                { x: rect.left + 35, y: rect.top + 100 },                  // fixed 100px from top
                { x: rect.left + (rect.width * 0.15), y: rect.top + (rect.height * 0.45) }, // 15% x, 45% y
            ];

            positions.forEach(({ x, y }, i) => {
                setTimeout(() => {
                    if (!baxiaSolveMode) return;
                    const el = document.elementFromPoint(x, y);
                    if (el) {
                        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y, view: window }));
                        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, view: window }));
                        el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: x, clientY: y, view: window }));
                        el.dispatchEvent(new MouseEvent('click',     { bubbles: true, clientX: x, clientY: y, view: window }));
                    }
                    console.log(`🤖 [Lazada Bot] Baxia iframe click position ${i+1}: (${x.toFixed(0)}, ${y.toFixed(0)})`);
                }, i * 300);
            });
        } catch (e) {
            console.warn('🤖 [Lazada Bot] Baxia iframe position click error:', e);
        }
    }

    // Watch for the baxia/captcha iframe to disappear, then auto-resume bot
    function watchForCaptchaResolution() {
        if (baxiaAutoSolveTimer) clearInterval(baxiaAutoSolveTimer);

        let checkCount = 0;
        baxiaAutoSolveTimer = setInterval(() => {
            checkCount++;
            const stillThere = checkBaxiaPunish();

            if (!stillThere) {
                // Captcha solved! Resume the bot.
                clearInterval(baxiaAutoSolveTimer);
                baxiaAutoSolveTimer = null;
                baxiaSolveMode = false;
                baxiaClickAttempts = 0;

                updateStatus('✅ CAPTCHA solved! Bot resuming in 2s...', 'success');
                sendTelegramNotification(
                    `✅ <b>CAPTCHA Solved!</b>\n` +
                    `Bot is resuming automatically.\n` +
                    `🔗 ${window.location.href}`
                );

                // Short delay to let the page settle, then resume
                setTimeout(() => {
                    if (state.enabled) {
                        checkAndRunBot();
                    }
                }, 2000);

            } else if (checkCount > 180) {
                // Timed out after ~3 minutes - stop the bot
                clearInterval(baxiaAutoSolveTimer);
                baxiaAutoSolveTimer = null;
                baxiaSolveMode = false;

                state.enabled = false;
                setConfig(state);
                updateStatus('🚨 CAPTCHA timeout (3min). Bot stopped. Solve manually.', 'error');
                sendTelegramNotification(
                    `🚨 <b>CAPTCHA Timeout!</b>\n` +
                    `Could not solve CAPTCHA within 3 minutes.\nBot has been stopped.\n` +
                    `🔗 ${window.location.href}`
                );

                // Update UI buttons to reflect stopped state
                const startBtn = document.getElementById('bot-start-btn');
                const stopBtn  = document.getElementById('bot-stop-btn');
                const statusDot = document.querySelector('.bot-status-dot');
                if (startBtn) startBtn.classList.remove('hidden');
                if (stopBtn)  stopBtn.classList.add('hidden');
                if (statusDot) statusDot.classList.remove('active');
            } else {
                // Still waiting - update status every 10s
                if (checkCount % 10 === 0) {
                    const secondsLeft = 180 - checkCount;
                    updateStatus(
                        baxiaClickAttempts < 10
                            ? `🤖 Auto-solving CAPTCHA... (${secondsLeft}s timeout)`
                            : `⌛ Waiting for manual CAPTCHA solve... (${secondsLeft}s)`,
                        'warn'
                    );
                }
            }
        }, 1000); // Check every second
    }

    // --- Main Bot Logic ---
    function checkAndRunBot() {
        state = getConfig();
        if (!state.enabled) return;

        if (checkLoopTimer) clearInterval(checkLoopTimer);

        const botTick = () => {
            state = getConfig();
            if (!state.enabled) {
                if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
                return;
            }

            // Check Baxia / Punish security dialog
            const baxia = checkBaxiaPunish();
            if (baxia) {
                handleBaxiaPunishDetected(baxia); // baxiaSolveMode guard prevents double-fire
                return; // Pause normal bot flow while CAPTCHA is present
            }
            // If we just finished solving a captcha, reset solve mode
            if (baxiaSolveMode) {
                baxiaSolveMode = false;
                baxiaClickAttempts = 0;
            }

            // Check order success page redirect
            if (window.location.href.includes('/order/success') || window.location.href.includes('order-success')) {
                if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
                updateStatus('🎉 ORDER SUCCESS CONFIRMED ON LAZADA!', 'success');
                sendTelegramNotification(`🎉 <b>Lazada Order Success Confirmed!</b>\n\nRedirected to order success page:\n${window.location.href}`);
                state.enabled = false;
                setConfig(state);
                return;
            }

            // Always re-evaluate URL dynamically on every tick
            if (window.location.href.includes('/checkout') || window.location.href.includes('checkout.')) {
                if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
                handleCheckoutPage();
                return;
            }

            runStockCheck();
        };

        botTick();
        checkLoopTimer = setInterval(botTick, 800);
    }
    
    function triggerClick(el) {
        if (!el) return;
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        try { el.focus(); } catch (e) {}
        
        let rect = { x: 0, y: 0, width: 0, height: 0 };
        try { rect = el.getBoundingClientRect(); } catch(e) {}
        const clientX = rect.x + (rect.width / 2);
        const clientY = rect.y + (rect.height / 2);
        
        const opts = { bubbles: true, cancelable: true, clientX: clientX, clientY: clientY, detail: 1 };
        
        // 1. Direct React/Rax Props Invocation (Ultimate Anti-Bot Bypass)
        try {
            const tryReactClick = (node) => {
                if (!node) return false;
                for (let key of Object.keys(node)) {
                    if (key.startsWith('__reactProps') || key.startsWith('__reactEventHandlers') || key.startsWith('__raxProps') || key.startsWith('__reactInternalInstance')) {
                        const props = node[key];
                        if (props && typeof props.onClick === 'function') {
                            props.onClick({ 
                                preventDefault: () => {}, 
                                stopPropagation: () => {}, 
                                target: node, 
                                currentTarget: node,
                                clientX: clientX,
                                clientY: clientY,
                                pageX: clientX,
                                pageY: clientY,
                                nativeEvent: { stopImmediatePropagation: () => {} }
                            });
                            console.log('🤖 [Lazada Bot] Successfully invoked React onClick directly on', node);
                            return true;
                        }
                    }
                }
                return false;
            };
            
            // Try on element, or its wrapper
            if (!tryReactClick(el)) {
                const parentBtn = el.closest('button, a, .checkout-order-total, [data-spm-anchor-id]');
                if (parentBtn && parentBtn !== el) {
                    tryReactClick(parentBtn);
                }
            }
        } catch(e) {}

        // 2. Simulate standard hover & click down
        try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch(e){}
        try { el.dispatchEvent(new MouseEvent('mouseover', opts)); } catch(e){}
        
        try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e){}
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        
        // 3. Human-like delay between down and up
        setTimeout(() => {
            try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e){}
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            
            el.click();
            el.dispatchEvent(new MouseEvent('click', opts));
            
            // Fallback: If it's a div/span, maybe the real click listener is on a parent wrapper
            try {
                const parentBtn = el.closest('button, a, .checkout-order-total, [data-spm-anchor-id]');
                if (parentBtn && parentBtn !== el) {
                    parentBtn.click();
                    parentBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
                    parentBtn.dispatchEvent(new MouseEvent('mousedown', opts));
                    parentBtn.dispatchEvent(new PointerEvent('pointerup', opts));
                    parentBtn.dispatchEvent(new MouseEvent('mouseup', opts));
                    parentBtn.dispatchEvent(new MouseEvent('click', opts));
                }
            } catch(e){}
        }, 50 + Math.random() * 50); // 50-100ms delay
    }

    // --- Checkout Automation ---
    function handleCheckoutPage(attempts = 0) {
        if (!state.enabled) return;

        // Step 0: Check Baxia Security Dialog
        const baxia = checkBaxiaPunish();
        if (baxia) {
            handleBaxiaPunishDetected(baxia);
            return;
        }

        updateStatus('💳 On Checkout page! Checking components...', 'info');

        // Step 1: Check if payment card input panel is already visible
        const creditCardInput = document.querySelector('#creditCard, .automation-input-new-card-number input, .add-card-outer-wrapper');
        
        if (creditCardInput) {
            updateStatus('💳 Credit Card panel detected! Pre-filling details...', 'info');
            fillCreditCardDetailsAndConfirm();
            return;
        }

        // Step 2: Check if Delivery Slot Selection Grid/Modal is currently open
        const slotGrid = document.querySelector('.single-select-delivery-slot-grid-inner, .single-select-delivery-slot-grid-content, .rm-single-select-slots-page-continue');
        if (slotGrid) {
            updateStatus('🚚 Delivery slot grid detected! Selecting available slot...', 'info');
            selectAvailableDeliverySlotAndConfirm();
            return;
        }

        // Step 3: Check if Delivery Slot needs to be opened ("Select your preferred slot")
        const slotTrigger = findDeliverySlotTrigger();
        if (slotTrigger) {
            updateStatus('🚚 Delivery slot needs selection. Opening slot picker...', 'info');
            triggerClick(slotTrigger);
            setTimeout(() => waitForSlotGridAndSelect(0), 400);
            return;
        }

        // Step 4: Search for PLACE ORDER NOW button
        const placeOrderBtn = findPlaceOrderButton();
        if (placeOrderBtn) {
            updateStatus('🚀 Found PLACE ORDER NOW button! Clicking...', 'info');
            triggerClick(placeOrderBtn);

            // Wait for credit card floating panel or delivery slot grid to open
            updateStatus('⏳ Waiting for Credit Card panel to appear...', 'info');
            waitForCardPanelAndConfirm(0);
            return;
        }

        if (attempts < 30) {
            setTimeout(() => handleCheckoutPage(attempts + 1), 500);
        } else {
            updateStatus('Waiting for Place Order button, Slot grid, or Payment panel...', 'warn');
            setTimeout(() => handleCheckoutPage(0), 1000);
        }
    }

    function findDeliverySlotTrigger() {
        // 1. Check the active/first delivery item to see if a slot is actually needed
        const firstDeliveryItem = document.querySelector('.delivery-item[data-index="0"], .delivery-option-body .delivery-item');
        if (firstDeliveryItem) {
            const innerBtn = firstDeliveryItem.querySelector('.delivery-item-bottom');
            if (innerBtn) {
                // If it's a "no schedule" delivery option (e.g. Standard) and is already selected, NO picker is needed.
                if (innerBtn.classList.contains('delivery-item-bottom-no-schedule-selected-nlu')) {
                    return null;
                }
                
                // If it's a schedule-based option that is ALREADY selected and has a valid date
                if (innerBtn.classList.contains('delivery-item-bottom-schedule-pre-selected')) {
                    const text = (innerBtn.innerText || innerBtn.textContent || '').trim().toLowerCase();
                    if (!text.includes('select') && !text.includes('preferred')) {
                        return null; // Valid date already selected, proceed to Place Order!
                    }
                }
            }
        }

        // 2. If it explicitly says "select your preferred slot", we MUST click it
        const timeTexts = document.querySelectorAll('.delivery-option-body .redmart-delivery-item-time, .delivery-option-body .delivery-item-bottom, .redmart-delivery-item-time-text');
        for (let el of timeTexts) {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (text.includes('select your preferred slot') || text.includes('select slot') || text.includes('preferred slot')) {
                if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                    return el;
                }
            }
        }

        // 3. Fallback: if there's a schedule-based option that is NOT selected, click it to open grid
        const unselectedSchedule = document.querySelector('.delivery-item-bottom-schedule-not-selected');
        if (unselectedSchedule && unselectedSchedule.offsetWidth > 0 && unselectedSchedule.offsetHeight > 0) {
            return unselectedSchedule;
        }

        return null;
    }

    function waitForSlotGridAndSelect(attempts = 0) {
        if (!state.enabled) return;

        const slotGrid = document.querySelector('.single-select-delivery-slot-grid-inner, .single-select-delivery-slot-grid-content, .rm-single-select-slots-page-continue');
        if (slotGrid) {
            selectAvailableDeliverySlotAndConfirm();
            return;
        }

        if (attempts < 20) {
            setTimeout(() => waitForSlotGridAndSelect(attempts + 1), 300);
        } else {
            updateStatus('Delivery slot grid not found, checking Place Order button...', 'warn');
            handleCheckoutPage(0);
        }
    }

    function selectAvailableDeliverySlotAndConfirm() {
        if (!state.enabled) return;

        // Find slot containers that are NOT disabled or fully booked
        const slotContainers = Array.from(document.querySelectorAll('.single-select-slot-item-container'));
        
        let availableSlot = slotContainers.find(container => {
            if (container.classList.contains('disabled')) return false;
            if (container.querySelector('.rm-singleSelect-slot-availability-tag-soldout')) return false;
            const radio = container.querySelector('input[type="radio"]');
            if (radio && radio.disabled) return false;
            return true;
        });

        if (!availableSlot) {
            // Fallback: check all radio buttons in slot grid
            const radios = document.querySelectorAll('.single-select-delivery-slot-grid-content input[type="radio"]:not([disabled])');
            if (radios.length > 0) {
                availableSlot = radios[0].closest('.single-select-slot-item-container') || radios[0];
            }
        }

        if (availableSlot) {
            updateStatus('✅ Available delivery slot found! Selecting slot...', 'info');
            
            // Click radio or container
            const radio = availableSlot.querySelector ? availableSlot.querySelector('input[type="radio"]') : availableSlot;
            if (radio) {
                radio.checked = true;
                triggerClick(radio);
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (availableSlot !== radio) {
                triggerClick(availableSlot);
            }

            // Short delay to register selection, then click "Confirm Slot" button
            setTimeout(() => {
                const confirmSlotBtn = document.querySelector('.rm-single-select-slots-page-continue, button.rm-single-select-slots-page-continue');
                let targetBtn = confirmSlotBtn;
                
                if (!targetBtn) {
                    // Fallback search by text "Confirm Slot"
                    const allBtns = document.querySelectorAll('button, div');
                    for (let b of allBtns) {
                        const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                        if (t === 'confirm slot' && b.offsetWidth > 0) {
                            targetBtn = b;
                            break;
                        }
                    }
                }

                if (targetBtn && !targetBtn.disabled) {
                    updateStatus('🚀 Clicking Confirm Slot...', 'success');
                    triggerClick(targetBtn);
                } else {
                    updateStatus('Confirm slot button not found or disabled.', 'warn');
                }

                // Wait for slot modal to process and return to checkout flow
                setTimeout(() => {
                    handleCheckoutPage(0);
                }, 800);
            }, 500);
        } else {
            updateStatus('⚠️ No available delivery slots in view! Scrolling right...', 'warn');
            
            // Try clicking right arrow button in slot grid if visible slots are fully booked
            const rightArrow = document.querySelector('.single-select-delivery-slot-grid-tall-button.right:not([disabled])');
            if (rightArrow && !rightArrow.disabled) {
                triggerClick(rightArrow);
                setTimeout(() => selectAvailableDeliverySlotAndConfirm(), 600);
            } else {
                updateStatus('All delivery slots appear fully booked.', 'error');
            }
        }
    }

    function findPlaceOrderButton() {
        // Iterate backwards to hit the most deeply nested (innermost) elements first!
        const candidates = Array.from(document.querySelectorAll('div, button, a, span')).reverse();
        
        // 1. Check exact text match first
        for (let el of candidates) {
            const text = (el.innerText || el.textContent || '').trim().toUpperCase();
            if ((text === 'PLACE ORDER NOW' || text === 'PLACE ORDER') && el.offsetWidth > 0 && el.offsetHeight > 0) {
                // Ensure it's the innermost element (no children that also contain the text)
                const hasTextChild = Array.from(el.children).some(c => {
                    const cText = (c.innerText || c.textContent || '').trim().toUpperCase();
                    return cText.includes('PLACE ORDER');
                });
                if (!hasTextChild) return el;
            }
        }

        // 2. Selector by data-spm-anchor-id or checkout order button class
        const spmBtns = Array.from(document.querySelectorAll('[data-spm-anchor-id*="shipping"], .checkout-order-total-button, .checkout-order-total')).reverse();
        for (let el of spmBtns) {
            const text = (el.innerText || el.textContent || '').trim().toUpperCase();
            if (text.includes('PLACE ORDER') && el.offsetWidth > 0 && el.offsetHeight > 0) {
                return el;
            }
        }

        // 3. Fallback: check elements containing text PLACE ORDER NOW
        for (let el of candidates) {
            const text = (el.innerText || el.textContent || '').trim().toUpperCase();
            if (text.includes('PLACE ORDER NOW') && el.offsetWidth > 0 && el.offsetHeight > 0) {
                const hasTextChild = Array.from(el.children).some(c => {
                    const cText = (c.innerText || c.textContent || '').trim().toUpperCase();
                    return cText.includes('PLACE ORDER');
                });
                if (!hasTextChild) return el;
            }
        }

        return null;
    }

    function waitForCardPanelAndConfirm(attempts = 0) {
        if (!state.enabled) return;

        const baxia = checkBaxiaPunish();
        if (baxia) {
            handleBaxiaPunishDetected(baxia);
            return;
        }

        const creditCardInput = document.querySelector('#creditCard, .automation-input-new-card-number input, .add-card-outer-wrapper');
        
        if (creditCardInput) {
            updateStatus('💳 Credit Card panel appeared! Pre-filling information...', 'info');
            fillCreditCardDetailsAndConfirm();
            return;
        }

        const slotGrid = document.querySelector('.single-select-delivery-slot-grid-content, .rm-single-select-slots-page-continue');
        if (slotGrid) {
            updateStatus('🚚 Delivery slot grid appeared! Selecting slot...', 'info');
            selectAvailableDeliverySlotAndConfirm();
            return;
        }

        if (attempts < 40) {
            setTimeout(() => waitForCardPanelAndConfirm(attempts + 1), 300);
        } else {
            updateStatus('⚠️ Credit Card panel did not open automatically. Retrying Place Order...', 'warn');
            handleCheckoutPage(0);
        }
    }

    function fillCreditCardDetailsAndConfirm() {
        if (!state.enabled) return;

        const cardNumInput = document.querySelector('#creditCard, .automation-input-new-card-number input');
        const cardNameInput = document.querySelector('#cardName, .automation-input-new-card-name input');
        const expiryInput = document.querySelector('#expiryDate, .automation-input-new-card-expire-date input');
        const cvvInput = document.querySelector('#cvv, .automation-input-new-card-cvv input');

        if (!cardNumInput && !cardNameInput) {
            updateStatus('Credit card input fields not ready yet, waiting...', 'warn');
            setTimeout(() => fillCreditCardDetailsAndConfirm(), 300);
            return;
        }

        if (cardNumInput && state.cardNumber) {
            setInputValue(cardNumInput, state.cardNumber);
        }
        if (cardNameInput && state.cardName) {
            setInputValue(cardNameInput, state.cardName);
        }
        if (expiryInput && state.expiryDate) {
            setInputValue(expiryInput, state.expiryDate);
        }
        if (cvvInput && state.cvv) {
            setInputValue(cvvInput, state.cvv);
        }

        updateStatus('✅ Card details pre-filled! Attempting to click Confirm...', 'info');

        setTimeout(() => {
            clickConfirmPaymentButton();
        }, 200);
    }

    let isConfirmClickScheduled = false;

    function clickConfirmPaymentButton(attempts = 0) {
        if (!state.enabled) return;

        // Strictly search inside payment panel container! NEVER search document.body to avoid false clicks!
        const payPanel = document.querySelector('.pay-method, .add-card-outer-wrapper, .wrap-add-card');
        
        if (!payPanel) {
            if (attempts < 15) {
                updateStatus('Waiting for Payment panel container...', 'warn');
                setTimeout(() => clickConfirmPaymentButton(attempts + 1), 400);
            } else {
                updateStatus('⚠️ Payment panel container missing. Card details pre-filled, please click Confirm.', 'warn');
                
                const itemTitle = document.querySelector('.pdp-mod-product-badge-title, .product-title, h1, .title')?.textContent?.trim() || 'Lazada Product';
                const price = document.querySelector('.pdp-price_type_normal, .product-price, .order-total-price, .delivery-item-price')?.textContent?.trim() || '';
                const msg = `⚠️ <b>Lazada Action Required: Manual Confirm Needed</b>\n\n` +
                            `📦 <b>Product:</b> ${itemTitle}\n` +
                            (price ? `💰 <b>Price:</b> ${price}\n` : '') +
                            `💳 <b>Status:</b> Payment panel container missing. Please click Confirm manually.\n` +
                            `⏰ <b>Time:</b> ${new Date().toLocaleString()}\n` +
                            `🔗 <b>URL:</b> ${window.location.href}`;
                sendTelegramNotification(msg);

                state.enabled = false;
                setConfig(state);
            }
            return;
        }

        let confirmBtn = null;
        const candidateBtns = payPanel.querySelectorAll('button, div, span, a');
        for (let el of candidateBtns) {
            if (el.tagName === 'INPUT' || el.tagName === 'LABEL') continue;
            
            const text = (el.innerText || el.textContent || '').trim().toUpperCase();
            if (
                text === 'CONFIRM' ||
                text === 'PAY NOW' ||
                text === 'SAVE' ||
                text === 'PAY' ||
                text === 'CONTINUE' ||
                text.includes('CONFIRM') ||
                text.includes('PAY NOW')
            ) {
                if (el.offsetWidth > 0 && el.offsetHeight > 0 && !el.disabled && !el.classList.contains('disabled')) {
                    confirmBtn = el;
                    break;
                }
            }
        }

        if (!confirmBtn) {
            confirmBtn = payPanel.querySelector('.next-btn-primary, button.next-btn-primary, .automation-btn-confirm, button[type="submit"]');
        }

        if (!confirmBtn) {
            const fallbackBtns = document.querySelectorAll('.plcae-order .btn, .order-wrap .btn, [data-spm-anchor-id*="shipping"]');
            for (let el of fallbackBtns) {
                const text = (el.innerText || el.textContent || '').trim().toUpperCase();
                if (text === 'CONFIRM' || text === 'PAY NOW') {
                    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                        confirmBtn = el;
                        break;
                    }
                }
            }
        }

        if (confirmBtn) {
            if (isConfirmClickScheduled) return;
            
            isConfirmClickScheduled = true;
            updateStatus('⏳ Clicking Confirm shortly...', 'info');
            
            setTimeout(() => {
                isConfirmClickScheduled = false;
                if (!state.enabled) return;
                
                triggerClick(confirmBtn);
                updateStatus('🚀 CLICKED CONFIRM! Processing...', 'success');
            }, 150);
        } else if (attempts < 15) {
            updateStatus('Confirm button inside payment panel not clickable yet, retrying...', 'warn');
            setTimeout(() => clickConfirmPaymentButton(attempts + 1), 400);
        } else {
            updateStatus('⚠️ Card info filled! Please click Confirm manually.', 'warn');
            
            const itemTitle = document.querySelector('.pdp-mod-product-badge-title, .product-title, h1, .title')?.textContent?.trim() || 'Lazada Product';
            const price = document.querySelector('.pdp-price_type_normal, .product-price, .order-total-price, .delivery-item-price')?.textContent?.trim() || '';
            const msg = `⚠️ <b>Lazada Action Required: Manual Confirm Needed</b>\n\n` +
                        `📦 <b>Product:</b> ${itemTitle}\n` +
                        (price ? `💰 <b>Price:</b> ${price}\n` : '') +
                        `💳 <b>Status:</b> Card info filled! Please click Confirm manually.\n` +
                        `⏰ <b>Time:</b> ${new Date().toLocaleString()}\n` +
                        `🔗 <b>URL:</b> ${window.location.href}`;
            sendTelegramNotification(msg);

            state.enabled = false;
            setConfig(state);
        }
    }

    // --- Multi-Method Stock Detection (no page refresh) ---

    // Extract item/sku/seller IDs from __moduleData__ or URL
    function getProductIds() {
        try {
            const md = window.__moduleData__;
            if (md && md.data && md.data.root && md.data.root.fields) {
                const fields = md.data.root.fields;
                if (fields.productOption && fields.productOption.skuBase && fields.productOption.skuBase.skus) {
                    const sku = fields.productOption.skuBase.skus[0];
                    if (sku) {
                        return {
                            itemId: sku.itemId || sku.cartItemId,
                            skuId: sku.skuId || sku.cartSkuId,
                            sellerId: sku.sellerId
                        };
                    }
                }
            }
        } catch (e) {}

        // Fallback: parse from URL (i<itemId>-s<skuId>)
        const m = window.location.href.match(/i(\d+)-s(\d+)/);
        if (m) return { itemId: m[1], skuId: m[2], sellerId: null };
        return null;
    }

    // Track MTOP polling timer separately from reload timer
    let mtopPollTimer = null;
    let isMtopPolling = false;

    // ── METHOD 1: Read __moduleData__ snapshot (zero-latency, no network call) ──
    // Lazada populates window.__moduleData__ on page load with full product state.
    // We can read it directly at any time — it reflects the current page's stock state
    // without any HTTP request. This is the fastest and most bot-safe method.
    function checkStockViaModuleData() {
        try {
            const md = window.__moduleData__;
            if (!md || !md.data || !md.data.root || !md.data.root.fields) return null;
            const fields = md.data.root.fields;

            // Path A: productOption.skuBase.skus[].stock / quantity / sellableQuantity
            try {
                const skus = fields.productOption && fields.productOption.skuBase && fields.productOption.skuBase.skus;
                if (skus && skus.length > 0) {
                    const sku = skus[0];
                    const qty = sku.stock !== undefined ? sku.stock
                              : sku.quantity !== undefined ? sku.quantity
                              : sku.sellableQuantity !== undefined ? sku.sellableQuantity
                              : undefined;
                    if (qty !== undefined && qty !== null) {
                        console.log('🤖 [Lazada Bot] __moduleData__ stock (skuBase.skus[0]):', qty);
                        return { quantity: parseInt(qty, 10), source: 'moduleData.skuBase' };
                    }
                }
            } catch(e) {}

            // Path B: skuInfos map
            try {
                if (fields.skuInfos) {
                    const firstSku = Object.values(fields.skuInfos)[0];
                    if (firstSku) {
                        const qty = firstSku.stock !== undefined ? firstSku.stock
                                  : firstSku.quantity !== undefined ? firstSku.quantity
                                  : firstSku.sellableQuantity !== undefined ? firstSku.sellableQuantity
                                  : undefined;
                        if (qty !== undefined && qty !== null) {
                            console.log('🤖 [Lazada Bot] __moduleData__ stock (skuInfos[0]):', qty);
                            return { quantity: parseInt(qty, 10), source: 'moduleData.skuInfos' };
                        }
                    }
                }
            } catch(e) {}

            // Path C: actionPanelInfo.buyable or top-level buyable
            try {
                const buyable = (fields.actionPanelInfo && fields.actionPanelInfo.buyable !== undefined)
                    ? fields.actionPanelInfo.buyable
                    : fields.buyable;
                if (buyable !== undefined && buyable !== null) {
                    console.log('🤖 [Lazada Bot] __moduleData__ buyable flag:', buyable);
                    return { buyable: !!buyable, source: 'moduleData.buyable' };
                }
            } catch(e) {}

            // Path D: addToCart.stock or addToCart.quantity
            try {
                if (fields.addToCart) {
                    const ac = fields.addToCart;
                    const qty = ac.stock !== undefined ? ac.stock : ac.quantity !== undefined ? ac.quantity : undefined;
                    if (qty !== undefined) {
                        console.log('🤖 [Lazada Bot] __moduleData__ stock (addToCart):', qty);
                        return { quantity: parseInt(qty, 10), source: 'moduleData.addToCart' };
                    }
                }
            } catch(e) {}

        } catch(e) { console.warn('🤖 [Lazada Bot] __moduleData__ read error:', e); }
        return null; // Unknown - use other methods
    }

    // ── METHOD 2: Raw fetch-based MTOP API call ──
    // Mimics the exact XHR Lazada's own JavaScript makes, using the _m_h5_tk cookie
    // for signature. This is indistinguishable from a real browser interaction.
    function getMtopToken() {
        // Read _m_h5_tk from cookies (format: TOKEN_VALUE&timestamp)
        const match = document.cookie.match(/_m_h5_tk=([^;]+)/);
        if (!match) return null;
        return decodeURIComponent(match[1]).split('_')[0];
    }

    function getMtopAppKey() {
        // Lazada SG desktop app key — extract from __globalConfig__ or use the known value
        try {
            if (window.__globalConfig__ && window.__globalConfig__.mtopAppKey) {
                return window.__globalConfig__.mtopAppKey;
            }
        } catch(e) {}
        return '12574478'; // Lazada SG web desktop app key
    }

    async function md5Hex(str) {
        // Lightweight MD5 for MTOP token signing (TextEncoder + SubtleCrypto)
        // Note: SubtleCrypto only supports SHA-*, not MD5, so we use a minimal
        // pure-JS MD5 implementation embedded here.
        const s = str;
        function safeAdd(x, y) { const lsw=(x&0xFFFF)+(y&0xFFFF); const msw=(x>>16)+(y>>16)+(lsw>>16); return (msw<<16)|(lsw&0xFFFF); }
        function bitRotateLeft(num, cnt) { return (num<<cnt)|(num>>>(32-cnt)); }
        function md5cmn(q,a,b,x,s,t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b); }
        function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|((~b)&d),a,b,x,s,t);}
        function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t);}
        function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
        function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|(~d)),a,b,x,s,t);}
        function calcMD5(str){
            let i; const x=unescape(encodeURIComponent(str)); const l=x.length;
            const wordArray=[]; for(i=0;i<l;i+=4){wordArray[i>>2]|=x.charCodeAt(i)<<((i%4)*8);}
            wordArray[l>>2]|=0x80<<((l%4)*8); wordArray[((l+64>>>9)<<4)+14]=l*8;
            let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
            for(i=0;i<wordArray.length;i+=16){
                let [ta,tb,tc,td]=[a,b,c,d];
                a=md5ff(a,b,c,d,wordArray[i+0],7,-680876936);d=md5ff(d,a,b,c,wordArray[i+1],12,-389564586);c=md5ff(c,d,a,b,wordArray[i+2],17,606105819);b=md5ff(b,c,d,a,wordArray[i+3],22,-1044525330);
                a=md5ff(a,b,c,d,wordArray[i+4],7,-176418897);d=md5ff(d,a,b,c,wordArray[i+5],12,1200080426);c=md5ff(c,d,a,b,wordArray[i+6],17,-1473231341);b=md5ff(b,c,d,a,wordArray[i+7],22,-45705983);
                a=md5ff(a,b,c,d,wordArray[i+8],7,1770035416);d=md5ff(d,a,b,c,wordArray[i+9],12,-1958414417);c=md5ff(c,d,a,b,wordArray[i+10],17,-42063);b=md5ff(b,c,d,a,wordArray[i+11],22,-1990404162);
                a=md5ff(a,b,c,d,wordArray[i+12],7,1804603682);d=md5ff(d,a,b,c,wordArray[i+13],12,-40341101);c=md5ff(c,d,a,b,wordArray[i+14],17,-1502002290);b=md5ff(b,c,d,a,wordArray[i+15],22,1236535329);
                a=md5gg(a,b,c,d,wordArray[i+1],5,-165796510);d=md5gg(d,a,b,c,wordArray[i+6],9,-1069501632);c=md5gg(c,d,a,b,wordArray[i+11],14,643717713);b=md5gg(b,c,d,a,wordArray[i+0],20,-373897302);
                a=md5gg(a,b,c,d,wordArray[i+5],5,-701558691);d=md5gg(d,a,b,c,wordArray[i+10],9,38016083);c=md5gg(c,d,a,b,wordArray[i+15],14,-660478335);b=md5gg(b,c,d,a,wordArray[i+4],20,-405537848);
                a=md5gg(a,b,c,d,wordArray[i+9],5,568446438);d=md5gg(d,a,b,c,wordArray[i+14],9,-1019803690);c=md5gg(c,d,a,b,wordArray[i+3],14,-187363961);b=md5gg(b,c,d,a,wordArray[i+8],20,1163531501);
                a=md5gg(a,b,c,d,wordArray[i+13],5,-1444681467);d=md5gg(d,a,b,c,wordArray[i+2],9,-51403784);c=md5gg(c,d,a,b,wordArray[i+7],14,1735328473);b=md5gg(b,c,d,a,wordArray[i+12],20,-1926607734);
                a=md5hh(a,b,c,d,wordArray[i+5],4,-378558);d=md5hh(d,a,b,c,wordArray[i+8],11,-2022574463);c=md5hh(c,d,a,b,wordArray[i+11],16,1839030562);b=md5hh(b,c,d,a,wordArray[i+14],23,-35309556);
                a=md5hh(a,b,c,d,wordArray[i+1],4,-1530992060);d=md5hh(d,a,b,c,wordArray[i+4],11,1272893353);c=md5hh(c,d,a,b,wordArray[i+7],16,-155497632);b=md5hh(b,c,d,a,wordArray[i+10],23,-1094730640);
                a=md5hh(a,b,c,d,wordArray[i+13],4,681279174);d=md5hh(d,a,b,c,wordArray[i+0],11,-358537222);c=md5hh(c,d,a,b,wordArray[i+3],16,-722521979);b=md5hh(b,c,d,a,wordArray[i+6],23,76029189);
                a=md5hh(a,b,c,d,wordArray[i+9],4,-640364487);d=md5hh(d,a,b,c,wordArray[i+12],11,-421815835);c=md5hh(c,d,a,b,wordArray[i+15],16,530742520);b=md5hh(b,c,d,a,wordArray[i+2],23,-995338651);
                a=md5ii(a,b,c,d,wordArray[i+0],6,-198630844);d=md5ii(d,a,b,c,wordArray[i+7],10,1126891415);c=md5ii(c,d,a,b,wordArray[i+14],15,-1416354905);b=md5ii(b,c,d,a,wordArray[i+5],21,-57434055);
                a=md5ii(a,b,c,d,wordArray[i+12],6,1700485571);d=md5ii(d,a,b,c,wordArray[i+3],10,-1894986606);c=md5ii(c,d,a,b,wordArray[i+10],15,-1051523);b=md5ii(b,c,d,a,wordArray[i+1],21,-2054922799);
                a=md5ii(a,b,c,d,wordArray[i+8],6,1873313359);d=md5ii(d,a,b,c,wordArray[i+15],10,-30611744);c=md5ii(c,d,a,b,wordArray[i+6],15,-1560198380);b=md5ii(b,c,d,a,wordArray[i+13],21,1309151649);
                a=md5ii(a,b,c,d,wordArray[i+4],6,-145523070);d=md5ii(d,a,b,c,wordArray[i+11],10,-1120210379);c=md5ii(c,d,a,b,wordArray[i+2],15,718787259);b=md5ii(b,c,d,a,wordArray[i+9],21,-343485551);
                a=safeAdd(a,ta);b=safeAdd(b,tb);c=safeAdd(c,tc);d=safeAdd(d,td);
            }
            return [a,b,c,d].map(n=>{ let h=''; for(let j=0;j<4;j++){h+=('0'+((n>>>(j*8))&0xFF).toString(16)).slice(-2);} return h; }).join('');
        }
        return calcMD5(str);
    }

    async function checkStockViaFetchMtop(onSuccess, onFail) {
        const ids = getProductIds();
        if (!ids || !ids.itemId) { if (onFail) onFail('No item ID'); return; }

        const token = getMtopToken();
        const appKey = getMtopAppKey();
        const t = String(Date.now());
        const api = 'mtop.global.detail.web.getDetailInfo';
        const v = '1.0';

        const dataObj = {
            deviceType: 'desktop',
            path: window.location.href,
            uri: window.location.pathname,
            requestParams: JSON.stringify({
                itemId: ids.itemId,
                skuId: ids.skuId || '',
                sellerId: ids.sellerId || ''
            }),
            headerParams: '{}',
            cookieParams: '{}'
        };
        const dataStr = JSON.stringify(dataObj);

        // Sign: md5(token + '&' + t + '&' + appKey + '&' + dataStr)
        const signInput = (token ? token + '&' : '') + t + '&' + appKey + '&' + dataStr;
        const sign = await md5Hex(signInput);

        const params = new URLSearchParams({
            jsv: '2.7.2',
            appKey: appKey,
            t: t,
            sign: sign,
            api: api,
            v: v,
            type: 'originaljson',
            dataType: 'jsonp',
            AntiCreep: 'true',
            AntiFlood: 'true',
            callback: 'mtopjsonp' + Math.floor(Math.random() * 1e8)
        });

        const url = `https://acs.m.sg.lazada.com/h5/${api}/${v}/?${params.toString()}`;

        console.log('🤖 [Lazada Bot] Fetch MTOP API call for item', ids.itemId);

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': window.location.href,
                    'Origin': window.location.origin,
                },
                body: 'data=' + encodeURIComponent(dataStr),
                credentials: 'include'
            });
            let text = await resp.text();
            // Strip JSONP wrapper if present
            text = text.replace(/^[^(]+\(/, '').replace(/\);?$/, '');
            const json = JSON.parse(text);
            console.log('🤖 [Lazada Bot] Fetch MTOP response:', json);
            const stockInfo = parseStockFromMtopResponse(json && json.data);
            if (onSuccess) onSuccess(stockInfo, json);
        } catch(e) {
            console.warn('🤖 [Lazada Bot] Fetch MTOP failed:', e);
            if (onFail) onFail(e);
        }
    }

    // Parse stock status out of a MTOP getDetailInfo response
    function parseStockFromMtopResponse(data) {
        if (!data) return null;
        try {
            let mod = data;
            if (data.module) {
                mod = typeof data.module === 'string' ? JSON.parse(data.module) : data.module;
            }

            // Check skuInfos / quantity fields
            const fields = mod;
            // Common paths Lazada uses:
            const stockPaths = [
                () => fields.skuInfos && Object.values(fields.skuInfos)[0] && Object.values(fields.skuInfos)[0].stock,
                () => fields.skuInfos && Object.values(fields.skuInfos)[0] && Object.values(fields.skuInfos)[0].quantity,
                () => fields.skuInfos && Object.values(fields.skuInfos)[0] && Object.values(fields.skuInfos)[0].sellableQuantity,
                () => fields.stock,
                () => fields.quantity,
                () => fields.sellableQuantity,
                () => fields.purchaseOrder && fields.purchaseOrder.stock,
            ];
            for (const fn of stockPaths) {
                try { const v = fn(); if (v !== undefined && v !== null) return { quantity: v, raw: mod }; } catch (e) {}
            }

            // Check for buy button state (actionPanelInfo, addToCart)
            const buyable = [
                () => fields.actionPanelInfo && fields.actionPanelInfo.buyable,
                () => fields.buyable,
                () => fields.addToCart && fields.addToCart.quantity,
            ];
            for (const fn of buyable) {
                try { const v = fn(); if (v !== undefined && v !== null) return { buyable: !!v, raw: mod }; } catch (e) {}
            }

            // If no explicit quantity, return the raw module to let DOM check handle it
            return { raw: mod };
        } catch (e) {
            return null;
        }
    }

    // ── METHOD 3: window.Mtop SDK (existing method, kept as tertiary fallback) ──
    function checkStockViaMtop(onSuccess, onFail) {
        const Mtop = window.Mtop && window.Mtop.default;
        if (!Mtop || typeof Mtop.request !== 'function') {
            if (onFail) onFail('MTOP not available');
            return;
        }

        const ids = getProductIds();
        if (!ids || !ids.itemId) {
            if (onFail) onFail('Could not determine item ID');
            return;
        }

        // Build request params matching what Lazada PDP sends
        const uri = window.location.pathname;
        const reqData = {
            deviceType: 'desktop',
            path: window.location.href,
            uri: uri,
            requestParams: JSON.stringify({
                itemId: ids.itemId,
                skuId: ids.skuId,
                sellerId: ids.sellerId
            }),
            headerParams: JSON.stringify({}),
            cookieParams: JSON.stringify({}),
        };

        const mtopReq = {
            api: 'mtop.global.detail.web.getDetailInfo',
            v: '1.0',
            type: 'POST',
            needLogin: false,
            data: reqData,
        };

        console.log('🤖 [Lazada Bot] MTOP SDK stock check for item', ids.itemId);

        try {
            Mtop.request(mtopReq,
                function(res) {
                    console.log('🤖 [Lazada Bot] MTOP SDK response received', res);
                    const stockInfo = parseStockFromMtopResponse(res && res.data);
                    if (onSuccess) onSuccess(stockInfo, res);
                },
                function(err) {
                    console.warn('🤖 [Lazada Bot] MTOP SDK request failed:', err);
                    if (onFail) onFail(err);
                }
            );
        } catch (e) {
            console.warn('🤖 [Lazada Bot] MTOP SDK threw:', e);
            if (onFail) onFail(e);
        }
    }

    // Determine in-stock status from any stock info object
    function evaluateStockFromMtop(stockInfo) {
        if (!stockInfo) return null; // Unknown - use DOM

        // Explicit quantity
        if (stockInfo.quantity !== undefined) {
            const qty = parseInt(stockInfo.quantity, 10);
            return qty > 0;
        }

        // Explicit buyable flag
        if (stockInfo.buyable !== undefined) {
            return !!stockInfo.buyable;
        }

        // Got raw data but couldn't extract stock: fall back to DOM
        return null;
    }

    function runStockCheck() {
        if (!state.enabled) return;
        if (isMtopPolling) return; // Already polling, skip tick

        // ── STEP 1: Try __moduleData__ snapshot (instant, zero network cost) ──
        const mdInfo = checkStockViaModuleData();
        if (mdInfo !== null) {
            const inStock = evaluateStockFromMtop(mdInfo);
            if (inStock === true) {
                updateStatus(`📦 IN STOCK (${mdInfo.source})! Taking action...`, 'success');
                if (mtopPollTimer) { clearInterval(mtopPollTimer); mtopPollTimer = null; }
                if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
                if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
                handleInStock();
                return;
            } else if (inStock === false) {
                const qty = mdInfo.quantity !== undefined ? mdInfo.quantity : 0;
                updateStatus(`Out of Stock (snapshot qty:${qty}). Waiting for API confirmation...`, 'warn');
                // Fall through to API confirmation — moduleData may be stale
            }
            // inStock===null means ambiguous, also fall through to API
        }

        // ── STEP 2: Fetch-based MTOP API (mimics real browser, no Mtop SDK needed) ──
        isMtopPolling = true;
        updateStatus('🔍 Checking stock via API (fetch)...', 'info');

        checkStockViaFetchMtop(
            function(stockInfo, rawRes) {
                isMtopPolling = false;
                if (!state.enabled) return;

                const inStock = evaluateStockFromMtop(stockInfo);

                if (inStock === true) {
                    if (mtopPollTimer) { clearInterval(mtopPollTimer); mtopPollTimer = null; }
                    if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
                    if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
                    handleInStock();
                } else if (inStock === false) {
                    const qty = stockInfo && stockInfo.quantity !== undefined ? stockInfo.quantity : 0;
                    updateStatus(`Out of Stock (API qty:${qty}). Next check in ${state.minRefresh || 3}s...`, 'warn');
                    scheduleMtopPoll();
                } else {
                    // Fetch API unclear - try window.Mtop SDK
                    console.log('🤖 [Lazada Bot] Fetch MTOP unclear, trying SDK...');
                    tryMtopSdkOrDom();
                }
            },
            function(err) {
                isMtopPolling = false;
                if (!state.enabled) return;
                console.warn('🤖 [Lazada Bot] Fetch MTOP failed, trying SDK:', err);
                tryMtopSdkOrDom();
            }
        );
    }

    // ── STEP 3: Try window.Mtop SDK, then DOM fallback ──
    function tryMtopSdkOrDom() {
        if (!state.enabled) return;
        const mtopAvailable = !!(window.Mtop && window.Mtop.default && typeof window.Mtop.default.request === 'function');

        if (mtopAvailable) {
            isMtopPolling = true;
            updateStatus('🔍 Checking stock via MTOP SDK...', 'info');
            checkStockViaMtop(
                function(stockInfo, rawRes) {
                    isMtopPolling = false;
                    if (!state.enabled) return;
                    const inStock = evaluateStockFromMtop(stockInfo);
                    if (inStock === true) {
                        if (mtopPollTimer) { clearInterval(mtopPollTimer); mtopPollTimer = null; }
                        if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
                        if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
                        handleInStock();
                    } else if (inStock === false) {
                        const qty = stockInfo && stockInfo.quantity !== undefined ? stockInfo.quantity : 0;
                        updateStatus(`Out of Stock (SDK qty:${qty}). Next check in ${state.minRefresh || 3}s...`, 'warn');
                        scheduleMtopPoll();
                    } else {
                        runDomStockCheck();
                    }
                },
                function(err) {
                    isMtopPolling = false;
                    if (!state.enabled) return;
                    runDomStockCheck();
                }
            );
        } else {
            runDomStockCheck();
        }
    }

    function scheduleMtopPoll() {
        if (!state.enabled) return;
        if (mtopPollTimer) return; // Already scheduled

        const min = (state.minRefresh || 3) * 1000;
        const max = (state.maxRefresh || 7) * 1000;
        // Human-like jitter: add 200-800ms extra randomness to avoid predictable intervals
        const jitter = Math.floor(Math.random() * 600) + 200;
        const delay = Math.floor(Math.random() * (max - min + 1)) + min + jitter;

        let countdown = Math.round(delay / 1000);
        if (mtopPollTimer) clearInterval(mtopPollTimer);

        mtopPollTimer = setInterval(() => {
            countdown--;
            if (!state.enabled) {
                clearInterval(mtopPollTimer);
                mtopPollTimer = null;
                return;
            }
            if (countdown > 0) {
                updateStatus(`Out of Stock. Next API check in ${countdown}s...`, 'warn');
            } else {
                clearInterval(mtopPollTimer);
                mtopPollTimer = null;
                if (state.enabled && !isMtopPolling) {
                    runStockCheck();
                }
            }
        }, 1000);
    }

    // DOM-based stock check (used as fallback when MTOP is unavailable)
    function runDomStockCheck() {
        if (!state.enabled) return;

        const isOutOfStock = checkIsOutOfStock();
        const isInStock = checkIsInStock();

        if (isOutOfStock) {
            if (!reloadTimer) {
                const min = state.minRefresh || 3;
                const max = state.maxRefresh || 7;
                timeUntilReload = Math.floor(Math.random() * (max - min + 1)) + min;
                startRefreshCountdown();
            }
        } else if (isInStock) {
            if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
            if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
            handleInStock();
        }
    }

    function checkIsInStock() {
        // Signal 1: Buy Now button visible and enabled (confirmed in-stock from live inspection)
        const buyNowBtn = document.querySelector('.add-to-cart-buy-now-btn, button.add-to-cart-buy-now-btn');
        if (buyNowBtn && !buyNowBtn.disabled && !buyNowBtn.classList.contains('disabled') && buyNowBtn.offsetWidth > 0) {
            return true;
        }

        // Signal 2: Add to Cart button visible and enabled
        const addToCartBtn = document.querySelector(
            'button[data-spm*="cart"], .btn-add-to-cart button:not([disabled]), .add-to-cart-button button:not([disabled])');
        if (addToCartBtn && !addToCartBtn.disabled && addToCartBtn.offsetWidth > 0) {
            return true;
        }

        // Signal 3: Quantity input is enabled with value > 0
        const qtyInput = document.querySelector('.next-number-picker-input input');
        if (qtyInput && !qtyInput.disabled) {
            const v = parseInt(qtyInput.value, 10);
            if (!isNaN(v) && v > 0) return true;
        }

        // Signal 4: RedMart Add to Cart
        const redMartAddToCartBtn = document.querySelector('.pdp-redmart-add-to-cart button, .redmart-cart-btn button');
        if (redMartAddToCartBtn && !redMartAddToCartBtn.disabled) {
            return true;
        }

        return false;
    }

    function checkIsOutOfStock() {
        // Signal 1 (strongest): "Add to Wishlist" button is the ONLY action button
        // — confirmed from live OOS page inspection. When OOS, Buy Now/Add to Cart disappear
        // and are replaced by a single "Add to Wishlist" button.
        const wishlistBtn = document.querySelector('.pdp-button-block-wishlist, button[class*="wishlist"]');
        const buyNowBtn = document.querySelector('.add-to-cart-buy-now-btn, button.add-to-cart-buy-now-btn');
        if (wishlistBtn && wishlistBtn.offsetWidth > 0 && (!buyNowBtn || buyNowBtn.offsetWidth === 0)) {
            return true;
        }

        // Signal 2: Quantity shows 0 AND "Out of stock" text appears next to input
        // (confirmed live: qty=0, then "Out of stock" text in red next to the stepper)
        const qtyInput = document.querySelector('.next-number-picker-input input');
        if (qtyInput) {
            const v = parseInt(qtyInput.value, 10);
            if (!isNaN(v) && v === 0) {
                // Confirm with nearby OOS text
                const qtyArea = qtyInput.closest('.quantity-content, .product-quantity, [class*="quantity"]');
                const areaText = (qtyArea ? qtyArea.innerText : document.body.innerText) || '';
                if (areaText.toLowerCase().includes('out of stock')) return true;
            }
        }

        // Signal 3: Quantity warning element with OOS text
        const warningEl = document.querySelector('.quantity-content-warning');
        if (warningEl && warningEl.textContent.toLowerCase().includes('out of stock')) {
            return true;
        }

        // Signal 4: Quantity input is explicitly disabled
        const qtyInputDisabled = document.querySelector('.next-number-picker-input input[disabled]');
        if (qtyInputDisabled) return true;

        // Signal 5: Buy Now button explicitly disabled
        if (buyNowBtn && (buyNowBtn.disabled || buyNowBtn.classList.contains('disabled'))) {
            return true;
        }

        return false;
    }

    // DOM fallback: schedule a re-poll with a page reload
    function startRefreshCountdown() {
        if (reloadTimer) clearInterval(reloadTimer);

        const min = (state.minRefresh || 8) * 1000;
        const max = (state.maxRefresh || 15) * 1000;
        // Add human-like jitter (200-800ms extra)
        const jitter = Math.floor(Math.random() * 600) + 200;
        timeUntilReload = Math.round((Math.floor(Math.random() * (max - min + 1)) + min + jitter) / 1000);

        updateStatus(`Out of Stock. Reloading page in ${timeUntilReload}s...`, 'warn');

        reloadTimer = setInterval(() => {
            timeUntilReload--;
            if (timeUntilReload > 0) {
                updateStatus(`Out of Stock. Reloading page in ${timeUntilReload}s...`, 'warn');
            } else {
                clearInterval(reloadTimer);
                reloadTimer = null;
                // Force a page reload to get fresh DOM and moduleData since we are stuck
                updateStatus('🔄 Reloading page to check live stock...', 'info');
                window.location.reload();
            }
        }, 1000);
    }

    function handleInStock() {
        updateStatus('📦 IN STOCK! Taking action...', 'info');

        // Check if front-end actually shows it
        if (!checkIsInStock()) {
            updateStatus('📦 IN STOCK (API) but front-end not ready. Waiting & Refreshing...', 'warn');
            setTimeout(() => {
                window.location.reload();
            }, 1000 + Math.random() * 500); // Wait a little and refresh
            return; // Don't proceed to click if not on DOM
        }

        updateStatus('📦 IN STOCK! Setting quantity...', 'info');

        // Locate input field
        const qtyInput = document.querySelector('.next-number-picker-input input');
        const targetQty = state.quantity || 1;

        if (qtyInput) {
            setInputValue(qtyInput, targetQty);
            // Short delay to ensure state update, then click Buy Now
            setTimeout(() => {
                clickBuyNow();
            }, 300);
        } else {
            // Fallback for RedMart layout: Click "Add to cart" first
            const redMartAddToCartBtn = document.querySelector('.pdp-redmart-add-to-cart button, .redmart-cart-btn button');
            if (redMartAddToCartBtn && !redMartAddToCartBtn.disabled) {
                updateStatus('🛒 Clicking RedMart Add To Cart...', 'info');
                redMartAddToCartBtn.click();
                
                // Wait for floating cart to appear, then set quantity and checkout
                setTimeout(() => {
                    handleRedMartFloatingCart(targetQty);
                }, 800);
            } else {
                // Alternative: click '+' button if input field isn't directly settable
                const addBtn = document.querySelector('.next-number-picker-handler-up');
                if (addBtn) {
                    for (let i = 1; i < targetQty; i++) {
                        addBtn.click();
                    }
                }
                setTimeout(() => {
                    clickBuyNow();
                }, 300);
            }
        }
    }

    function handleRedMartFloatingCart(targetQty, attempts = 0) {
        updateStatus('🛒 Checking Box & Setting Quantity...', 'info');
        
        // 1. Wait for the checkbox to appear
        const checkboxLabel = document.querySelector('.floating-cart-item-checkbox, label.iweb-checkbox');
        if (!checkboxLabel) {
            if (attempts < 15) {
                setTimeout(() => handleRedMartFloatingCart(targetQty, attempts + 1), 300);
                return;
            } else {
                updateStatus('Floating cart not found. Retrying...', 'warn');
            }
        }

        // 2. Check the checkbox if not already checked
        if (checkboxLabel && !checkboxLabel.classList.contains('iweb-checkbox-checked')) {
            const icon = checkboxLabel.querySelector('.iweb-checkbox-icon');
            if (icon) icon.click();
            checkboxLabel.click();

            const checkboxInput = checkboxLabel.querySelector('input[type="checkbox"]');
            if (checkboxInput) {
                checkboxInput.checked = true;
                checkboxInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // 3. Find stepper input in the floating cart to set quantity
        const stepperInput = document.querySelector('.iweb-stepper-input, .next-number-picker-input input');
        if (stepperInput) {
            setInputValue(stepperInput, targetQty);
        } else {
            const plusBtn = document.querySelector('.iweb-stepper-plus');
            if (plusBtn) {
                for (let i = 1; i < targetQty; i++) {
                    plusBtn.click();
                }
            }
        }

        // 4. Click the exact "Check Out" button (not "Go to cart")
        setTimeout(() => {
            const btns = document.querySelectorAll('.order-total-btn');
            let checkoutBtn = null;
            for (let btn of btns) {
                if (btn.innerText.toLowerCase().includes('check out')) {
                    checkoutBtn = btn;
                    break;
                }
            }

            if (checkoutBtn && !checkoutBtn.disabled) {
                // If it says "Check Out (0)", it means the checkbox click hasn't registered yet.
                if (checkoutBtn.innerText.includes('(0)')) {
                    updateStatus('Cart says Check Out (0). Retrying checkbox...', 'warn');
                    if (checkboxLabel) checkboxLabel.click();
                    setTimeout(() => handleRedMartFloatingCart(targetQty, attempts), 600);
                    return;
                }

                updateStatus('🚀 Clicking Check Out...', 'success');
                checkoutBtn.click();
                monitorCheckoutNavigation();
            } else {
                updateStatus('Check Out button not found or disabled. Retrying...', 'warn');
                setTimeout(() => handleRedMartFloatingCart(targetQty, attempts), 500);
            }
        }, 600);
    }

    function setInputValue(input, val) {
        input.focus();
        // Use standard descriptor setter to work around React/Rax internal value tracking
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (nativeSetter) {
            nativeSetter.call(input, val);
        } else {
            input.value = val;
        }

        // Dispatch input events
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function monitorCheckoutNavigation() {
        let attempts = 0;
        const checkNav = setInterval(() => {
            attempts++;
            if (window.location.href.includes('/checkout') || window.location.href.includes('checkout.')) {
                clearInterval(checkNav);
                updateStatus('🎉 CLICK SUCCESS! Navigated to Checkout!', 'success');
                handleCheckoutPage();
            } else if (attempts > 20) {
                clearInterval(checkNav);
                updateStatus('Action clicked. Complete checkout manually if no popup.', 'info');
            }
        }, 300);
    }

    function clickBuyNow() {
        const buyNowBtn = document.querySelector('.add-to-cart-buy-now-btn, button.add-to-cart-buy-now-btn');
        const orderTotalBtn = document.querySelector('.order-total-btn');

        if (buyNowBtn && !buyNowBtn.disabled) {
            updateStatus('🚀 Clicking BUY NOW...', 'success');
            buyNowBtn.click();
            setTimeout(() => {
                monitorCheckoutNavigation();
            }, 800); // Wait a little delay after add to cart
        } else if (orderTotalBtn && !orderTotalBtn.disabled) {
            // Fallback for RedMart Check Out button
            updateStatus('🚀 Clicking Check Out...', 'success');
            orderTotalBtn.click();
            setTimeout(() => {
                monitorCheckoutNavigation();
            }, 800); // Wait a little delay after add to cart
        } else {
            updateStatus('Buy Now button not clickable yet. Retrying...', 'warn');
            setTimeout(clickBuyNow, 500);
        }
    }

    // Initialize robustly
    function ensureUI() {
        injectUI();
        if (state.enabled) checkAndRunBot();
    }

    // Attach SPA URL navigation listeners
    observeUrlChanges();

    // Inject immediately if possible, or wait
    ensureUI();

    // Re-check periodically in case Lazada's React SPA clears the document body!
    setInterval(() => {
        if (!document.getElementById('lazada-bot-root')) {
            console.log('🤖 [Lazada Bot] UI was removed by the page, re-injecting...');
            ensureUI();
        }
    }, 2000);

})();
