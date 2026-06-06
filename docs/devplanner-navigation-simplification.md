# DevPlanner Navigation Simplification

## New Top-Level Rooms

The app should feel like six rooms:

- Today: daily execution cockpit.
- Inbox: capture and triage buffer.
- Plan: sprint commitment, board status, timeline scheduling, and table cleanup.
- Review: weekly reflection plus progress/rollover insights.
- Goals: longer-horizon direction.
- Settings: configuration only.

## Why This Is Better

The previous navigation exposed several task-management views as separate pages:

- Sprints
- Board
- Timeline
- Table
- Insights

Those are useful, but they are not separate mental jobs. Sprints, Board, Timeline, and Table all belong to planning. Insights belongs with review because it closes the loop after execution.

## Compatibility

The old routes remain available so existing links do not break. The main sidebar and mobile nav now point users to the grouped rooms.

## Current Grouping

- `/plan?view=sprints`
- `/plan?view=board`
- `/plan?view=timeline`
- `/plan?view=table`
- `/review?view=weekly`
- `/review?view=progress`
