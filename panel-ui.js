import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { repaint } from './utils.js';

/**
 * Manages the panel UI including the indicator, icon, label, and menu
 */
export class PanelUI {
    constructor(extension, timerManager) {
        this._extension = extension;
        this._timerManager = timerManager;
        this._indicator = null;
        this._container = null;
        this._icon = null;
        this._iconConnection = null;
        this._label = null;
        this._timerMenuItems = [];
    }

    /**
     * Create and setup the panel UI
     */
    createPanelUI() {
        this._indicator = new PanelMenu.Button(0.0, this._extension.metadata.name, false);
        this._container = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._icon = new St.DrawingArea({ width: 25, height: 25 });
        this._iconConnection = this._icon.connect('repaint', (area) => 
            repaint(area, this._timerManager.calculateProgress()));
        this._label = new St.Label({ 
            text: 'No Timer', 
            style_class: 'panel-button', 
            y_align: 2 
        });
        
        this._container.add_child(this._icon);
        this._container.add_child(this._label);
        this._indicator.add_child(this._container);
        Main.panel.addToStatusArea(this._extension.uuid, this._indicator);
    }

    /**
     * Update the timer menu items
     */
    updateTimerMenuItems(skipTimerStart = false) {
        // Remove all existing menu items
        this._indicator?.menu.removeAll();
        this._timerMenuItems = [];
        
        // Load fresh timer configurations
        this._timerManager.loadTimerConfigs();
        
        // Only reset active timers if we're not already running any and not explicitly skipping
        if (!skipTimerStart && this._timerManager.getActiveTimers().length === 0) {
            // Let extension handle timer starting based on active hours
        }
        
        this.updateLabel();
        this._createMenuItems();
    }

    /**
     * Create menu items for each timer
     */
    _createMenuItems() {
        const timerConfigs = this._timerManager.getTimerConfigs();
        if (!timerConfigs?.length || !this._indicator?.menu) return;

        timerConfigs.forEach((timer, index) => {
            if (timer?.name && this._timerManager.isValidTimer(timer)) {
                this._timerMenuItems.push(this._indicator.menu.addAction(
                    this._getTimerMenuText(timer.name, index), 
                    () => this._timerManager.addTimer(index, timer.timeBetweenNotifications)
                ));
            }
        });
        
        if (timerConfigs.length > 0) {
            this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._indicator.menu.addAction('Stop All Timers', () => this._timerManager.stopAllTimers());
        }
        
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._indicator.menu.addAction('Preferences', () => this._extension.openPreferences());
    }

    /**
     * Get formatted text for timer menu item
     */
    _getTimerMenuText(timerName, timerIndex) {
        const remainingTime = this._timerManager.getRemainingTimeForTimer(timerIndex);
        return `Reset ${timerName} Timer${remainingTime === null ? '' : ` [${remainingTime} min]`}`;
    }

    /**
     * Update the text of existing timer menu items
     */
    updateTimerMenuTexts() {
        const timerConfigs = this._timerManager.getTimerConfigs();
        if (!this._timerMenuItems || !timerConfigs) return;
        
        this._timerMenuItems.forEach((menuItem, index) => {
            if (menuItem && timerConfigs[index]?.name) {
                menuItem.label.set_text(this._getTimerMenuText(timerConfigs[index].name, index));
            }
        });
    }

    /**
     * Update the panel label
     */
    updateLabel() {
        const timerName = this._timerManager.getCurrentTimerName();
        this._label?.set_text(timerName);
    }

    /**
     * Queue icon repaint
     */
    updateIcon() {
        this._icon?.queue_repaint();
    }

    /**
     * Get the indicator for external access
     */
    getIndicator() {
        return this._indicator;
    }

    /**
     * Destroy panel UI
     */
    destroy() {
        // Disconnect icon repaint signal
        if (this._iconConnection && this._icon) {
            this._icon.disconnect(this._iconConnection);
            this._iconConnection = null;
        }
        
        // Destroy menu items
        this._timerMenuItems?.forEach(item => {
            if (item && typeof item.destroy === 'function') {
                item.destroy();
            }
        });
        this._timerMenuItems = [];
        
        // Destroy indicator
        if (this._indicator && typeof this._indicator.destroy === 'function') {
            this._indicator.destroy();
        }
        
        // Clear references
        this._indicator = null;
        this._container = null;
        this._icon = null;
        this._label = null;
        this._extension = null;
        this._timerManager = null;
    }
}
