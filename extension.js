import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const REPAINT_SECONDS = 10;
const CHECK_TIMER_SECONDS = 10;
const UPDATE_MENU_SECONDS = 30;

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
        this._icon.connect('repaint', (area) => repaint(area, this.calculatePercentageDone()));
        this._label = new St.Label({ text: 'No Timer', style_class: 'panel-button', y_align: 2 });
        
        this._container.add_child(this._icon);
        this._container.add_child(this._label);
        this._indicator.add_child(this._container);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _updateTimerMenuItems() {
        // Remove all existing menu items
        this._indicator?.menu.removeAll();
        this._timerMenuItems = [];
        this._timers = this._loadTimers();
        
        // Only reset active timers if we're not already running any
        if (!this._activeTimers || this._activeTimers.length === 0) {
            this._activeTimers = [];
            this._startValidTimers();
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

    _checkForMissedActivation() {
        const now = new Date();
        const lastActivationKey = 'last-activation-date';
        
        try {
            const lastActivationString = this._settings.get_string(lastActivationKey);
            const lastActivationDate = lastActivationString ? new Date(lastActivationString) : null;
            const [activateHour, activateMinute] = parseTime(this._settings.get_string('activate-time'));
            const todayActivation = new Date(now);
            todayActivation.setHours(activateHour, activateMinute, 0, 0);
            
            if (now >= todayActivation && (!lastActivationDate || lastActivationDate < todayActivation) && this._isWithinActiveHours()) {
                console.log('Missed activation detected - performing activation now');
                this.stopAllTimers();
                this._startAllTimers();
                this._settings.set_string(lastActivationKey, now.toISOString());
            }
        } catch (e) {
            console.warn('Error checking for missed activation:', e);
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
            this.stopAllTimers();
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._startAllTimers();
                this._settings.set_string('last-activation-date', new Date().toISOString());
                return GLib.SOURCE_REMOVE;
            });
        }, 'Timer activation');
        
        this._deactivationTimeOut = this._scheduleTimer(deactivateTime, () => {
            this.stopAllTimers();
            this._settings.set_string('last-deactivation-date', new Date().toISOString());
        }, 'Timer deactivation');
    }

    // Extension Lifecycle
    enable() {
        try {
            this._settings = this.getSettings();
            this._activeTimers = [];
            this._timerMenuItems = [];
            
            this._createPanelUI();
            this._updateTimerMenuItems();
            
            this._settingsConnection = this._settings.connect('changed::timers', () => this._updateTimerMenuItems());
            this._checkForMissedActivation();
            
            // Only start timers if we don't have any active ones yet
            if (!this._activeTimers || this._activeTimers.length === 0) {
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
            this._checkForMissedActivation();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._updateMenuTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_MENU_SECONDS, () => {
            this._updateTimerMenuTexts();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        try {
            [this._repaintTimeOut, this._checkTimeOut, this._updateMenuTimeOut, 
             this._activationTimeOut, this._deactivationTimeOut].forEach(timeout => {
                if (timeout) GLib.Source.remove(timeout);
            });
            
            if (this._settingsConnection && this._settings) {
                this._settings.disconnect(this._settingsConnection);
            }
            
            this._timerMenuItems?.forEach(item => {
                if (item && typeof item.destroy === 'function') {
                    item.destroy();
                }
            });
            
            if (this._indicator && typeof this._indicator.destroy === 'function') {
                this._indicator.destroy();
            }
            
            Object.assign(this, {
                _settings: null, _timers: null, _activeTimers: null, _icon: null, _label: null, 
                _container: null, _indicator: null, _timerMenuItems: null, _settingsConnection: null,
                _repaintTimeOut: null, _checkTimeOut: null, _updateMenuTimeOut: null,
                _activationTimeOut: null, _deactivationTimeOut: null
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
        
        for (let i = this._activeTimers.length - 1; i >= 0; i--) {
            const activeTimer = this._activeTimers[i];
            
            if (!activeTimer || !activeTimer.endTime) {
                console.warn('Invalid active timer found, removing:', activeTimer);
                this._activeTimers.splice(i, 1);
                continue;
            }
            
            if (activeTimer.endTime < currentTime && !activeTimer.notified) {
                if (this._isValidTimerIndex(activeTimer.timerIndex)) {
                    this._showNotification(activeTimer);
                } else {
                    console.warn(`Invalid timer index: ${activeTimer.timerIndex}`);
                }
                this._activeTimers.splice(i, 1);
            }
        }
    }

    _isValidTimerIndex = (index) => this._timers && index >= 0 && index < this._timers.length;

    _showNotification(activeTimer) {
        const timer = this._timers[activeTimer.timerIndex];
        console.log(`Notification for timer ${activeTimer.timerIndex}: ${timer.name}`);
        
        const source = new MessageTray.Source({
            title: 'Workday Reminder',
            icon_name: 'alarm-symbolic'
        });
        Main.messageTray.add(source);

        const notification = new MessageTray.Notification({
            source,
            title: `${timer.name} Reminder`,
            body: timer.message,
            urgency: MessageTray.Urgency.CRITICAL,
        });
        
        const resetTimer = (minutes) => () => this.addNewTimer(activeTimer.timerIndex, minutes);
        const acceptAction = resetTimer(timer.timeBetweenNotifications);
        const declineAction = resetTimer(timer.extraTime);
        
        notification.connect('dismissed', declineAction);
        notification.connect('activated', declineAction);
        notification.addAction(timer.successButtonText, acceptAction);
        notification.addAction('Wait a bit', declineAction);

        source.addNotification(notification);
        activeTimer.notified = true;
    }

    addNewTimer(timerIndex, minutes) {
        if (typeof timerIndex !== 'number' || typeof minutes !== 'number' || !this._isValidTimerIndex(timerIndex)) {
            console.warn('Invalid timer parameters:', { timerIndex, minutes });
            return;
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
        const activeTimer = this._activeTimers?.find(timer => timer.timerIndex === timerIndex);
        if (!activeTimer) return null;
        const remainingMs = activeTimer.endTime - new Date();
        return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 60000);
    }

    stopAllTimers() {
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

