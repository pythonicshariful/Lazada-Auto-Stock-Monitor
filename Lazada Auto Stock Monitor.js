// ==UserScript==
// @name         Lazada Auto Stock Monitor & Quick Buy Bot
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Automated stock checker, quantity selector, and Buy Now trigger for Lazada with modern GUI.
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
        minRefresh: 3, // min random refresh in seconds
        maxRefresh: 7, // max random refresh in seconds
        cardNumber: '3746 7590 3972 476',
        cardName: 'Shariful Islam',
        expiryDate: '11/27',
        cvv: '444',
        tgBotToken: '8156587833:AAEwTAIdqcTkT6U8fSj4uD49AdKklG2nfdc',
        tgChatId: '7809021498',
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
    }

    // --- Telegram Notification ---
    function sendTelegramNotification(message) {
        const token = (state.tgBotToken && state.tgBotToken.trim()) ? state.tgBotToken.trim() : defaultConfig.tgBotToken;
        const chatId = (state.tgChatId && state.tgChatId.trim()) ? state.tgChatId.trim() : defaultConfig.tgChatId;
        
        if (!token || !chatId) {
            console.log('🤖 [Lazada Bot] Telegram notification skipped: Bot token or Chat ID missing.');
            return;
        }

        const encodedText = encodeURIComponent(message);
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
        return document.querySelector('#baxia-dialog-content, iframe[src*="bixi.alicdn.com/punish"], iframe[src*="action=deny"], iframe[src*="punish:resource"]');
    }

    function handleBaxiaPunishDetected(iframeEl) {
        if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
        if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }

        state.enabled = false;
        setConfig(state);

        updateStatus('🚨 Security Check / Baxia Captcha Detected! Bot stopped.', 'error');

        const iframeSrc = iframeEl ? (iframeEl.src || iframeEl.getAttribute('src') || 'Unknown') : 'Detected';
        const msg = `⚠️ <b>LAZADA SECURITY CHECK / PUNISH DETECTED!</b>\n\n` +
                    `🚨 <b>Anti-Bot Dialog:</b> Baxia / Punish Check triggered\n` +
                    `🔗 <b>Page URL:</b> ${window.location.href}\n` +
                    `🖼️ <b>Iframe Src:</b> ${iframeSrc}\n` +
                    `⏰ <b>Time:</b> ${new Date().toLocaleString()}\n\n` +
                    `<i>Bot has been stopped. Please complete captcha / security check manually.</i>`;

        sendTelegramNotification(msg);
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
                handleBaxiaPunishDetected(baxia);
                return;
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
        }, 600);
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
            
            const randomDelay = Math.floor(Math.random() * (1500 - 500 + 1)) + 500;
            let timeLeft = randomDelay;
            isConfirmClickScheduled = true;
            
            updateStatus(`⏳ Next click in ${timeLeft}ms...`, 'info');
            
            const countInterval = setInterval(() => {
                timeLeft -= 100;
                if (timeLeft > 0) {
                    updateStatus(`⏳ Next click in ${timeLeft}ms...`, 'info');
                } else {
                    clearInterval(countInterval);
                    isConfirmClickScheduled = false;
                    if (!state.enabled) return;
                    
                    triggerClick(confirmBtn);
                    updateStatus('🚀 CLICKED CONFIRM! Processing...', 'success');
                }
            }, 100);
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

    function runStockCheck() {
        if (!state.enabled) return;

        // Check Out of stock conditions
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
            // Cancel any ongoing reload countdown if it comes in stock dynamically
            if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
            if (checkLoopTimer) { clearInterval(checkLoopTimer); checkLoopTimer = null; }
            handleInStock();
        }
    }

    function checkIsInStock() {
        const buyNowBtn = document.querySelector('.add-to-cart-buy-now-btn, button.add-to-cart-buy-now-btn');
        if (buyNowBtn && !buyNowBtn.disabled && !buyNowBtn.classList.contains('disabled')) {
            return true;
        }
        
        const redMartAddToCartBtn = document.querySelector('.pdp-redmart-add-to-cart button, .redmart-cart-btn button');
        if (redMartAddToCartBtn && !redMartAddToCartBtn.disabled) {
            return true;
        }

        return false;
    }

    function checkIsOutOfStock() {
        // Selector 1: Quantity warning text
        const warningEl = document.querySelector('.quantity-content-warning');
        if (warningEl && warningEl.textContent.toLowerCase().includes('out of stock')) {
            return true;
        }

        // Selector 2: Number picker disabled class or disabled input
        const pickerDisabled = document.querySelector('.next-number-picker-disabled');
        if (pickerDisabled) return true;

        const qtyInputDisabled = document.querySelector('.next-number-picker-input input[disabled]');
        if (qtyInputDisabled) return true;

        // Selector 3: Out of stock buy button disabled state or text
        const buyNowBtn = document.querySelector('.add-to-cart-buy-now-btn, button.add-to-cart-buy-now-btn');
        if (buyNowBtn && (buyNowBtn.disabled || buyNowBtn.classList.contains('disabled'))) {
            return true;
        }

        // Check for general page text
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('This item is out of stock') || bodyText.includes('Out of stock')) {
            const qtyInput = document.querySelector('.next-number-picker-input input');
            if (!qtyInput || qtyInput.disabled) {
                return true;
            }
        }

        return false;
    }

    function startRefreshCountdown() {
        updateStatus(`Out of Stock. Refreshing in ${timeUntilReload}s...`, 'warn');

        if (reloadTimer) clearInterval(reloadTimer);

        reloadTimer = setInterval(() => {
            timeUntilReload--;
            if (timeUntilReload > 0) {
                updateStatus(`Out of Stock. Refreshing in ${timeUntilReload}s...`, 'warn');
            } else {
                clearInterval(reloadTimer);
                updateStatus('Refreshing page to check stock...', 'info');
                window.location.reload();
            }
        }, 1000);
    }

    function handleInStock() {
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
            monitorCheckoutNavigation();
        } else if (orderTotalBtn && !orderTotalBtn.disabled) {
            // Fallback for RedMart Check Out button
            updateStatus('🚀 Clicking Check Out...', 'success');
            orderTotalBtn.click();
            monitorCheckoutNavigation();
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
