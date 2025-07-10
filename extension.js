import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { TimerManager } from './timer-manager.js';
import { PanelUI } from './panel-ui.js';
import { debugLog, calculateTimeUntil, CHECK_TIMER_SECONDS, REPAINT_SECONDS, UPDATE_MENU_SECONDS } from './utils.js';

/**
 * Main extension class - coordinates all components and handles lifecycle
 */
export default class WorkDayReminder extends Extension {
    constructor(metadata) {
        super(metadata);
        
        // Core components
        this._settings = null;
        this._timerManager = null;
        this._panelUI = null;
        
        // Timeouts for periodic tasks
        this._repaintTimeOut = null;
        this._checkTimeOut = null;
        this._updateMenuTimeOut = null;
        this._activationTimeOut = null;
        this._deactivationTimeOut = null;
        
        // Settings connection
        this._settingsConnection = null;
    }

    /**
     * Extension enable - setup all components
     */
    enable() {
        try {
            // Initialize settings
            this._settings = this.getSettings();
            
            // Create timer manager
            this._timerManager = new TimerManager(this._settings);
            
            // Create panel UI
            this._panelUI = new PanelUI(this, this._timerManager);
            this._panelUI.createPanelUI();
            
            // Setup UI update callbacks
            this._timerManager.setUpdateCallbacks(
                () => this._panelUI.updateLabel(),
                () => this._panelUI.updateIcon(),
                () => this._panelUI.updateTimerMenuTexts()
            );
            
            // Try to restore timer state from previous session first
            const restored = this._timerManager.tryRestoreTimerState();
            
            // Update menu items, but skip timer start if we restored timers
            this._panelUI.updateTimerMenuItems(restored);
            
            // Connect settings changes
            this._settingsConnection = this._settings.connect('changed::timers', () => 
                this._panelUI.updateTimerMenuItems());
            
            // Only start new timers if no state was restored AND we're within active hours
            if (!restored && this._timerManager.isWithinActiveHours()) {
                this._timerManager.startValidTimers();
            }
            
            // Check active hours and stop timers if outside active hours (even restored ones)
            this._timerManager.checkActiveHours();
            
            // Setup periodic timeouts and schedule activation
            this._setupTimeouts();
            this._scheduleTimerActivation();
            
            debugLog('WorkDay Reminder extension enabled');
        } catch (error) {
            console.error('Error enabling WorkDay Reminder extension:', error);
        }
    }

    /**
     * Extension disable - cleanup all components
     */
    disable() {
        try {
            // Destroy timeouts first
            this._destroyTimeouts();
            
            // Disconnect settings connection
            if (this._settingsConnection && this._settings) {
                this._settings.disconnect(this._settingsConnection);
                this._settingsConnection = null;
            }
            
            // Destroy panel UI
            if (this._panelUI) {
                this._panelUI.destroy();
                this._panelUI = null;
            }
            
            // Destroy timer manager (this will persist timer state)
            if (this._timerManager) {
                this._timerManager.destroy();
                this._timerManager = null;
            }
            
            // Clear settings reference
            this._settings = null;
            
            debugLog('WorkDay Reminder extension disabled');
        } catch (error) {
            console.error('Error disabling WorkDay Reminder extension:', error);
        }
    }

    /**
     * Setup periodic timeout handlers
     */
    _setupTimeouts() {
        this._repaintTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REPAINT_SECONDS, () => {
            this._panelUI?.updateIcon();
            this._panelUI?.updateLabel();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._checkTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_TIMER_SECONDS, () => {
            this._timerManager?.checkTimers();
            this._timerManager?.checkActiveHours();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._updateMenuTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_MENU_SECONDS, () => {
            this._panelUI?.updateTimerMenuTexts();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Schedule a timer for a specific time
     */
    _scheduleTimer(timeString, action, logPrefix) {
        const secondsUntil = Math.ceil(calculateTimeUntil(timeString) / 1000);
        debugLog(`Scheduling ${logPrefix} in ${secondsUntil} seconds at ${timeString}`);
        
        return GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secondsUntil, () => {
            debugLog(`${logPrefix} at ${timeString} triggered`);
            action();
            this._scheduleTimerActivation();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Schedule activation and deactivation timers
     */
    _scheduleTimerActivation() {
        // Clear existing timeouts
        [this._activationTimeOut, this._deactivationTimeOut].forEach(timeout => {
            if (timeout) GLib.Source.remove(timeout);
        });
        
        if (!this._settings) return;
        
        const activateTime = this._settings.get_string('activate-time');
        const deactivateTime = this._settings.get_string('deactivate-time');
        
        this._activationTimeOut = this._scheduleTimer(activateTime, () => {
            debugLog('Activation time reached - starting timers');
            this._timerManager?.startValidTimers();
        }, 'Timer activation');
        
        this._deactivationTimeOut = this._scheduleTimer(deactivateTime, () => {
            debugLog('Deactivation time reached - stopping timers');
            this._timerManager?.stopAllTimers();
        }, 'Timer deactivation');
    }

    /**
     * Destroy all timeouts
     */
    _destroyTimeouts() {
        const timeouts = [
            this._repaintTimeOut,
            this._checkTimeOut,
            this._updateMenuTimeOut,
            this._activationTimeOut,
            this._deactivationTimeOut
        ];
        
        timeouts.forEach(timeout => {
            if (timeout) {
                GLib.Source.remove(timeout);
            }
        });
        
        this._repaintTimeOut = null;
        this._checkTimeOut = null;
        this._updateMenuTimeOut = null;
        this._activationTimeOut = null;
        this._deactivationTimeOut = null;
    }

    /**
     * Open preferences dialog
     */
    openPreferences() {
        try { 
            super.openPreferences(); 
        } catch (e) { 
            console.warn('Failed to open preferences:', e); 
        }
    }
}
