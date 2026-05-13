/** Client-only planner preferences (stress-test-fix: energy + AI + focus). */

export const LS_PHYSICAL_ENERGY = "devplanner.currentPhysicalEnergy";
/** Same key as the floating AI dock model picker */
export const LS_CHAT_MODEL = "devplanner.chatModel";
export const LS_AI_BUDGET = "devplanner.aiEnforceDailyBudget";
export const LS_AI_ENERGY_SUGGEST = "devplanner.aiEnergyAwareSuggestions";
export const LS_POMO_WORK = "devplanner.pomodoroWorkMin";
export const LS_POMO_SHORT = "devplanner.pomodoroShortMin";
export const LS_POMO_LONG = "devplanner.pomodoroLongMin";
export const LS_FOCUS_MODE = "devplanner.focusModeDefault";

export type PhysicalEnergyLevel = "low" | "medium" | "high";
