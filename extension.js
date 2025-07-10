import St from 'gi://St';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const REPAINT_SECONDS = 10;
const CHECK_TIMER_SECONDS = 10;
const UPDATE_MENU_SECONDS = 30;
const MAX_RESTORE_MINUTES = 15;

// Utility functions
const parseTime = timeString => timeString.split(':').map(Number);
const timeToMinutes = (hour, minute) => hour * 60 + minute;
const calculateTimeUntil = (timeString) => {
    const now = new Date();
    const target = new Date(now);
    const [hour, minute] = parseTime(timeString);
    target.setHours(hour, minute, 0, 0);
    if (now >= target) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
};

const repaint = (area, percentageDone) => {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const [x, y, r] = [width / 2, height / 2, width / 2.5];
    
    // Background circle
    context.arc(x, y, r, 0, 2 * Math.PI);
    context.setSourceRGBA(148/255, 148/255, 148/255, 1);
    context.stroke();
    
    // Progress arc
    const startPoint = 1.5 * Math.PI;
    const endPoint = (startPoint + 2 * Math.PI * percentageDone) % (2 * Math.PI);
    context.arc(x, y, r, startPoint, endPoint);
    context.setSourceRGBA(242/255, 242/255, 242/255, 1);
    context.stroke();
    context.$dispose();
};

export default class WorkDayReminder extends Extension {
    // Timer Management
    _loadTimers() {
        try {
            return JSON.parse(this._settings.get_string('timers'));
        } catch (e) {
            console.warn('Failed to load timers:', e);
            return [];
        }
    }

    _isValidTimer = (timer) => timer && typeof timer.timeBetweenNotifications === 'number';

    _startValidTimers() {
        if (!this._timers?.length) return;
        this._timers?.forEach((timer, index) => {
            if (this._isValidTimer(timer))
                this.addNewTimer(index, timer.timeBetweenNotifications);
        });
    }

    _getNextTimer = () => this._activeTimers?.length ? 
        this._activeTimers.reduce((earliest, current) => 
            current.endTime < earliest.endTime ? current : earliest) : null;

    // UI Management
    _createPanelUI() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._container = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._icon = new St.DrawingArea({ width: 25, height: 25 });
        this._iconConnection = this._icon.connect('repaint', (area) => repaint(area, this.calculatePercentageDone()));
        this._label = new St.Label({ text: 'No Timer', style_class: 'panel-button', y_align: 2 });
        
        this._container.add_child(this._icon);
        this._container.add_child(this._label);
        this._indicator.add_child(this._container);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _updateTimerMenuItems(skipTimerStart = false) {
        // Remove all existing menu items
        this._indicator?.menu.removeAll();
        this._timerMenuItems = [];
        this._timers = this._loadTimers();
        
        // Only reset active timers if we're not already running any and not explicitly skipping
        if (!skipTimerStart && (!this._activeTimers || this._activeTimers.length === 0)) {
            this._activeTimers = [];
            if (this._isWithinActiveHours()) {
                this._startValidTimers();
            }
        }
        
        this._updateLabel();
        this._createMenuItems();
    }

    _createMenuItems() {
        if (!this._timers?.length || !this._indicator?.menu) return;

        this._timers.forEach((timer, index) => {
            if (timer?.name && this._isValidTimer(timer)) {
                this._timerMenuItems.push(this._indicator.menu.addAction(
                    this._getTimerMenuText(timer.name, index), 
                    () => this.addNewTimer(index, timer.timeBetweenNotifications)
                ));
            }
        });
        
        if (this._timers.length > 0) {
            this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._indicator.menu.addAction('Stop All Timers', () => this.stopAllTimers());
        }
        
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._indicator.menu.addAction('Preferences', () => this.openPreferences());
    }

    _getTimerMenuText(timerName, timerIndex) {
        const remainingTime = this.getRemainingTimeForTimer(timerIndex);
        return `Reset ${timerName} Timer${remainingTime === null ? '' : ` [${remainingTime} min]`}`;
    }

    _updateTimerMenuTexts() {
        if (!this._timerMenuItems || !this._timers) return;
        
        this._timerMenuItems.forEach((menuItem, index) => {
            if (menuItem && this._timers[index]?.name) {
                menuItem.label.set_text(this._getTimerMenuText(this._timers[index].name, index));
            }
        });
    }

    _updateLabel = () => this._label?.set_text(this.getCurrentTimerName());

    // Time Management
    _isWithinActiveHours() {
        const now = new Date();
        const currentMinutes = timeToMinutes(now.getHours(), now.getMinutes());
        const [activateHour, activateMinute] = parseTime(this._settings.get_string('activate-time'));
        const [deactivateHour, deactivateMinute] = parseTime(this._settings.get_string('deactivate-time'));
        const activateMinutes = timeToMinutes(activateHour, activateMinute);
        const deactivateMinutes = timeToMinutes(deactivateHour, deactivateMinute);
        
        return deactivateMinutes <= activateMinutes
            ? currentMinutes >= activateMinutes || currentMinutes < deactivateMinutes
            : currentMinutes >= activateMinutes && currentMinutes < deactivateMinutes;
    }

