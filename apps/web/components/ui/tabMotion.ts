// The motion every pane-top tab bar shares: underline slide, attached region
// open, tray translate and label FLIP all run on this duration and curve, so a
// tab change reads as one gesture. TAB_MOTION is kept as a full literal so
// Tailwind's class scanner sees it; the other two are for inline styles and
// WAAPI.

export const TAB_MOTION_MS = 300

export const TAB_MOTION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export const TAB_MOTION = 'duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]'
