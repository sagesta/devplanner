# DevPlanner User Guide

Welcome to DevPlanner! This guide is designed to help you integrate DevPlanner into your workflow, maximizing productivity while protecting your dynamic cognitive capacity.

Whether you prefer manual micromanagement or relying on the AI Assistant to intelligently organize your day, DevPlanner adapts to your unique rhythm.

---

## 📅 Daily Workflow: The "Now" Focus

The goal of your daily usage is *execution*. Avoid cluttering your day with endless backlogs.

### 1. Board Alignment (Morning Review)
- Open the **Board** view (`/board`).
- Look at the `Todo` column. Decide what 1-3 tasks are absolutely vital for today.
- Drag them into the `In Progress` column. 

### 2. Capacity Protection (The "Now" Engine)
- Navigate to the **Now** view (`/now`). This is your dashboard for the day.
- **Subtasks as Checkpoints**: Break your large tasks down. DevPlanner uses subtasks as the primary units of work. If a task says "Ship Feature X", create subtasks like "Write schema" (30m) and "Implement API" (45m). Click on the subtasks as you execute them.
- **The Overhead Bar**: Watch your `Daily Capacity` bar at the top of the `Now` view. This intelligently computes your cognitive load. If you exceed your limit (e.g., `180 / 153 mins`), you will see an **OVERLOAD** warning.

### 3. AI Balancing (Optional but Recommended)
- When Overloaded, click the **Auto-Schedule** button natively, or open the **AI Chat Dock**.
- Tell the AI: *“I'm overloaded today. Push my lowest priority items to tomorrow.”*
- The AI will securely displace any tasks that are not marked as `Urgent` (P0) or `In Progress`, keeping your current day perfectly achievable.

---

## 📆 Weekly Workflow: Sprints & Structuring

The weekly workflow is about chunking your backlog into achievable segments.

### 1. Sprint Planning
- Open the **Sprints** view (`/sprints`) and create a new Sprint (e.g., "Week of April 15").
- Define a clear **Goal** for the week.
- Navigate to your **Backlog** (`/backlog`). 

### 2. Brain Dump
- Open the **Brain dump** modal on the bottom left of your sidebar. Rapid-fire text into the box for every thought you have (e.g., "Fix database schema", "Renew domain", "Email client").
- These will instantly populate into your backlog.
- Transfer these items from the Backlog into your newly active Sprint.

---

## 🗺️ Monthly Workflow: Review & Insights

The monthly workflow relies on reflection and recalibration.

### 1. Analytics & Heatmap
- Open the **Insights** view (`/insights`).
- The **Daily Activity Heatmap** tracks when you naturally mark subtasks and tasks as completed.
- *Without AI*: Review your own heatmap peaks. If your peak completion time is consistently 2 PM, mentally structure your deepest work around that hour.
- *With AI*: The AI reads this data contextually. If you ask the AI to "Plan my day", it will automatically attempt to map your heavy "Deep Work" subtasks exactly to your biological peak hours based on this graph.

### 2. The Timeline Retrospective
- Open the **Timeline** view (`/timeline`). Scroll back through the last 30 days.
- Look for gaps, missed deadlines, or tasks that continuously bled over into the next day.
- Use the **Review** (`/review`) tool to formally process what failed to ship this month and roll it over into your next Sprint effortlessly.

---

## 🤖 The AI Assistant: Your Pair Planner

The AI chat dock is powered securely by a RAG (Retrieval-Augmented Generation) memory engine, leveraging models like `gpt-5-nano`. 

### Without AI:
You never have to touch the dock. You can drag and drop your tasks manually in the `/board`, assign priorities using standard dropdowns, and create unlimited nested subtasks inside the task detail panels.

### With AI:
The dock acts as a macro-executor.
- **Context Pinning**: Type `@` in the chat to mention specific tasks. 
- **Subtask Generation**: Instead of typing 5 subtasks out manually, pin the task and type: *"Break this down into 3 subtasks."* The AI will format standard time-estimated steps and attach them seamlessly.
- **Bulk Refactoring**: Go to the **Table** (`/table`) view. Open the chat dock and say, *"Take all tasks marked as Todo and bump their due date to tomorrow."* The AI will natively execute bulk migrations on your behalf.