    _startAllTimers() {
        if (!this._isWithinActiveHours()) {
            console.log('Not within active hours - timers not started');
            return;
        }
        this._startValidTimers();
        console.log('All timers started');
    }

    _checkActiveHours() {
        if (!this._isWithinActiveHours()) {
            console.log('Outside active hours - stopping timers');
            this.stopAllTimers();
        } else {
            console.log('Within active hours - timers can run');
        }
    }

    _scheduleTimer(timeString, action, logPrefix) {
        const secondsUntil = Math.ceil(calculateTimeUntil(timeString) / 1000);
        console.log(`Scheduling ${logPrefix} in ${secondsUntil} seconds at ${timeString}`);
        
        return GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secondsUntil, () => {
            console.log(`${logPrefix} at ${timeString} triggered`);
            action();
            this._scheduleTimerActivation();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleTimerActivation() {
        [this._activationTimeOut, this._deactivationTimeOut].forEach(timeout => {
            if (timeout) GLib.Source.remove(timeout);
        });
        
        const activateTime = this._settings.get_string('activate-time');
        const deactivateTime = this._settings.get_string('deactivate-time');
        
        this._activationTimeOut = this._scheduleTimer(activateTime, () => {
            this._startAllTimers();
        }, 'Timer activation');
        
        this._deactivationTimeOut = this._scheduleTimer(deactivateTime, () => {
            this.stopAllTimers();
        }, 'Timer deactivation');
    }

    // Timer State Persistence
    _persistTimerState() {
        if (!this._activeTimers?.length) {
            this._settings.set_string('persisted-timer-state', '');
            return;
        }
        
        const now = new Date();
        const state = {
            disableTime: now.toISOString(),
            activeTimers: this._activeTimers.map(timer => ({
                timerIndex: timer.timerIndex,
                remainingMinutes: Math.ceil((timer.endTime - now) / 60000)
            }))
        };
        
        try {
            this._settings.set_string('persisted-timer-state', JSON.stringify(state));
            console.log('Timer state persisted:', state);
        } catch (e) {
            console.warn('Failed to persist timer state:', e);
        }
    }

    _tryRestoreTimerState() {
        const stateString = this._settings.get_string('persisted-timer-state');
        if (!stateString) return false;
        
        try {
            const state = JSON.parse(stateString);
            const disableTime = new Date(state.disableTime);
            const now = new Date();
            const pauseDurationMinutes = (now - disableTime) / 60000;
            
            // Clear state after reading
            this._settings.set_string('persisted-timer-state', '');
            
            // Check if pause was longer than 15 minutes
            if (pauseDurationMinutes > MAX_RESTORE_MINUTES) {
                console.log(`Pause too long (${Math.round(pauseDurationMinutes)} min) - discarding timer state`);
                return false;
            }
            
            // Clear existing timers before restoring
            this._activeTimers = [];
            
            // Restore timers with adjusted remaining time
            state.activeTimers.forEach(timerState => {
                const adjustedMinutes = Math.max(0, timerState.remainingMinutes - pauseDurationMinutes);
                
                if (adjustedMinutes > 0) {
                    const startTime = new Date(now.getTime() - (timerState.remainingMinutes - adjustedMinutes) * 60000);
                    this._activeTimers.push({
                        timerIndex: timerState.timerIndex,
                        startTime: startTime,
                        endTime: new Date(now.getTime() + adjustedMinutes * 60000),
                        notified: false
                    });
                }
            });
            
            console.log(`Restored ${this._activeTimers.length} timers after ${Math.round(pauseDurationMinutes)} min pause`);
            return this._activeTimers.length > 0;
            
        } catch (e) {
            console.warn('Failed to restore timer state:', e);
            this._settings.set_string('persisted-timer-state', '');
            return false;
        }
    }

    // Extension Lifecycle
    enable() {
        try {
            this._settings = this.getSettings();
            this._activeTimers = [];
            this._timerMenuItems = [];
            this._activeNotifications = new Map(); // Track active notifications by timer index
            
            this._createPanelUI();
            
            // Try to restore timer state from previous session first
            const restored = this._tryRestoreTimerState();
            
            // Update menu items, but skip timer start if we restored timers
            this._updateTimerMenuItems(restored);
            
            this._settingsConnection = this._settings.connect('changed::timers', () => this._updateTimerMenuItems());
            this._checkActiveHours();
            
            // Only start new timers if no state was restored AND we're within active hours
            if (!restored && this._isWithinActiveHours()) {
                this._startValidTimers();
            }
            
            this._setupTimeouts();
            this._scheduleTimerActivation();
        } catch (error) {
            console.error('Error enabling WorkDay Reminder extension:', error);
        }
    }

    _setupTimeouts() {
        this._repaintTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REPAINT_SECONDS, () => {
            this._icon?.queue_repaint();
            this._updateLabel();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._checkTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_TIMER_SECONDS, () => {
            this.check();
            this._checkActiveHours();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._updateMenuTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_MENU_SECONDS, () => {
            this._updateTimerMenuTexts();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        try {
            // Persist timer state before cleanup
            this._persistTimerState();
            
            [this._repaintTimeOut, this._checkTimeOut, this._updateMenuTimeOut, 
             this._activationTimeOut, this._deactivationTimeOut].forEach(timeout => {
                if (timeout) GLib.Source.remove(timeout);
            });
            
            if (this._settingsConnection && this._settings) {
                this._settings.disconnect(this._settingsConnection);
            }
            
            // Disconnect icon repaint signal
            if (this._iconConnection && this._icon) {
                this._icon.disconnect(this._iconConnection);
            }
            
            // Close all active notifications
            this._activeNotifications?.forEach((notification, timerIndex) => {
                console.log(`Closing notification for timer ${timerIndex} during disable`);
                try {
                    notification.destroy();
                } catch (e) {
                    console.log('Notification already destroyed during disable');
                }
            });
            this._activeNotifications?.clear();
            
            this._timerMenuItems?.forEach(item => {
                if (item && typeof item.destroy === 'function') {
                    item.destroy();
                }
            });
            
            if (this._indicator && typeof this._indicator.destroy === 'function') {
                this._indicator.destroy();
            }
            
            Object.assign(this, {
                _settings: null, _timers: null, _activeTimers: null, _icon: null, _label: null, _container: null, _indicator: null, _timerMenuItems: null, _settingsConnection: null, _iconConnection: null, _repaintTimeOut: null, _checkTimeOut: null, _updateMenuTimeOut: null, _activationTimeOut: null, _deactivationTimeOut: null, _activeNotifications: null
            });
        } catch (error) {
            console.error('Error disabling WorkDay Reminder extension:', error);
        }
    }

    // Timer Logic
    check() {
        if (!this._activeTimers || !Array.isArray(this._activeTimers)) {
            console.warn('Active timers array is invalid');
            this._activeTimers = [];
            return;
        }
        
        const currentTime = new Date();
        console.log(`Checking ${this._activeTimers.length} active timers at ${currentTime.toLocaleTimeString()}`);
        
        for (let i = this._activeTimers.length - 1; i >= 0; i--) {
            const activeTimer = this._activeTimers[i];
            
            if (!activeTimer || !activeTimer.endTime) {
                console.warn('Invalid active timer found, removing:', activeTimer);
                this._activeTimers.splice(i, 1);
                continue;
            }
            
            const timeRemaining = activeTimer.endTime - currentTime;
            console.log(`Timer ${activeTimer.timerIndex}: ${Math.round(timeRemaining/1000)}s remaining, notified: ${activeTimer.notified}`);
            
            if (activeTimer.endTime <= currentTime && !activeTimer.notified) {
                console.log(`Timer ${activeTimer.timerIndex} has finished! Showing notification.`);
                if (this._isValidTimerIndex(activeTimer.timerIndex)) {
                    // Remove timer from active list BEFORE showing notification
                    this._activeTimers.splice(i, 1);
                    this._showNotification(activeTimer);
                } else {
                    console.warn(`Invalid timer index: ${activeTimer.timerIndex}`);
                    this._activeTimers.splice(i, 1);
                }
            }
        }
    }

    _isValidTimerIndex = (index) => this._timers && index >= 0 && index < this._timers.length;

    _showNotification(activeTimer) {
        const timer = this._timers[activeTimer.timerIndex];
        console.log(`Notification for timer ${activeTimer.timerIndex}: ${timer.name}`);
        
        try {
            // Create a source for the notification
            const source = new MessageTray.Source({
                title: 'Workday Reminder',
                iconName: 'alarm-symbolic'
            });
            
            // Add the source to the message tray
            Main.messageTray.add(source);

            // Create the notification
            const notification = new MessageTray.Notification({
                source: source,
                title: `${timer.name} Reminder`,
                body: timer.message || `Time for your ${timer.name} break!`,
                urgency: MessageTray.Urgency.CRITICAL
            });
            
            // Store the notification for this timer
            this._activeNotifications.set(activeTimer.timerIndex, notification);
            
            // Flag to prevent race conditions between button clicks and destroy events
            let handlerExecuted = false;
            
            // Helper function to reset timer
            const resetTimer = (minutes) => () => {
                if (handlerExecuted) return;
                handlerExecuted = true;
                console.log(`Resetting timer ${activeTimer.timerIndex} for ${minutes} minutes`);
                this.addNewTimer(activeTimer.timerIndex, minutes);
            };
            
            const acceptAction = resetTimer(timer.timeBetweenNotifications);
            const declineAction = resetTimer(timer.extraTime || timer.timeBetweenNotifications);
            
            // Add action buttons
            if (timer.successButtonText) {
                notification.addAction(timer.successButtonText, acceptAction);
            }
            notification.addAction('Wait a bit', declineAction);
            
            // Handle notification events
            notification.connect('destroy', (notification, reason) => {
                // Always clean up our reference first
                this._activeNotifications.delete(activeTimer.timerIndex);
                
                // Only auto-reset if no button was clicked and notification was dismissed/expired
                // Also make sure we don't process if notification was destroyed by button click
                if (!handlerExecuted && 
                    (reason === MessageTray.NotificationDestroyedReason.DISMISSED || 
                     reason === MessageTray.NotificationDestroyedReason.EXPIRED)) {
                    handlerExecuted = true;
                    console.log(`Notification dismissed - resetting timer ${activeTimer.timerIndex}`);
                    // Use timeout to avoid race conditions with system cleanup
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
                        this.addNewTimer(activeTimer.timerIndex, timer.extraTime || timer.timeBetweenNotifications);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
            notification.connect('activated', () => {
                if (!handlerExecuted) {
                    declineAction();
                }
            });

            // Show the notification
            source.addNotification(notification);
            
        } catch (error) {
            console.error('Error showing notification:', error);
            // Fallback: use simple Main.notify
            Main.notify('Workday Reminder', `${timer.name} - ${timer.message || 'Time for a break!'}`);
            
            // Still reset the timer
            const resetTime = timer.extraTime || timer.timeBetweenNotifications;
            console.log(`Fallback: resetting timer ${activeTimer.timerIndex} for ${resetTime} minutes`);
            this.addNewTimer(activeTimer.timerIndex, resetTime);
        }
        
        activeTimer.notified = true;
        
        // Immediately refresh the panel UI when notification is shown
        this._updateLabel();
        this._icon?.queue_repaint();
        this._updateTimerMenuTexts();
    }

    addNewTimer(timerIndex, minutes) {
        if (typeof timerIndex !== 'number' || typeof minutes !== 'number' || !this._isValidTimerIndex(timerIndex)) {
            console.warn('Invalid timer parameters:', { timerIndex, minutes });
            return;
        }
        
        // Close any active notification for this timer
        const activeNotification = this._activeNotifications.get(timerIndex);
        if (activeNotification) {
            console.log(`Closing notification for timer ${timerIndex}`);
            this._activeNotifications.delete(timerIndex);
            // Don't try to destroy notification that might already be destroyed by the system
        }
        
        const now = new Date();
        this._activeTimers = this._activeTimers.filter(timer => timer.timerIndex !== timerIndex);
        this._activeTimers.push({
            timerIndex, startTime: now, endTime: new Date(now.getTime() + minutes * 60000), notified: false
        });
        
        this._updateLabel();
        this._updateTimerMenuTexts();
    }

    calculatePercentageDone() {
        const nextTimer = this._getNextTimer();
        if (!nextTimer) return 0;
        const now = new Date();
        const progress = (now - nextTimer.startTime) / (nextTimer.endTime - nextTimer.startTime);
        return Math.min(0.999, progress);
    }

    getCurrentTimerName() {
        const nextTimer = this._getNextTimer();
        if (!nextTimer || !this._isValidTimerIndex(nextTimer.timerIndex)) {
            return nextTimer ? 'Unknown' : 'No Timer';
        }
        return this._timers[nextTimer.timerIndex].name || 'Timer';
    }

    getRemainingTimeForTimer(timerIndex) {
        const activeTimer = this._activeTimers?.find(timer => timer.timerIndex === timerIndex && !timer.notified);
        if (!activeTimer) return null;
        const remainingMs = activeTimer.endTime - new Date();
        return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 60000);
    }

    stopAllTimers() {
        // Close all active notifications
        this._activeNotifications.forEach((notification, timerIndex) => {
            console.log(`Closing notification for timer ${timerIndex}`);
            try {
                notification.destroy();
            } catch (e) {
                console.log('Notification already destroyed');
            }
        });
        this._activeNotifications.clear();
        
        this._activeTimers = [];
        this._updateLabel();
        this._icon?.queue_repaint();
        this._updateTimerMenuTexts();
        console.log('All timers stopped');
    }

    openPreferences() {
        try { super.openPreferences(); } 
        catch (e) { console.warn('Failed to open preferences:', e); }
    }
}

