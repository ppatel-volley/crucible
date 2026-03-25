import type { HelloWeekendState } from "@hello-weekend/shared"

export function createRuleset(state: HelloWeekendState): void {
    console.log("Hello Weekend game phase:", state.phase)
}
