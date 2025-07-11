This is a gnome-shell extension that allows to prepare several user-specified timers. Upon timer expiration, a persistant notification is shown that requires user interaction to either postpone the timer or reset it. A tray menu shows the next timer that expires and allows to reset individual timers, as well as to stop all timers. The extension respects (user specified) working hours (within: timers active, outside: timers stopped) and screen lock/suspend behaviour by either storing and reviving timers or resetting them.

This extension targets the gnome-shell versions specified in the metadata.json. It's written in modern Javascript and a typical extension anatomy is detailed in: https://gjs.guide/extensions/overview/anatomy.html

Here's a very brief overview:

- metadata.json is a required file of every extension. It contains basic information about the extension such as its UUID, name and description.
- extension.js is a required file of every extension. It must export a subclass of the base Extension and implement the enable() and disable() methods. If your subclass overrides the constructor() method, it must also call super() and pass the metadata argument to the parent class.
- prefs.js is used to build the preferences for an extensions. If this file is not present, there will simply be no preferences button in GNOME Extensions.
- schemes is a folder that contains one to many schema definitions, used to store extension data permanently.

You can find a lot of information on specific extension topics on the https://gjs.guide/extensions/ website, listed under topics

It's important to compley with the Review Guidelines found on https://gjs.guide/extensions/review-guidelines/review-guidelines.html in order to have the extension accepted by upstream.

Do not summerize your findings in the end of your answer, unless asked for.
