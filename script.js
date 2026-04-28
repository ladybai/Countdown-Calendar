// Countdown Calendar Application
document.addEventListener('DOMContentLoaded', function() {
    // State
    let currentDate = new Date();
    let currentYear = currentDate.getFullYear();
    let currentMonth = currentDate.getMonth();
    let countdowns = JSON.parse(localStorage.getItem('countdowns')) || [];
    let editingId = null;
    
    // Logger module
    const MAX_LOG_ENTRIES = 500;
    const LOG_TYPES = { INFO: 'info', ERROR: 'error', OP: 'operation' };
    let logs = JSON.parse(localStorage.getItem('appLogs')) || [];
    
    // File System Access API wrapper for saving logs to disk
    const FileLog = (() => {
        let _dirHandle = null;
        let _writeTimer = null;
        let _autoSave = false;

        function available() {
            return typeof window.showDirectoryPicker === 'function';
        }

        async function selectDirectory() {
            try {
                _dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                await _persist();
                return true;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    Logger._addRaw(LOG_TYPES.ERROR, 'Directory selection failed: ' + e.message);
                }
                return false;
            }
        }

        async function restoreDirectory() {
            try {
                const handle = await _loadFromDB();
                if (handle) {
                    await _verifyPermission(handle);
                    _dirHandle = handle;
                    return true;
                }
            } catch (e) { /* not available */ }
            return false;
        }

        async function _verifyPermission(handle) {
            const opts = { mode: 'readwrite' };
            if (handle.queryPermission && (await handle.queryPermission(opts)) !== 'granted') {
                if (handle.requestPermission) {
                    await handle.requestPermission(opts);
                }
            }
        }

        function setAutoSave(enabled) { _autoSave = enabled; }
        function isAutoSave() { return _autoSave; }
        function getDirName() { return _dirHandle ? _dirHandle.name : null; }

        async function writeLogFile() {
            if (!_dirHandle || !_autoSave) return;
            clearTimeout(_writeTimer);
            _writeTimer = setTimeout(async () => {
                try {
                    const fileName = 'app-logs.log';
                    const fileHandle = await _dirHandle.getFileHandle(fileName, { create: true });
                    const unwritten = Logger._getUnwritten();
                    if (unwritten.length === 0) return;

                    const truncate = (Logger._writtenCount === 0);
                    const writable = await fileHandle.createWritable({ keepExistingData: !truncate });
                    if (!truncate) {
                        const file = await fileHandle.getFile();
                        await writable.seek(file.size);
                    }
                    for (const entry of unwritten) {
                        const date = new Date(entry.ts);
                        const ts = date.getFullYear() + '-' +
                            String(date.getMonth() + 1).padStart(2, '0') + '-' +
                            String(date.getDate()).padStart(2, '0') + ' ' +
                            String(date.getHours()).padStart(2, '0') + ':' +
                            String(date.getMinutes()).padStart(2, '0') + ':' +
                            String(date.getSeconds()).padStart(2, '0');
                        const lvl = entry.type === 'info' ? 'INFO' : entry.type === 'error' ? 'ERROR' : 'OP';
                        await writable.write(ts + '  ' + lvl.padEnd(7) + entry.msg + '\n');
                    }
                    await writable.close();
                    Logger._markWritten();
                } catch (e) {
                    localStorage.setItem('logWriteErr', e.message);
                }
            }, 800);
        }

        async function _persist() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open('FileLogDB', 1);
                req.onupgradeneeded = () => { req.result.createObjectStore('handles'); };
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('handles', 'readwrite');
                    tx.objectStore('handles').put(_dirHandle, 'dirHandle');
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                };
                req.onerror = () => reject(req.error);
            });
        }

        async function _loadFromDB() {
            return new Promise((resolve) => {
                const req = indexedDB.open('FileLogDB', 1);
                req.onupgradeneeded = () => { req.result.createObjectStore('handles'); };
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('handles', 'readonly');
                    const getReq = tx.objectStore('handles').get('dirHandle');
                    getReq.onsuccess = () => { db.close(); resolve(getReq.result || null); };
                    getReq.onerror = () => { db.close(); resolve(null); };
                };
                req.onerror = () => resolve(null);
            });
        }

        return { available, selectDirectory, restoreDirectory, setAutoSave, isAutoSave, getDirName, writeLogFile };
    })();

    const Logger = {
        _writtenCount: 0,
        _addRaw(type, message) {
            const entry = { ts: new Date().toISOString(), type, msg: message };
            logs.push(entry);
            if (logs.length > MAX_LOG_ENTRIES) { logs.shift(); if (this._writtenCount > 0) this._writtenCount--; }
            localStorage.setItem('appLogs', JSON.stringify(logs));
            if (FileLog.isAutoSave()) FileLog.writeLogFile();
        },
        _add(type, message) { this._addRaw(type, message); },
        _getUnwritten() { return logs.slice(this._writtenCount); },
        _markWritten() { this._writtenCount = logs.length; },
        info(msg)    { this._add(LOG_TYPES.INFO, msg); },
        error(msg)   { this._add(LOG_TYPES.ERROR, msg); },
        operation(msg) { this._add(LOG_TYPES.OP, msg); },
        clear() {
            logs = [];
            this._writtenCount = 0;
            localStorage.setItem('appLogs', JSON.stringify(logs));
            if (FileLog.isAutoSave()) FileLog.writeLogFile();
        },
        getAll() { return logs; },
        export() {
            const lines = logs.map(entry => {
                const date = new Date(entry.ts);
                const ts = date.getFullYear() + '-' +
                    String(date.getMonth() + 1).padStart(2, '0') + '-' +
                    String(date.getDate()).padStart(2, '0') + ' ' +
                    String(date.getHours()).padStart(2, '0') + ':' +
                    String(date.getMinutes()).padStart(2, '0') + ':' +
                    String(date.getSeconds()).padStart(2, '0');
                const lvl = entry.type === 'info' ? 'INFO' : entry.type === 'error' ? 'ERROR' : 'OP';
                return ts + '  ' + lvl.padEnd(7) + entry.msg;
            }).join('\n');
            const blob = new Blob([lines], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `app-logs-${new Date().toISOString().split('T')[0]}.log`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Logger.info('Logs exported to file');
        }
    };

    Logger.info('Application initialized');

    // Helper function to parse YYYY-MM-DD string as local date
    function parseLocalDate(dateString) {
        if (!dateString) return new Date();
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    
    // Holiday and special workday data for 2025 (example data)
    // Format: "YYYY-MM-DD": "holiday" for public holiday, "workday" for make-up workday
    const specialDates = {
        // 2025 Holidays and Workdays
        // New Year's Day
        "2025-01-01": { type: "holiday", name: "元旦" },
        
        // Spring Festival (Chinese New Year)
        "2025-01-28": { type: "holiday", name: "春节" },
        "2025-01-29": { type: "holiday", name: "春节" },
        "2025-01-30": { type: "holiday", name: "春节" },
        "2025-01-31": { type: "holiday", name: "春节" },
        "2025-02-01": { type: "holiday", name: "春节" },
        "2025-02-02": { type: "holiday", name: "春节" },
        "2025-02-03": { type: "holiday", name: "春节" },
        
        // Make-up workdays for Spring Festival
        "2025-01-25": { type: "workday", name: "调休" },
        "2025-01-26": { type: "workday", name: "调休" },
        "2025-02-08": { type: "workday", name: "调休" },
        
        // Qingming Festival (Tomb Sweeping Day)
        "2025-04-04": { type: "holiday", name: "清明节" },
        "2025-04-05": { type: "holiday", name: "清明节" },
        "2025-04-06": { type: "holiday", name: "清明节" },
        
        // Labour Day
        "2025-05-01": { type: "holiday", name: "劳动节" },
        "2025-05-02": { type: "holiday", name: "劳动节" },
        "2025-05-03": { type: "holiday", name: "劳动节" },
        
        // Make-up workday for Labour Day
        "2025-04-27": { type: "workday", name: "调休" },
        "2025-05-10": { type: "workday", name: "调休" },
        
        // Dragon Boat Festival
        "2025-05-31": { type: "holiday", name: "端午节" },
        "2025-06-01": { type: "holiday", name: "端午节" },
        "2025-06-02": { type: "holiday", name: "端午节" },
        
        // Make-up workday for Dragon Boat Festival
        "2025-05-24": { type: "workday", name: "调休" },
        
        // Mid-Autumn Festival & National Day
        "2025-10-01": { type: "holiday", name: "国庆节" },
        "2025-10-02": { type: "holiday", name: "国庆节" },
        "2025-10-03": { type: "holiday", name: "国庆节" },
        "2025-10-04": { type: "holiday", name: "国庆节" },
        "2025-10-05": { type: "holiday", name: "国庆节" },
        "2025-10-06": { type: "holiday", name: "中秋节" },
        "2025-10-07": { type: "holiday", name: "国庆节" },
        
        // Make-up workdays for National Day
        "2025-09-28": { type: "workday", name: "调休" },
        "2025-10-11": { type: "workday", name: "调休" },
        
        // 2026 Holidays and Workdays
        // New Year's Day
        "2026-01-01": { type: "holiday", name: "元旦" },
        "2026-01-02": { type: "holiday", name: "元旦" },
        "2026-01-03": { type: "holiday", name: "元旦" },
        "2026-01-04": { type: "workday", name: "调休" },
        
        // Spring Festival (Chinese New Year)
        "2026-02-15": { type: "holiday", name: "春节" },
        "2026-02-16": { type: "holiday", name: "春节" },
        "2026-02-17": { type: "holiday", name: "春节" },
        "2026-02-18": { type: "holiday", name: "春节" },
        "2026-02-19": { type: "holiday", name: "春节" },
        "2026-02-20": { type: "holiday", name: "春节" },
        "2026-02-21": { type: "holiday", name: "春节" },
        "2026-02-22": { type: "holiday", name: "春节" },
        "2026-02-23": { type: "holiday", name: "春节" },
        // Make-up workdays for Spring Festival
        "2026-02-14": { type: "workday", name: "调休" },
        "2026-02-28": { type: "workday", name: "调休" },
        
        // Qingming Festival (Tomb Sweeping Day)
        "2026-04-04": { type: "holiday", name: "清明节" },
        "2026-04-05": { type: "holiday", name: "清明节" },
        "2026-04-06": { type: "holiday", name: "清明节" },
        
        // Labour Day
        "2026-05-01": { type: "holiday", name: "劳动节" },
        "2026-05-02": { type: "holiday", name: "劳动节" },
        "2026-05-03": { type: "holiday", name: "劳动节" },
        "2026-05-04": { type: "holiday", name: "劳动节" },
        "2026-05-05": { type: "holiday", name: "劳动节" },
        // Make-up workday for Labour Day
        "2026-05-09": { type: "workday", name: "调休" },
        
        // Dragon Boat Festival
        "2026-06-19": { type: "holiday", name: "端午节" },
        "2026-06-20": { type: "holiday", name: "端午节" },
        "2026-06-21": { type: "holiday", name: "端午节" },
        
        // Mid-Autumn Festival
        "2026-09-25": { type: "holiday", name: "中秋节" },
        "2026-09-26": { type: "holiday", name: "中秋节" },
        "2026-09-27": { type: "holiday", name: "中秋节" },
        
        // National Day
        "2026-10-01": { type: "holiday", name: "国庆节" },
        "2026-10-02": { type: "holiday", name: "国庆节" },
        "2026-10-03": { type: "holiday", name: "国庆节" },
        "2026-10-04": { type: "holiday", name: "国庆节" },
        "2026-10-05": { type: "holiday", name: "国庆节" },
        "2026-10-06": { type: "holiday", name: "国庆节" },
        "2026-10-07": { type: "holiday", name: "国庆节" },
        // Make-up workdays for National Day
        "2026-09-20": { type: "workday", name: "调休" },
        "2026-10-10": { type: "workday", name: "调休" }
    };
    
    // Function to get date string in YYYY-MM-DD format
    function getDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Function to check if a date is weekend (Saturday or Sunday)
    function isWeekend(date) {
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6;
    }
    
    // DOM Elements
    const currentMonthElement = document.getElementById('current-month');
    const calendarDaysElement = document.getElementById('calendar-days');
    const todayDateElement = document.getElementById('today-date');
    const prevMonthButton = document.getElementById('prev-month');
    const nextMonthButton = document.getElementById('next-month');
    const countdownListElement = document.getElementById('countdown-list');
    const countdownCountElement = document.getElementById('countdown-count');
    const currentYearElement = document.getElementById('current-year');
    
    // Modal Elements
    const modalOverlay = document.getElementById('modal-overlay');
    const openModalBtn = document.getElementById('open-modal-btn');
    const openModalBtn2 = document.getElementById('open-modal-btn-2');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    const modalEventNameInput = document.getElementById('modal-event-name');
    const modalEventDateInput = document.getElementById('modal-event-date');
    const modalAddEventBtn = document.getElementById('modal-add-event');
    
    // Notify Section Elements (in add/edit modal)
    const notifyToggle = document.getElementById('notify-toggle');
    const notifyBody = document.getElementById('notify-body');
    const notifyEnabledInput = document.getElementById('notify-enabled');
    const notifyReminderTimeInput = document.getElementById('notify-reminder-time');
    const notifyDaysBeforeGrid = document.getElementById('notify-days-before-grid');
    
    // Event Tooltip Elements
    const eventTooltip = document.getElementById('event-tooltip');
    const closeTooltipBtn = document.getElementById('close-tooltip-btn');
    const tooltipBody = document.getElementById('tooltip-body');
    const tooltipDate = document.getElementById('tooltip-date');
    
    // Completed Modal Elements
    const completedModalOverlay = document.getElementById('completed-modal-overlay');
    const showCompletedBtn = document.getElementById('show-completed-btn');
    const closeCompletedModalBtn = document.getElementById('close-completed-modal-btn');
    const cancelCompletedModalBtn = document.getElementById('cancel-completed-modal-btn');
    const completedModalBody = document.getElementById('completed-modal-body');
    
    // Data Management Elements
    const exportDataBtn = document.getElementById('export-data-btn');
    const importDataBtn = document.getElementById('import-data-btn');
    const importFileInput = document.getElementById('import-file-input');
    
    // Settings Modal Elements
    const settingsModalOverlay = document.getElementById('settings-modal-overlay');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
    const cancelSettingsModalBtn = document.getElementById('cancel-settings-modal-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const settingsDeviceKeyInput = document.getElementById('settings-device-key');
    const settingsServerUrlInput = document.getElementById('settings-server-url');
    const settingsEnabledInput = document.getElementById('settings-enabled');
    const settingsReminderTimeInput = document.getElementById('settings-reminder-time');
    const daysBeforeGrid = document.getElementById('days-before-grid');
    const testPushBtn = document.getElementById('test-push-btn');
    const resetNotifyBtn = document.getElementById('reset-notify-btn');
    const importConfigBtn = document.getElementById('import-config-btn');
    const configFileInput = document.getElementById('config-file-input');
    
    // Log Modal Elements
    const logModalOverlay = document.getElementById('log-modal-overlay');
    const openLogBtn = document.getElementById('open-log-btn');
    const closeLogModalBtn = document.getElementById('close-log-modal-btn');
    const cancelLogModalBtn = document.getElementById('cancel-log-modal-btn');
    const logModalBody = document.getElementById('log-modal-body');
    const logEntryCount = document.getElementById('log-entry-count');
    const logFilterAll = document.getElementById('log-filter-all');
    const logFilterInfo = document.getElementById('log-filter-info');
    const logFilterOp = document.getElementById('log-filter-op');
    const logFilterError = document.getElementById('log-filter-error');
    const logExportBtn = document.getElementById('log-export-btn');
    const logClearBtn = document.getElementById('log-clear-btn');
    const logSelectDirBtn = document.getElementById('log-select-dir-btn');
    const logDirLabel = document.getElementById('log-dir-label');
    const logAutosaveBtn = document.getElementById('log-autosave-btn');
    let activeLogFilter = 'all';
    
    // Push notification settings
    const DEFAULT_SETTINGS = {
        enabled: false,
        deviceKey: '',
        serverUrl: 'https://api.day.app',
        daysBefore: [1, 3],
        reminderTime: '09:00'
    };
    let barkSettings = JSON.parse(localStorage.getItem('barkSettings')) || { ...DEFAULT_SETTINGS };
    let sentReminders = JSON.parse(localStorage.getItem('sentReminders')) || [];
    
    // Migrate if settings missing fields
    let settingsChanged = false;
    for (const key in DEFAULT_SETTINGS) {
        if (!(key in barkSettings)) {
            barkSettings[key] = DEFAULT_SETTINGS[key];
            settingsChanged = true;
        }
    }
    if (settingsChanged) {
        localStorage.setItem('barkSettings', JSON.stringify(barkSettings));
    }

    // Migrate countdowns: ensure all have valid notify property
    (function migrateCountdowns() {
        let countdownsChanged = false;
        countdowns.forEach(c => {
            if (!c.notify || typeof c.notify !== 'object') {
                c.notify = {
                    enabled: false,
                    daysBefore: [...barkSettings.daysBefore],
                    reminderTime: barkSettings.reminderTime
                };
                countdownsChanged = true;
            } else {
                if (typeof c.notify.enabled !== 'boolean') {
                    c.notify.enabled = false;
                    countdownsChanged = true;
                }
                if (!c.notify.reminderTime || c.notify.reminderTime === '') {
                    c.notify.reminderTime = barkSettings.reminderTime;
                    countdownsChanged = true;
                }
                if (!Array.isArray(c.notify.daysBefore) || c.notify.daysBefore.length === 0) {
                    c.notify.daysBefore = [...barkSettings.daysBefore];
                    countdownsChanged = true;
                }
            }
        });
        if (countdownsChanged) {
            localStorage.setItem('countdowns', JSON.stringify(countdowns));
        }
    })();
    
    // Initialize
    function init() {
        // Set current year in footer
        currentYearElement.textContent = currentYear;
        
        // Set today's date display
        updateTodayDisplay();
        
        // Set min date for modal event date input to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        modalEventDateInput.min = tomorrow.toISOString().split('T')[0];
        
        // Render calendar
        renderCalendar(currentYear, currentMonth);
        
        // Render countdowns
        renderCountdowns();
        
        // Update countdown count
        updateCountdownCount();
        
        // Add event listeners
        prevMonthButton.addEventListener('click', goToPrevMonth);
        nextMonthButton.addEventListener('click', goToNextMonth);
        
        // Modal event listeners
        openModalBtn.addEventListener('click', openModal);
        openModalBtn2.addEventListener('click', openModal);
        closeModalBtn.addEventListener('click', closeModal);
        cancelModalBtn.addEventListener('click', closeModal);
        modalAddEventBtn.addEventListener('click', addCountdown);
        
        // Allow Enter key in modal to add countdown
        modalEventNameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') addCountdown();
        });
        
        // Close modal when clicking outside
        modalOverlay.addEventListener('click', function(e) {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
        
        // Notify section expand/collapse in add/edit modal
        notifyToggle.addEventListener('click', function() {
            notifyBody.classList.toggle('expanded');
            const arrow = notifyToggle.querySelector('.notify-arrow');
            if (arrow) {
                arrow.classList.toggle('rotated');
            }
        });
        
        // Event tooltip listeners
        closeTooltipBtn.addEventListener('click', closeEventTooltip);
        eventTooltip.addEventListener('click', function(e) {
            if (e.target === eventTooltip) {
                closeEventTooltip();
            }
        });
        
        // Update calendar when events change
        window.addEventListener('countdownsUpdated', function() {
            renderCalendar(currentYear, currentMonth);
        });
        
        // Data management event listeners
        exportDataBtn.addEventListener('click', exportData);
        importDataBtn.addEventListener('click', () => {
            try {
                importFileInput.click();
            } catch (error) {
                Logger.error(`File input trigger failed: ${error.message}`);
                alert('Cannot open file selector. Please try again or check browser permissions.');
            }
        });
        importFileInput.addEventListener('change', handleImportFile);
        
        // Completed modal event listeners
        showCompletedBtn.addEventListener('click', showCompletedModal);
        closeCompletedModalBtn.addEventListener('click', closeCompletedModal);
        cancelCompletedModalBtn.addEventListener('click', closeCompletedModal);
        completedModalOverlay.addEventListener('click', function(e) {
            if (e.target === completedModalOverlay) {
                closeCompletedModal();
            }
        });
        
        // Settings modal event listeners
        openSettingsBtn.addEventListener('click', openSettingsModal);
        closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
        cancelSettingsModalBtn.addEventListener('click', closeSettingsModal);
        saveSettingsBtn.addEventListener('click', saveSettings);
        settingsModalOverlay.addEventListener('click', function(e) {
            if (e.target === settingsModalOverlay) {
                closeSettingsModal();
            }
        });
        testPushBtn.addEventListener('click', sendTestPush);
        resetNotifyBtn.addEventListener('click', resetSentLog);
        importConfigBtn.addEventListener('click', () => configFileInput.click());
        configFileInput.addEventListener('change', handleConfigImport);
        
        // Log modal event listeners
        openLogBtn.addEventListener('click', openLogModal);
        closeLogModalBtn.addEventListener('click', closeLogModal);
        cancelLogModalBtn.addEventListener('click', closeLogModal);
        logModalOverlay.addEventListener('click', function(e) {
            if (e.target === logModalOverlay) closeLogModal();
        });
        logFilterAll.addEventListener('click', () => { activeLogFilter = 'all'; renderLogs(); });
        logFilterInfo.addEventListener('click', () => { activeLogFilter = 'info'; renderLogs(); });
        logFilterOp.addEventListener('click', () => { activeLogFilter = 'operation'; renderLogs(); });
        logFilterError.addEventListener('click', () => { activeLogFilter = 'error'; renderLogs(); });
        logExportBtn.addEventListener('click', () => Logger.export());
        logClearBtn.addEventListener('click', () => {
            if (confirm('Clear all log entries?')) {
                Logger.clear();
                renderLogs();
                Logger.info('Logs cleared');
            }
        });
        logSelectDirBtn.addEventListener('click', async () => {
            if (!FileLog.available()) {
                alert('Your browser does not support the File System Access API. Use Chrome or Edge.');
                return;
            }
            const ok = await FileLog.selectDirectory();
            if (ok) {
                logDirLabel.textContent = FileLog.getDirName();
                if (localStorage.getItem('logAutoSave') !== 'true') {
                    logAutosaveBtn.classList.remove('active');
                }
                updateAutosaveUI();
            }
        });
        logAutosaveBtn.addEventListener('click', async () => {
            if (!FileLog.available()) {
                alert('Your browser does not support the File System Access API. Use Chrome or Edge.');
                return;
            }
            if (!FileLog.getDirName()) {
                const ok = await FileLog.selectDirectory();
                if (!ok) return;
                logDirLabel.textContent = FileLog.getDirName();
            }
            const newState = !FileLog.isAutoSave();
            FileLog.setAutoSave(newState);
            localStorage.setItem('logAutoSave', newState);
            updateAutosaveUI();
            if (newState) {
                FileLog.writeLogFile();
                Logger.info('Auto-save logs enabled');
            } else {
                Logger.info('Auto-save logs disabled');
            }
        });
    }
    
    // Data management functions
    function exportData() {
        Logger.operation(`Exported ${countdowns.length} countdown(s)`);
        const dataStr = JSON.stringify(countdowns, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `countdown-calendar-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert(`Exported ${countdowns.length} countdown(s) to file.`);
    }
    
    function handleImportFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                
                if (!Array.isArray(importedData)) {
                    throw new Error('Invalid data format: expected array');
                }
                
                const validData = importedData.filter(item => {
                    return item && 
                        typeof item === 'object' &&
                        typeof item.name === 'string' &&
                        typeof item.date === 'string' &&
                        item.id;
                });
                
                if (validData.length === 0) {
                    throw new Error('No valid countdown data found in file');
                }
                
                if (confirm(`Import ${validData.length} countdown(s)? This will replace your current countdowns.`)) {
                    countdowns = validData;
                    localStorage.setItem('countdowns', JSON.stringify(countdowns));
                    Logger.operation(`Imported ${validData.length} countdown(s) from file (${file.name})`);
                    renderCountdowns();
                    updateCountdownCount();
                    window.dispatchEvent(new CustomEvent('countdownsUpdated'));
                }
            } catch (error) {
                Logger.error(`Import failed: ${error.message}`);
                alert(`Error importing data: ${error.message}`);
            }
            
            event.target.value = '';
        };
        
        reader.onerror = function(e) {
            Logger.error('Failed to read import file');
            alert('Error reading file. Please try again.');
            event.target.value = '';
        };
        
        reader.readAsText(file);
    }
    
    // Update today's date display
    function updateTodayDisplay() {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        todayDateElement.textContent = new Date().toLocaleDateString('en-US', options);
    }
    
    // Calendar rendering
    function renderCalendar(year, month) {
        // Update month display
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        currentMonthElement.textContent = `${monthNames[month]} ${year}`;
        
        // Clear previous days
        calendarDaysElement.innerHTML = '';
        
        // Get first day of month and total days
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const totalDays = lastDay.getDate();
        const firstDayIndex = firstDay.getDay(); // 0 = Sunday, 6 = Saturday
        
        // Get today's date for comparison (normalized to midnight)
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
        
        // Get dates that have events
        const eventDates = getEventDatesForMonth(year, month);
        
        // Calculate previous month's last day for empty cells before first day
        const prevMonthLastDay = new Date(year, month, 0);
        const prevMonthDays = prevMonthLastDay.getDate();
        
        // Add empty cells for days before the first day of month (previous month)
        for (let i = 0; i < firstDayIndex; i++) {
            const prevMonthDay = prevMonthDays - firstDayIndex + i + 1;
            const date = new Date(year, month - 1, prevMonthDay);
            const dayElement = createDayElement(prevMonthDay, 'other-month');
            
            // Check if date is in the past
            const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            if (normalizedDate < normalizedToday) {
                dayElement.classList.add('past-day');
            }
            
            // Check if weekend
            if (isWeekend(date)) {
                dayElement.classList.add('weekend');
            }
            
            // Check if special date (holiday or make-up workday)
            const dateString = getDateString(date);
            if (specialDates[dateString]) {
                const info = specialDates[dateString];
                const type = typeof info === 'string' ? info : info.type;
                dayElement.classList.add(type);
                if (typeof info === 'object' && info.name) {
                    dayElement.dataset.specialName = info.name;
                }
            }
            
            // Add click event for showing events
            dayElement.addEventListener('click', function() {
                showEventsForDate(date.getFullYear(), date.getMonth(), date.getDate());
            });
            
            // Store date as data attribute
            dayElement.dataset.date = date.toISOString().split('T')[0];
            
            calendarDaysElement.appendChild(dayElement);
        }
        
        // Add days of the month
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const dayElement = createDayElement(day);
            
            // Check if today
            if (isCurrentMonth && day === today.getDate()) {
                dayElement.classList.add('today');
            }
            
            // Check if has event
            if (eventDates.has(day)) {
                dayElement.classList.add('has-event');
            }
            
            // Check if date is in the past (but not today)
            const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            if (normalizedDate < normalizedToday && !(isCurrentMonth && day === today.getDate())) {
                dayElement.classList.add('past-day');
            }
            
            // Check if weekend
            if (isWeekend(date)) {
                dayElement.classList.add('weekend');
            }
            
            // Check if special date (holiday or make-up workday)
            const dateString = getDateString(date);
            if (specialDates[dateString]) {
                const info = specialDates[dateString];
                const type = typeof info === 'string' ? info : info.type;
                dayElement.classList.add(type);
                if (typeof info === 'object' && info.name) {
                    dayElement.dataset.specialName = info.name;
                }
            }
            
            // Add click event for showing events (for all dates)
            dayElement.addEventListener('click', function() {
                showEventsForDate(year, month, day);
            });
            
            // Store date as data attribute for styling
            dayElement.dataset.date = date.toISOString().split('T')[0];
            
            calendarDaysElement.appendChild(dayElement);
        }
        
        // Add empty cells for remaining slots (to fill 6 rows) - next month days
        const totalCells = 42; // 6 rows * 7 days
        const existingCells = firstDayIndex + totalDays;
        const nextMonthDayCount = totalCells - existingCells;
        
        for (let i = 0; i < nextMonthDayCount; i++) {
            const nextMonthDay = i + 1;
            const date = new Date(year, month + 1, nextMonthDay);
            const dayElement = createDayElement(nextMonthDay, 'other-month');
            
            // Check if date is in the past
            const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            if (normalizedDate < normalizedToday) {
                dayElement.classList.add('past-day');
            }
            
            // Check if weekend
            if (isWeekend(date)) {
                dayElement.classList.add('weekend');
            }
            
            // Check if special date (holiday or make-up workday)
            const dateString = getDateString(date);
            if (specialDates[dateString]) {
                const info = specialDates[dateString];
                const type = typeof info === 'string' ? info : info.type;
                dayElement.classList.add(type);
                if (typeof info === 'object' && info.name) {
                    dayElement.dataset.specialName = info.name;
                }
            }
            
            // Add click event for showing events
            dayElement.addEventListener('click', function() {
                showEventsForDate(date.getFullYear(), date.getMonth(), date.getDate());
            });
            
            // Store date as data attribute
            dayElement.dataset.date = date.toISOString().split('T')[0];
            
            calendarDaysElement.appendChild(dayElement);
        }
    }
    
    // Create a day element for the calendar
    function createDayElement(dayNumber, className = '') {
        const dayElement = document.createElement('div');
        dayElement.className = 'day';
        if (className) dayElement.classList.add(className);
        dayElement.textContent = dayNumber;
        return dayElement;
    }
    
    // Get events for a specific date
    function getEventsForDate(year, month, day) {
        const targetDate = new Date(year, month, day);
        targetDate.setHours(0, 0, 0, 0);
        
        return countdowns.filter(countdown => {
            const eventDate = parseLocalDate(countdown.date);
            eventDate.setHours(0, 0, 0, 0);
            return eventDate.getTime() === targetDate.getTime();
        });
    }
    
    // Show events for a specific date in tooltip
    function showEventsForDate(year, month, day) {
        const events = getEventsForDate(year, month, day);
        const date = new Date(year, month, day);
        const formattedDate = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        // Update tooltip date with holiday/workday info
        const dateString = getDateString(date);
        let dateType = '';
        let dateIcon = '';
        let dateText = '';
        
        if (specialDates[dateString]) {
            const info = specialDates[dateString];
            const type = typeof info === 'string' ? info : info.type;
            dateType = type;
            if (type === 'holiday') {
                dateIcon = '<i class="fas fa-umbrella-beach"></i>';
                dateText = typeof info === 'object' && info.name ? info.name : 'Public Holiday';
            } else if (type === 'workday') {
                dateIcon = '<i class="fas fa-briefcase"></i>';
                dateText = typeof info === 'object' && info.name ? info.name : 'Make-up Workday';
            }
        }
        
        let dateTypeHtml = '';
        if (dateType) {
            dateTypeHtml = `<span class="date-type ${dateType}">${dateIcon} ${dateText}</span>`;
        }
        
        tooltipDate.innerHTML = `
            <div class="tooltip-date-main">
                <i class="fas fa-calendar-alt"></i> ${formattedDate}
            </div>
            ${dateTypeHtml}
        `;
        
        // Clear previous events
        tooltipBody.innerHTML = '';
        
        if (events.length === 0) {
            tooltipBody.innerHTML = `
                <div class="tooltip-event-item">
                    <div class="tooltip-event-name">No events found for this date</div>
                </div>
            `;
        } else {
            events.forEach(event => {
                const eventItem = document.createElement('div');
                eventItem.className = 'tooltip-event-item';
                if (event.completed) {
                    eventItem.classList.add('completed');
                }
                eventItem.innerHTML = `
                    <div class="tooltip-event-name">
                        ${escapeHtml(event.name)}
                        ${event.completed ? '<span class="completed-badge"><i class="fas fa-check-circle"></i> Completed</span>' : ''}
                    </div>
                    <div class="tooltip-event-days">
                        <i class="fas fa-hourglass-half"></i>
                        ${event.days} ${event.days === 1 ? 'day' : 'days'} remaining
                    </div>
                `;
                tooltipBody.appendChild(eventItem);
            });
        }
        
        // Show tooltip
        eventTooltip.classList.add('active');
    }
    
    // Close event tooltip
    function closeEventTooltip() {
        eventTooltip.classList.remove('active');
    }
    
    // Get set of days that have events in the given month/year
    function getEventDatesForMonth(year, month) {
        const eventDates = new Set();
        
        countdowns.forEach(countdown => {
            const eventDate = parseLocalDate(countdown.date);
            const eventYear = eventDate.getFullYear();
            const eventMonth = eventDate.getMonth();
            const eventDay = eventDate.getDate();
            
            if (eventYear === year && eventMonth === month) {
                eventDates.add(eventDay);
            }
        });
        
        return eventDates;
    }
    
    // Month navigation
    function goToPrevMonth() {
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        renderCalendar(currentYear, currentMonth);
    }
    
    function goToNextMonth() {
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        renderCalendar(currentYear, currentMonth);
    }
    
    // Body scroll lock helpers
    let bodyScrollPosition = 0;
    function lockBodyScroll() {
        bodyScrollPosition = window.scrollY;
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${bodyScrollPosition}px`;
        document.body.style.width = '100%';
    }
    function unlockBodyScroll() {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, bodyScrollPosition);
    }

    // Modal Functions
    function openModal() {
        lockBodyScroll();
        if (editingId === null) {
            // Clear form for new countdown
            modalEventNameInput.value = '';
            modalEventDateInput.value = '';
            
            // Set min date to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            modalEventDateInput.min = tomorrow.toISOString().split('T')[0];
            
            // Set notify defaults from global settings
            notifyEnabledInput.checked = false;
            notifyReminderTimeInput.value = barkSettings.reminderTime;
            const nCheckboxes = notifyDaysBeforeGrid.querySelectorAll('input[type="checkbox"]');
            nCheckboxes.forEach(cb => {
                cb.checked = barkSettings.daysBefore.includes(parseInt(cb.value));
            });
            notifyBody.classList.remove('expanded');
            const arrow = notifyToggle.querySelector('.notify-arrow');
            if (arrow) arrow.classList.remove('rotated');
            
            // Set modal title and button for adding
            document.querySelector('.modal-header h2').innerHTML = '<i class="fas fa-plus-circle"></i> Add New Countdown';
            modalAddEventBtn.innerHTML = '<i class="fas fa-plus"></i> Add Countdown';
        } else {
            // For editing, min date should still be tomorrow (can't set to past)
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            modalEventDateInput.min = tomorrow.toISOString().split('T')[0];
        }
        
        // Show modal
        modalOverlay.classList.add('active');
        modalEventNameInput.focus();
    }
    
    function closeModal() {
        modalOverlay.classList.remove('active');
        editingId = null;
        unlockBodyScroll();
    }
    
    // Countdown functions
    function addCountdown() {
        const name = modalEventNameInput.value.trim();
        const dateString = modalEventDateInput.value;
        
        // Validation
        if (!name) {
            alert('Please enter a name for your countdown.');
            modalEventNameInput.focus();
            return;
        }
        
        if (!dateString) {
            alert('Please select a target date.');
            modalEventDateInput.focus();
            return;
        }
        
        const targetDate = parseLocalDate(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);
        
        if (targetDate <= today) {
            alert('Please select a future date.');
            modalEventDateInput.focus();
            return;
        }
        
        // Calculate days including both today and target day
        const days = calculateDaysBetween(today, targetDate);
        
        // Read per-item notify settings
        const nCheckboxes = notifyDaysBeforeGrid.querySelectorAll('input[type="checkbox"]:checked');
        const notifyDaysBefore = Array.from(nCheckboxes).map(cb => parseInt(cb.value)).sort((a, b) => a - b);
        const notifyConfig = {
            enabled: notifyEnabledInput.checked,
            daysBefore: notifyDaysBefore,
            reminderTime: notifyReminderTimeInput.value
        };
        
        if (editingId !== null) {
            // Update existing countdown
            const index = countdowns.findIndex(c => c.id === editingId);
            if (index !== -1) {
                countdowns[index].name = name;
                countdowns[index].date = dateString;
                countdowns[index].days = days;
                countdowns[index].notify = notifyConfig;
                Logger.operation(`Updated countdown: ${name} (${dateString}, ${days} days remaining)`);
            }
        } else {
            // Create new countdown object
            const countdown = {
                id: Date.now(),
                name: name,
                date: dateString,
                days: days,
                createdAt: new Date().toISOString(),
                notify: notifyConfig
            };
            
            // Add to array
            countdowns.push(countdown);
            Logger.operation(`Added countdown: ${name} (${dateString}, ${days} days remaining)`);
        }
        
        // Save to localStorage
        localStorage.setItem('countdowns', JSON.stringify(countdowns));
        
        // Close modal
        closeModal();
        
        // Update UI
        renderCountdowns();
        updateCountdownCount();
        
        // Trigger calendar update
        window.dispatchEvent(new CustomEvent('countdownsUpdated'));
    }
    
    // Calculate days remaining (days between start and end, exclusive of start)
    function calculateDaysBetween(startDate, endDate) {
        const oneDay = 24 * 60 * 60 * 1000;
        const diffDays = Math.round(Math.abs((endDate - startDate) / oneDay));
        return diffDays;
    }
    
    // Render countdown list (only active/non-completed)
    function renderCountdowns() {
        const activeCountdowns = countdowns.filter(c => !c.completed);
        
        if (activeCountdowns.length === 0) {
            countdownListElement.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-hourglass-start"></i>
                    <p>No countdowns yet. Click the + button to add one!</p>
                </div>
            `;
            return;
        }
        
        // Sort by date (closest first) - using local time
        activeCountdowns.sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
        
        let html = '';
        activeCountdowns.forEach(countdown => {
            // Parse date as local time for display
            const dateObj = parseLocalDate(countdown.date);
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            html += `
                <div class="countdown-item-compact" data-id="${countdown.id}">
                    <div class="event-info">
                        <div class="event-name">
                            ${escapeHtml(countdown.name)}
                            ${countdown.notify && countdown.notify.enabled ? '<i class="fas fa-bell notify-icon" title="Notifications enabled"></i>' : ''}
                        </div>
                        <div class="event-date">
                            <i class="fas fa-calendar-day"></i>
                            ${formattedDate}
                        </div>
                    </div>
                    <div class="countdown-display">
                        <div class="days-number">${countdown.days}</div>
                        <div class="days-label">${countdown.days === 1 ? 'day' : 'days'}</div>
                    </div>
                    <div class="countdown-actions">
                        <button class="complete-btn" onclick="completeCountdown(${countdown.id})" title="Mark as completed">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="edit-btn" onclick="editCountdown(${countdown.id})" title="Edit this countdown">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-btn" onclick="deleteCountdown(${countdown.id})" title="Delete this countdown">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        countdownListElement.innerHTML = html;
    }
    
    // Edit a countdown
    window.editCountdown = function(id) {
        const countdown = countdowns.find(c => c.id === id);
        if (!countdown) return;
        
        editingId = id;
        modalEventNameInput.value = countdown.name;
        modalEventDateInput.value = countdown.date;
        
        // Populate per-item notify settings
        const n = countdown.notify || {};
        notifyEnabledInput.checked = n.enabled === true;
        notifyReminderTimeInput.value = (n.reminderTime && n.reminderTime !== '') ? n.reminderTime : barkSettings.reminderTime;
        const nCheckboxes = notifyDaysBeforeGrid.querySelectorAll('input[type="checkbox"]');
        const daysBefore = (Array.isArray(n.daysBefore) && n.daysBefore.length > 0) ? n.daysBefore : barkSettings.daysBefore;
        nCheckboxes.forEach(cb => {
            cb.checked = daysBefore.includes(parseInt(cb.value));
        });
        notifyBody.classList.add('expanded');
        const arrow = notifyToggle.querySelector('.notify-arrow');
        if (arrow) arrow.classList.add('rotated');
        
        // Update modal title and button
        document.querySelector('.modal-header h2').innerHTML = '<i class="fas fa-edit"></i> Edit Countdown';
        modalAddEventBtn.innerHTML = '<i class="fas fa-save"></i> Update Countdown';
        
        openModal();
    };
    
    // Delete a countdown
    window.deleteCountdown = function(id) {
        const item = countdowns.find(c => c.id === id);
        const itemName = item ? item.name : '(unknown)';
        if (confirm('Are you sure you want to delete this countdown?')) {
            countdowns = countdowns.filter(c => c.id !== id);
            localStorage.setItem('countdowns', JSON.stringify(countdowns));
            Logger.operation(`Deleted countdown: ${itemName}`);
            renderCountdowns();
            updateCountdownCount();
            window.dispatchEvent(new CustomEvent('countdownsUpdated'));
            // Refresh completed modal if it's open
            if (completedModalOverlay.classList.contains('active')) {
                showCompletedModal();
            }
        }
    };
    
    // Mark a countdown as completed
    window.completeCountdown = function(id) {
        const countdown = countdowns.find(c => c.id === id);
        if (!countdown) return;
        
        countdown.completed = true;
        countdown.completedAt = new Date().toISOString();
        localStorage.setItem('countdowns', JSON.stringify(countdowns));
        Logger.operation(`Completed countdown: ${countdown.name}`);
        renderCountdowns();
        updateCountdownCount();
        window.dispatchEvent(new CustomEvent('countdownsUpdated'));
    };
    
    // Show completed items modal
    function showCompletedModal() {
        lockBodyScroll();
        const completedItems = countdowns.filter(c => c.completed);
        
        if (completedItems.length === 0) {
            completedModalBody.innerHTML = `
                <div class="empty-state" style="padding: 30px 0;">
                    <i class="fas fa-clipboard-check" style="font-size: 2.5rem; margin-bottom: 15px; color: #dfe6e9;"></i>
                    <p>No completed items yet.</p>
                </div>
            `;
        } else {
            completedItems.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
            
            let html = '';
            completedItems.forEach(item => {
                const dateObj = parseLocalDate(item.date);
                const formattedDate = dateObj.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                const completedDate = new Date(item.completedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                
                html += `
                    <div class="completed-item">
                        <div class="completed-item-info">
                            <div class="completed-item-name">
                                <span class="completed-check"><i class="fas fa-check-circle"></i></span>
                                ${escapeHtml(item.name)}
                            </div>
                            <div class="completed-item-date">
                                <i class="fas fa-calendar-check"></i> Target: ${formattedDate}
                            </div>
                            <div class="completed-item-completed-date">
                                <i class="fas fa-clock"></i> Completed: ${completedDate}
                            </div>
                        </div>
                        <button class="delete-btn" onclick="deleteCountdown(${item.id})" title="Delete this item">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            });
            
            completedModalBody.innerHTML = html;
        }
        
        completedModalOverlay.classList.add('active');
    }
    
    function closeCompletedModal() {
        completedModalOverlay.classList.remove('active');
        unlockBodyScroll();
    }
    
    // ===== Settings Modal Functions =====
    
    function openSettingsModal() {
        settingsDeviceKeyInput.value = barkSettings.deviceKey;
        settingsServerUrlInput.value = barkSettings.serverUrl;
        settingsEnabledInput.checked = barkSettings.enabled;
        settingsReminderTimeInput.value = barkSettings.reminderTime;
        
        const checkboxes = daysBeforeGrid.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = barkSettings.daysBefore.includes(parseInt(cb.value));
        });
        
        settingsModalOverlay.classList.add('active');
    }
    
    function closeSettingsModal() {
        settingsModalOverlay.classList.remove('active');
    }
    
    function saveSettings() {
        const deviceKey = settingsDeviceKeyInput.value.trim();
        const serverUrl = settingsServerUrlInput.value.trim() || 'https://api.day.app';
        
        const checkboxes = daysBeforeGrid.querySelectorAll('input[type="checkbox"]:checked');
        const daysBefore = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a, b) => a - b);
        
        barkSettings = {
            enabled: settingsEnabledInput.checked,
            deviceKey: deviceKey,
            serverUrl: serverUrl.replace(/\/$/, ''),
            daysBefore: daysBefore,
            reminderTime: settingsReminderTimeInput.value
        };
        
        localStorage.setItem('barkSettings', JSON.stringify(barkSettings));
        Logger.operation('Bark push settings updated');
        closeSettingsModal();
    }
    
    function getPushApiUrl() {
        return `${barkSettings.serverUrl}/${barkSettings.deviceKey}/`;
    }
    
    async function sendBarkPush(title, body) {
        const key = barkSettings.deviceKey.trim();
        if (!key) return;
        
        const server = barkSettings.serverUrl.replace(/\/$/, '');
        const url = `${server}/${encodeURIComponent(key)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
        
        try {
            const response = await fetch(url);
            const result = await response.json();
            return result;
        } catch (error) {
            Logger.error(`Bark push failed: ${error.message}`);
            return null;
        }
    }
    
    function sendTestPush() {
        const key = settingsDeviceKeyInput.value.trim();
        if (!key) {
            alert('Please enter your Bark Device Key first.');
            return;
        }
        
        const server = (settingsServerUrlInput.value.trim() || 'https://api.day.app').replace(/\/$/, '');
        const url = `${server}/${encodeURIComponent(key)}/Countdown%20Calendar/Test push sent successfully! 🎉?group=CountdownCalendar`;
        Logger.info('Sending test push notification');
        
        fetch(url)
            .then(response => response.json())
            .then(result => {
                if (result.code === 200) {
                    Logger.operation('Test push notification sent successfully');
                    alert('Test push sent successfully! Check your iPhone.');
                } else {
                    Logger.error(`Test push failed: ${result.message || 'Unknown error'}`);
                    alert('Push failed: ' + (result.message || 'Unknown error'));
                }
            })
            .catch(error => {
                Logger.error(`Test push failed: ${error.message}`);
                alert('Push failed: ' + error.message);
            });
    }
    
    function resetSentLog() {
        if (confirm('Clear all sent reminder records? Reminders will be re-sent on next check.')) {
            sentReminders = [];
            localStorage.setItem('sentReminders', JSON.stringify(sentReminders));
            Logger.operation('Sent reminder log cleared');
            alert('Sent reminder log has been cleared.');
        }
    }
    
    function handleConfigImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const config = JSON.parse(e.target.result);
                if (config.deviceKey) settingsDeviceKeyInput.value = config.deviceKey;
                if (config.serverUrl) settingsServerUrlInput.value = config.serverUrl;
                if (typeof config.enabled === 'boolean') settingsEnabledInput.checked = config.enabled;
                if (config.reminderTime) settingsReminderTimeInput.value = config.reminderTime;
                if (Array.isArray(config.daysBefore)) {
                    const checkboxes = daysBeforeGrid.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach(cb => {
                        cb.checked = config.daysBefore.includes(parseInt(cb.value));
                    });
                }
                Logger.operation('Bark config loaded from file (' + file.name + ')');
                alert('Config loaded. Click "Save Settings" to apply.');
            } catch (error) {
                Logger.error(`Config import failed: ${error.message}`);
                alert('Invalid config file: ' + error.message);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }
    
    // ===== Log Modal Functions =====
    
    function openLogModal() {
        renderLogs();
        updateAutosaveUI();
        logModalOverlay.classList.add('active');
    }
    
    function closeLogModal() {
        logModalOverlay.classList.remove('active');
    }
    
    function updateAutosaveUI() {
        const dirName = FileLog.getDirName();
        if (dirName) {
            logDirLabel.textContent = dirName;
        } else {
            logDirLabel.textContent = 'Choose Folder';
        }
        if (FileLog.isAutoSave()) {
            logAutosaveBtn.classList.add('active');
        } else {
            logAutosaveBtn.classList.remove('active');
        }
    }
    
    function renderLogs() {
        const allLogs = Logger.getAll();
        const filteredLogs = activeLogFilter === 'all'
            ? allLogs
            : allLogs.filter(l => l.type === activeLogFilter);
        const displayLogs = filteredLogs.slice().reverse();
        
        logEntryCount.textContent = `${displayLogs.length} entries`;
        
        if (displayLogs.length === 0) {
            logModalBody.innerHTML = '<div class="log-empty"><i class="fas fa-clipboard-check"></i><p>No logs to display.</p></div>';
        } else {
            logModalBody.innerHTML = displayLogs.map(entry => {
                const date = new Date(entry.ts);
                const timeStr = date.toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                const icons = { info: 'fa-info-circle', operation: 'fa-cogs', error: 'fa-exclamation-circle' };
                const icon = icons[entry.type] || 'fa-circle';
                const badgeText = { info: 'INFO', operation: 'OP', error: 'ERROR' };
                return `<div class="log-entry ${entry.type}">
                    <span class="log-entry-icon"><i class="fas ${icon}"></i></span>
                    <span class="log-entry-badge">${badgeText[entry.type]}</span>
                    <span class="log-entry-time">${timeStr}</span>
                    <span class="log-entry-msg">${escapeHtml(entry.msg)}</span>
                </div>`;
            }).join('');
        }
        
        // Update filter button active states
        [logFilterAll, logFilterInfo, logFilterOp, logFilterError].forEach(btn => btn.classList.remove('active'));
        switch (activeLogFilter) {
            case 'all':       logFilterAll.classList.add('active'); break;
            case 'info':      logFilterInfo.classList.add('active'); break;
            case 'operation': logFilterOp.classList.add('active'); break;
            case 'error':     logFilterError.classList.add('active'); break;
        }
    }
    
    // ===== Push Notification Scheduler =====
    
    function getNotifyConfigForItem(countdown) {
        const n = countdown.notify || {};
        return {
            enabled: n.enabled || false,
            daysBefore: n.daysBefore && n.daysBefore.length > 0 ? n.daysBefore : barkSettings.daysBefore,
            reminderTime: n.reminderTime || barkSettings.reminderTime
        };
    }
    
    function checkAndSendReminders() {
        if (!barkSettings.deviceKey) return;
        
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        const todayStr = now.toISOString().split('T')[0];
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const activeCountdowns = countdowns.filter(c => !c.completed);
        
        activeCountdowns.forEach(countdown => {
            const notifyConfig = getNotifyConfigForItem(countdown);
            if (!notifyConfig.enabled) return;
            if (notifyConfig.daysBefore.length === 0) return;
            
            const [reminderHour, reminderMinute] = notifyConfig.reminderTime.split(':').map(Number);
            
            // Only send reminders at or after the item's configured reminder time
            if (currentHour < reminderHour || (currentHour === reminderHour && currentMinute < reminderMinute)) {
                return;
            }
            
            // Recalculate days to be sure
            const targetDate = parseLocalDate(countdown.date);
            targetDate.setHours(0, 0, 0, 0);
            const remainingDays = calculateDaysBetween(today, targetDate);
            
            notifyConfig.daysBefore.forEach(daysBefore => {
                const reminderKey = `${countdown.id}-${daysBefore}`;
                
                // Check if already sent today
                if (sentReminders.includes(reminderKey + '-' + todayStr)) return;
                
                if (remainingDays === daysBefore) {
                    const title = countdown.name;
                    const body = daysBefore === 1 
                        ? 'Only 1 day remaining!'
                        : `${daysBefore} days remaining until this event.`;
                    
                    sendBarkPush(title, body).then(result => {
                        if (result && result.code === 200) {
                            sentReminders.push(reminderKey + '-' + todayStr);
                            if (sentReminders.length > 500) {
                                sentReminders = sentReminders.slice(-500);
                            }
                            localStorage.setItem('sentReminders', JSON.stringify(sentReminders));
                        }
                    });
                }
            });
        });
        
        // Clean old sentReminders entries (not from today)
        sentReminders = sentReminders.filter(key => {
            const keyDate = key.split('-').slice(-3).join('-');
            return keyDate === todayStr;
        });
        localStorage.setItem('sentReminders', JSON.stringify(sentReminders));
    }
    
    // Update countdown count badge (active only)
    function updateCountdownCount() {
        const activeCount = countdowns.filter(c => !c.completed).length;
        countdownCountElement.textContent = activeCount;
    }
    
    // Update countdown days daily
    function updateCountdownDays() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let needsUpdate = false;
        
        countdowns.forEach(countdown => {
            const targetDate = parseLocalDate(countdown.date);
            targetDate.setHours(0, 0, 0, 0);
            
            if (targetDate >= today) {
                const newDays = calculateDaysBetween(today, targetDate);
                if (newDays !== countdown.days) {
                    countdown.days = newDays;
                    needsUpdate = true;
                }
            } else {
                // Past event - keep days at 0
                countdown.days = 0;
                needsUpdate = true;
            }
        });
        
        if (needsUpdate) {
            localStorage.setItem('countdowns', JSON.stringify(countdowns));
            renderCountdowns();
        }
    }
    
    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Check for daily updates
    function checkDailyUpdate() {
        const lastUpdate = localStorage.getItem('lastCountdownUpdate');
        const today = new Date().toDateString();
        
        if (lastUpdate !== today) {
            updateCountdownDays();
            localStorage.setItem('lastCountdownUpdate', today);
        }
    }
    
    // Initialize the app
    init();
    checkDailyUpdate();
    
    // Restore file logging directory and auto-save
    FileLog.restoreDirectory().then(ok => {
        if (ok) {
            const autoSave = localStorage.getItem('logAutoSave') === 'true';
            FileLog.setAutoSave(autoSave);
        }
    });
    
    // Update countdowns every minute and check for push reminders
    setInterval(function() {
        updateCountdownDays();
        checkAndSendReminders();
    }, 60000);
    
    // Also check reminders on load
    setTimeout(checkAndSendReminders, 5000);
});