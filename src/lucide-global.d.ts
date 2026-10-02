/**
 * Ambient declaration for the global lucide object installed by core/ui.ts,
 * so any module can call lucide.createIcons() without importing it. */

// The app treats window.lucide as a global (set up in core/ui.ts).
// Declared ambient so every module can call lucide.createIcons() without an import.
declare const lucide: {
    createIcons: (options?: any) => void;
};
