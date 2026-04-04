import { TimelineBoard } from "@/components/timeline-board";

export default function TimelinePage() {
  return (
    <div>
      <h1 className="font-display text-2xl text-foreground">Timeline</h1>
      <p className="mt-1 text-sm text-muted">
        Three-week horizon. Drag bars to reschedule; drop unscheduled tasks on a date. Priority colors match the board.
      </p>
      <div className="mt-6">
        <TimelineBoard />
      </div>
    </div>
  );
}
