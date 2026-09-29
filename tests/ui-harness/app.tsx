import React from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "../../apps/web/app/providers";
import { AppShell } from "../../apps/web/components/app-shell";
import Today from "../../apps/web/app/(app)/now/page";
import Inbox from "../../apps/web/app/(app)/backlog/page";
import { WeeklyReviewPanel } from "../../apps/web/components/weekly-review-panel";
const screen = window.location.pathname;
createRoot(document.getElementById("root")!).render(
  <Providers>
    <AppShell>
      {screen === "/backlog" ? (
        <Inbox />
      ) : screen === "/review" ? (
        <WeeklyReviewPanel />
      ) : (
        <Today />
      )}
    </AppShell>
  </Providers>,
);
