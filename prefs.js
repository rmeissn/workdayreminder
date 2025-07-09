import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class ExamplePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._timers = this._loadTimers();
        
        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // Timers group
        this._timersGroup = new Adw.PreferencesGroup({
            title: 'Timers',
            description: 'Manage multiple timers with individual settings',
        });
        page.add(this._timersGroup);

        // Add button row
        this._addButtonRow = new Adw.ActionRow({
            title: 'Add new timer',
            subtitle: 'Create a new timer with custom settings',
        });
        
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        addButton.connect('clicked', () => this._addNewTimer());
        this._addButtonRow.add_suffix(addButton);
        
        this._timersGroup.add(this._addButtonRow);

        // Keep track of timer rows for easier removal
        this._timerRows = [];

        // Load and display existing timers
        this._refreshTimersList();
    }

    _loadTimers() {
        try {
            const timersJson = this._settings.get_string('timers');
            const timers = JSON.parse(timersJson);
            // Ensure we have at least one timer
            if (!timers || timers.length === 0) {
                return [{"name": "Timer 1", "timeBetweenNotifications": 20, "extraTime": 5, "message": "Time for a break!", "successButtonText": "Got it"}];
            }
            return timers;
        } catch (e) {
            console.warn('Failed to load timers:', e);
            return [{"name": "Timer 1", "timeBetweenNotifications": 20, "extraTime": 5, "message": "Time for a break!", "successButtonText": "Got it"}];
        }
    }

    _saveTimers() {
        const timersJson = JSON.stringify(this._timers);
        console.log('Saving timers JSON:', timersJson);
        this._settings.set_string('timers', timersJson);
    }

    _addNewTimer() {
        console.log('Before adding timer - current timers:', JSON.stringify(this._timers));
        
        // Find the highest timer number to avoid duplicates
        let maxTimerNumber = 0;
        this._timers.forEach(timer => {
            const match = timer.name.match(/Timer (\d+)/);
            if (match) {
                const timerNumber = parseInt(match[1]);
                maxTimerNumber = Math.max(maxTimerNumber, timerNumber);
            }
        });
        
        const newTimerNumber = maxTimerNumber + 1;
        const newTimer = {
            name: `Timer ${newTimerNumber}`,
            timeBetweenNotifications: 20,
            extraTime: 5,
            message: "Time for a break!",
            successButtonText: "Got it"
        };
        
        this._timers.push(newTimer);
        console.log('After adding timer - current timers:', JSON.stringify(this._timers));
        this._saveTimers();
        this._refreshTimersList();
    }

    _removeTimer(index) {
        if (this._timers.length > 1) { // Keep at least one timer
            this._timers.splice(index, 1);
            this._saveTimers();
            this._refreshTimersList();
        }
    }

    _updateTimer(index, property, value) {
        if (this._timers[index]) {
            this._timers[index][property] = value;
            this._saveTimers();
        }
    }

    _refreshTimersList() {
        console.log('Refreshing timers list - current timers:', JSON.stringify(this._timers));
        
        // Remove all existing timer rows
        this._timerRows.forEach(row => {
            this._timersGroup.remove(row);
        });
        this._timerRows = [];

        // Add timer rows
        this._timers.forEach((timer, index) => {
            this._createTimerRow(timer, index);
        });
    }

    _createTimerRow(timer, index) {
        // Timer name row
        const nameRow = new Adw.EntryRow({
            title: `Timer ${index + 1}`,
            text: timer.name,
        });
        nameRow.connect('changed', () => {
            this._updateTimer(index, 'name', nameRow.get_text());
        });

        // Delete button for the name row (only show if more than one timer exists)
        if (this._timers.length > 1) {
            const deleteButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action'],
            });
            deleteButton.connect('clicked', () => this._removeTimer(index));
            nameRow.add_suffix(deleteButton);
        }

        this._timersGroup.add(nameRow);
        this._timerRows.push(nameRow);

        // Time between notifications row
        const breakTimeRow = Adw.SpinRow.new_with_range(1, 1440, 1);
        breakTimeRow.title = 'Time between Notifications';
        breakTimeRow.subtitle = 'How often to notify you (in minutes)';
        breakTimeRow.value = timer.timeBetweenNotifications;
        breakTimeRow.connect('changed', () => {
            this._updateTimer(index, 'timeBetweenNotifications', breakTimeRow.get_value());
        });
        this._timersGroup.add(breakTimeRow);
        this._timerRows.push(breakTimeRow);

        // Extra time row
        const extraTimeRow = Adw.SpinRow.new_with_range(1, 1440, 1);
        extraTimeRow.title = 'Time to add when postponing';
        extraTimeRow.subtitle = 'How much time to wait after postponing the notification (in minutes)';
        extraTimeRow.value = timer.extraTime;
        extraTimeRow.connect('changed', () => {
            this._updateTimer(index, 'extraTime', extraTimeRow.get_value());
        });
        this._timersGroup.add(extraTimeRow);
        this._timerRows.push(extraTimeRow);

        // Message row
        const messageRow = new Adw.EntryRow({
            title: 'Notification Message',
            text: timer.message || 'Time for a break!',
        });
        messageRow.connect('changed', () => {
            this._updateTimer(index, 'message', messageRow.get_text());
        });
        this._timersGroup.add(messageRow);
        this._timerRows.push(messageRow);

        // Success button text row
        const successButtonRow = new Adw.EntryRow({
            title: 'Success Button Text',
            text: timer.successButtonText || 'Got it',
        });
        successButtonRow.connect('changed', () => {
            this._updateTimer(index, 'successButtonText', successButtonRow.get_text());
        });
        this._timersGroup.add(successButtonRow);
        this._timerRows.push(successButtonRow);
    }
}