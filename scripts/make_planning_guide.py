# -*- coding: utf-8 -*-
"""Generate docs/DevPlanner-Beginners-Planning-Guide.pdf.

A plain-language guide: how to turn any goal (exams, work, life) into
months -> weeks -> days inside DevPlanner. Run: python scripts/make_planning_guide.py
"""
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

TEAL = colors.HexColor("#01696F")
TEAL_DARK = colors.HexColor("#014A4F")
TEAL_LIGHT = colors.HexColor("#E0F2F1")
INK = colors.HexColor("#1A2327")
MUTED = colors.HexColor("#5B6B70")
PAPER = colors.HexColor("#FFFFFF")
SAND = colors.HexColor("#FFF7E8")
SAND_EDGE = colors.HexColor("#F0B429")
ROW_ALT = colors.HexColor("#F4F8F8")
LINE = colors.HexColor("#D8E2E2")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "DevPlanner-Beginners-Planning-Guide.pdf")

# ── Styles ───────────────────────────────────────────────────────────
ss = getSampleStyleSheet()

def st(name, **kw):
    base = kw.pop("base", "Normal")
    s = ParagraphStyle(name, parent=ss[base], **kw)
    return s

S = {
    "cover_title": st("cover_title", fontName="Helvetica-Bold", fontSize=30, leading=36, textColor=PAPER, alignment=TA_LEFT),
    "cover_sub": st("cover_sub", fontName="Helvetica", fontSize=13, leading=19, textColor=colors.HexColor("#CFE9E8"), alignment=TA_LEFT),
    "cover_small": st("cover_small", fontName="Helvetica", fontSize=9.5, leading=14, textColor=colors.HexColor("#9FCCCB")),
    "h1": st("h1", fontName="Helvetica-Bold", fontSize=19, leading=24, textColor=TEAL_DARK, spaceBefore=2, spaceAfter=6),
    "h2": st("h2", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=TEAL_DARK, spaceBefore=10, spaceAfter=4),
    "body": st("body", fontName="Helvetica", fontSize=10.5, leading=15.5, textColor=INK, spaceAfter=6),
    "body_tight": st("body_tight", fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK, spaceAfter=2),
    "lead": st("lead", fontName="Helvetica", fontSize=12, leading=17.5, textColor=INK, spaceAfter=8),
    "bullet": st("bullet", fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK, leftIndent=14, bulletIndent=4, spaceAfter=3),
    "num": st("num", fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK, leftIndent=18, bulletIndent=4, spaceAfter=4, bulletFontName="Helvetica-Bold"),
    "small": st("small", fontName="Helvetica", fontSize=9, leading=13, textColor=MUTED),
    "callout": st("callout", fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK),
    "callout_title": st("callout_title", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=TEAL_DARK),
    "tbl_head": st("tbl_head", fontName="Helvetica-Bold", fontSize=9.5, leading=12.5, textColor=PAPER),
    "tbl_cell": st("tbl_cell", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK),
    "tbl_cell_b": st("tbl_cell_b", fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=TEAL_DARK),
    "quote": st("quote", fontName="Helvetica-Oblique", fontSize=11, leading=16, textColor=TEAL_DARK),
}

CONTENT_W = PAGE_W - 2 * MARGIN


def bullets(items, style="bullet", char="•"):
    return [Paragraph(t, S[style], bulletText=char) for t in items]


def numbered(items):
    # bulletText is plain text (no XML markup) — bold comes from bulletFontName.
    return [Paragraph(t, S["num"], bulletText=f"{i}.") for i, t in enumerate(items, 1)]


def callout(title, text, fill=TEAL_LIGHT, edge=TEAL):
    rows = []
    if title:
        rows.append([Paragraph(title, S["callout_title"])])
    rows.append([Paragraph(text, S["callout"])])
    t = Table(rows, colWidths=[CONTENT_W - 8])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
        ("TOPPADDING", (0, -1), (-1, -1), 2 if title else 8),
    ]))
    return t


def data_table(head, rows, widths, bold_first_col=False):
    data = [[Paragraph(h, S["tbl_head"]) for h in head]]
    for r in rows:
        cells = []
        for i, c in enumerate(r):
            sty = "tbl_cell_b" if (bold_first_col and i == 0) else "tbl_cell"
            cells.append(Paragraph(c, S[sty]))
        data.append(cells)
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
    ]
    for i in range(1, len(rows) + 1):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(style))
    return t


# ── Diagrams ─────────────────────────────────────────────────────────
class LadderDiagram(Flowable):
    """GOAL -> MONTH -> WEEK -> TODAY -> NOW breakdown ladder."""

    STEPS = [
        ("GOAL", "One sentence with a date", '"Pass my biology exam on 24 July"'),
        ("MONTHS", "2-5 big milestones", '"Finish all 12 topics" / "Past papers done"'),
        ("WEEKS", "A sprint: 5-15 tasks", '"This week: topics 1 and 2"'),
        ("TODAY", "Pick 3-7 tasks", '"Read ch. 1" / "Make 20 flashcards"'),
        ("NOW", "One task, timer on", '"Read ch. 1 (25 min)"'),
    ]

    def __init__(self, width, on_cover=False):
        super().__init__()
        self.width = width
        self.on_cover = on_cover
        self.row_h = 13 * mm
        self.gap = 5.2 * mm
        self.height = len(self.STEPS) * self.row_h + (len(self.STEPS) - 1) * self.gap

    def draw(self):
        c = self.canv
        x0 = 0
        box_w = 34 * mm
        y = self.height - self.row_h
        label_col = PAPER
        if self.on_cover:
            box_fill, box_edge = colors.HexColor("#0E8A90"), colors.HexColor("#7BD1CF")
            txt_main, txt_sub = PAPER, colors.HexColor("#CFE9E8")
            arrow = colors.HexColor("#7BD1CF")
        else:
            box_fill, box_edge = TEAL, TEAL_DARK
            txt_main, txt_sub = INK, MUTED
            arrow = TEAL
        for i, (label, what, example) in enumerate(self.STEPS):
            # label box
            c.setFillColor(box_fill)
            c.setStrokeColor(box_edge)
            c.setLineWidth(1)
            c.roundRect(x0, y, box_w, self.row_h, 2.5 * mm, stroke=1, fill=1)
            c.setFillColor(label_col)
            c.setFont("Helvetica-Bold", 11)
            c.drawCentredString(x0 + box_w / 2, y + self.row_h / 2 - 3.5, label)
            # texts
            tx = x0 + box_w + 7 * mm
            c.setFillColor(txt_main)
            c.setFont("Helvetica-Bold", 10)
            c.drawString(tx, y + self.row_h - 5.4 * mm, what)
            c.setFillColor(txt_sub)
            c.setFont("Helvetica-Oblique", 9)
            c.drawString(tx, y + 2.6 * mm, example)
            # connector arrow
            if i < len(self.STEPS) - 1:
                ax = x0 + box_w / 2
                top = y
                bot = y - self.gap
                c.setStrokeColor(arrow)
                c.setLineWidth(1.6)
                c.line(ax, top, ax, bot + 2.2)
                c.setFillColor(arrow)
                p = c.beginPath()
                p.moveTo(ax - 2.6, bot + 3.4)
                p.lineTo(ax + 2.6, bot + 3.4)
                p.lineTo(ax, bot + 0.2)
                p.close()
                c.drawPath(p, stroke=0, fill=1)
            y -= self.row_h + self.gap


class Rule135(Flowable):
    """1 big / 3 medium / 5 small day-shape diagram."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 34 * mm

    def draw(self):
        c = self.canv
        from reportlab.pdfbase.pdfmetrics import stringWidth
        rows = []
        for label, sub, base_w in [
            ("1 big thing", "60-120 min, needs focus", 70 * mm),
            ("up to 3 medium", "about 30 min each", 92 * mm),
            ("up to 5 small", "5-15 min: emails, calls, chores", 114 * mm),
        ]:
            needed = stringWidth(f"{label}  —  {sub}", "Helvetica-Bold", 9.5) + 12 * mm
            rows.append((label, sub, max(base_w, needed)))
        y = self.height - 9 * mm
        x_mid = self.width / 2
        fills = [TEAL_DARK, TEAL, colors.HexColor("#5FA8AB")]
        for i, (label, sub, w) in enumerate(rows):
            c.setFillColor(fills[i])
            c.roundRect(x_mid - w / 2, y, w, 7.4 * mm, 2 * mm, stroke=0, fill=1)
            c.setFillColor(PAPER)
            c.setFont("Helvetica-Bold", 9.5)
            c.drawCentredString(x_mid, y + 2.6 * mm, f"{label}  —  {sub}")
            y -= 10.6 * mm


# ── Page furniture ───────────────────────────────────────────────────

def draw_cover_bg(c, doc):
    c.saveState()
    c.setFillColor(TEAL_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.rect(0, PAGE_H - 70 * mm, PAGE_W, 70 * mm, stroke=0, fill=1)
    # subtle circles
    c.setFillColor(colors.HexColor("#0E8A90"))
    c.circle(PAGE_W - 18 * mm, PAGE_H - 14 * mm, 26 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0A7B81"))
    c.circle(12 * mm, 26 * mm, 34 * mm, stroke=0, fill=1)
    c.restoreState()


def draw_page(c, doc):
    c.saveState()
    # header band
    c.setFillColor(TEAL)
    c.rect(0, PAGE_H - 9 * mm, PAGE_W, 9 * mm, stroke=0, fill=1)
    c.setFillColor(PAPER)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(MARGIN, PAGE_H - 6.2 * mm, "DevPlanner — The Beginner's Planning Guide")
    # footer
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8.5)
    c.drawCentredString(PAGE_W / 2, 8 * mm, f"Page {doc.page - 1}")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
    c.restoreState()


def build():
    doc = BaseDocTemplate(
        os.path.abspath(OUT),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=16 * mm,
        title="DevPlanner - The Beginner's Planning Guide",
        author="DevPlanner",
    )
    cover_frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id="cover")
    body_frame = Frame(MARGIN, 16 * mm, CONTENT_W, PAGE_H - 9 * mm - 16 * mm - 8 * mm, id="body")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover_frame], onPage=draw_cover_bg),
        PageTemplate(id="page", frames=[body_frame], onPage=draw_page),
    ])

    E = []  # elements

    # ════ COVER ════
    E.append(Spacer(1, 26 * mm))
    E.append(Paragraph("From “I have no idea”<br/>to a plan you can do today", S["cover_title"]))
    E.append(Spacer(1, 6 * mm))
    E.append(Paragraph(
        "The Beginner's Guide to DevPlanner — how to take any goal (an exam, a project, "
        "your whole messy week) and break it into months, weeks, and days. No experience needed.",
        S["cover_sub"],
    ))
    E.append(Spacer(1, 16 * mm))
    E.append(LadderDiagram(CONTENT_W, on_cover=True))
    E.append(Spacer(1, 14 * mm))
    E.append(Paragraph(
        "Inside: the one idea behind all planning • a 4-question recipe for making goals "
        "• what to do when you have no syllabus or structure • worked examples for daily life, "
        "exams, and work • a 10-minute first run • a one-page cheat sheet.",
        S["cover_small"],
    ))
    E.append(NextPageTemplate("page"))
    E.append(PageBreak())

    # ════ 1. THE ONE IDEA ════
    E.append(Paragraph("1. The one idea behind all planning", S["h1"]))
    E.append(Paragraph(
        "Here is the secret nobody tells you: <b>you can't “do” a goal.</b> "
        "Nobody has ever sat down and “done” <i>pass the exam</i> or <i>launch the app</i>. "
        "The only thing a human can actually do is a small task: read one chapter, write one email, "
        "fix one bug. Goals are only reachable when they've been broken into tasks small enough to do today.",
        S["lead"],
    ))
    E.append(Paragraph(
        "So planning is just one move, repeated: <b>break the big thing into smaller things until "
        "the smallest thing fits in your day.</b> We call this the ladder:",
        S["body"],
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(LadderDiagram(CONTENT_W))
    E.append(Spacer(1, 5 * mm))
    E.append(callout(
        "The only rule that matters",
        "Every level answers one question. Goal: <i>where am I going?</i> Months: <i>what are the big chunks?</i> "
        "Weeks: <i>which chunk is this week's job?</i> Today: <i>which 3-7 tasks today?</i> Now: <i>which ONE thing right now?</i> "
        "If you're ever lost, find the question you can't answer — that's the level you need to fix.",
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(Paragraph(
        "DevPlanner is built around this ladder. Each part of the app is one rung, which is why it "
        "never feels like “where do I put this?” once you know the map on the next page.",
        S["body"],
    ))
    E.append(PageBreak())

    # ════ 2. THE APP IN PLAIN WORDS ════
    E.append(Paragraph("2. The app in plain words", S["h1"]))
    E.append(Paragraph(
        "DevPlanner has four pages plus an AI helper. Each one answers exactly one question:",
        S["body"],
    ))
    E.append(data_table(
        ["Place", "The question it answers", "What you do there"],
        [
            ["<b>Today</b>", "“What am I doing right now?”",
             "See today's 3-7 tasks, start a timer on one, tick things off. This is where you live during the day."],
            ["<b>Inbox</b>", "“Where do I throw new stuff?”",
             "Every idea, chore, and worry lands here first — unsorted, zero pressure. Empty your head into it."],
            ["<b>Plan</b>", "“What happens this week / month?”",
             "Arrange the future: weekly sprints, a board, a timeline, a table, and your long-term Goals grid."],
            ["<b>Review</b>", "“How did it go?”",
             "Once a week: count your wins, carry over the rest, set next week's top 3. Takes 15 minutes."],
            ["<b>AI helper</b>", "“Can someone do this thinking for me?”",
             "The round button, bottom right. It sorts your brain dumps, breaks tasks into steps, and — if you allow it — creates and organizes tasks for you."],
        ],
        [24 * mm, 50 * mm, CONTENT_W - 74 * mm],
    ))
    E.append(Spacer(1, 5 * mm))
    E.append(Paragraph("The five words the app uses", S["h2"]))
    E.append(data_table(
        ["Word", "Plain meaning", "Example"],
        [
            ["Area", "A bucket of your life", "Work, Personal, Professional (school fits here too)"],
            ["Task", "One thing to do, starts with a verb", "“Revise chapter 3”"],
            ["Subtask", "A bite of a task (the real unit you do)", "“Make 20 flashcards for ch. 3”"],
            ["Sprint", "One week's basket of tasks", "“Week of 15 June”"],
            ["Recurring", "A task that comes back by itself", "“Review flashcards — every day”"],
        ],
        [22 * mm, 62 * mm, CONTENT_W - 84 * mm],
        bold_first_col=True,
    ))
    E.append(Spacer(1, 5 * mm))
    E.append(callout(
        "Don't memorize this",
        "You only need two habits to start: <b>throw everything into Inbox</b> (press Ctrl/Cmd+Shift+D anywhere) "
        "and <b>pick 3-7 things each morning on Today</b>. Everything else in this guide makes those two habits stronger.",
        fill=SAND, edge=SAND_EDGE,
    ))
    E.append(PageBreak())

    # ════ 3. HOW TO MAKE A GOAL ════
    E.append(Paragraph("3. How to make a goal (when your head is empty)", S["h1"]))
    E.append(Paragraph(
        "“Set a goal” is useless advice if nobody shows you how. Here is the recipe. "
        "Answer four questions, in order, writing one line each:",
        S["lead"],
    ))
    E.extend(numbered([
        "<b>What do I want to be TRUE, by WHEN?</b> One sentence, with a date: "
        "“By 24 July, I have passed the biology exam.” “By 1 September, my portfolio site is online.” "
        "If there's no date, pick one — a guessed date beats no date.",
        "<b>How will I know it happened?</b> Name the proof: a grade, a link that works, money in the account. "
        "If you can't name proof, the goal is still a wish — sharpen it.",
        "<b>What are the 2-5 big chunks between me and that?</b> Don't aim for perfect — aim for "
        "“roughly, what has to exist?” For an exam: know the topics, practice questions, memorize key facts. "
        "For a website: content written, design done, site published.",
        "<b>What is the first 25-minute task?</b> Something so small you could do it tonight: "
        "“find the syllabus PDF”, “list the textbook chapters”, “register the domain”.",
    ]))
    E.append(Spacer(1, 3 * mm))
    E.append(callout(
        "Stuck on question 3? Never invent structure — borrow it.",
        "This is the move that unlocks everything when you have <b>no reading guideline, no syllabus, no clue</b>: "
        "someone has already broken your goal into parts. Steal their list.<br/><br/>"
        "• <b>Exam?</b> Use the syllabus topics. No syllabus? Use the textbook's table of contents. "
        "No textbook? Collect past exam questions and group them by topic — the groups ARE your topics.<br/>"
        "• <b>Skill?</b> Copy the chapter list of any popular course or book on it.<br/>"
        "• <b>Work project?</b> List the parts the finished thing must contain (a report = sections; an app = screens).<br/>"
        "• <b>Still stuck?</b> Open the AI helper and type: <i>“Break [my goal] into 4-6 big chunks.”</i> "
        "Then delete what doesn't fit. Editing a wrong list is 10× easier than writing on a blank page.",
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(Paragraph("Then spread it over the calendar (the easy math)", S["h2"]))
    E.extend(bullets([
        "Count what you have: <b>12 topics</b>, and count the time: <b>6 weeks</b>.",
        "Divide: 12 ÷ 6 = <b>2 topics per week</b>. That's your weekly sprint, decided by arithmetic, not anxiety.",
        "Keep the <b>last 10-20% of the time for nothing new</b> — only practice, polish, and fixing weak spots.",
        "Each week, on Sunday, pull that week's chunk into tasks. Each morning, pick 3-7 of them for Today.",
    ]))
    E.append(Spacer(1, 2 * mm))
    E.append(Paragraph(
        "That's the entire method. Goal in one sentence, chunks borrowed from someone else's structure, "
        "division to get the weekly load, and 3-7 tasks a day. The rest of this guide is just this recipe "
        "applied to real situations.",
        S["body"],
    ))
    E.append(PageBreak())

    # ════ 4. FIRST 10 MINUTES ════
    E.append(Paragraph("4. Your first 10 minutes in DevPlanner", S["h1"]))
    E.append(Paragraph(
        "Do this once, right after signing in. The app shows a “Get set up in 2 minutes” "
        "checklist on Today that walks you through the same steps.",
        S["body"],
    ))
    E.extend(numbered([
        "<b>Empty your head (3 min).</b> Press <b>Ctrl/Cmd + Shift + D</b> (or the checklist's “Brain Dump” button). "
        "Type everything you're carrying — one item per line, tasks and worries alike. There's a microphone "
        "button if you'd rather talk. Don't sort, don't judge, just dump.",
        "<b>Let the AI sort it (1 min).</b> Click <b>“Parse with AI”</b>. Each line becomes a draft task with a "
        "guessed priority, effort, and bucket (today / this week / backlog). Fix anything it got wrong, then save. "
        "Everything lands in your <b>Inbox</b>.",
        "<b>Pick today's 3 (2 min).</b> Go to <b>Today</b>. Use “Pull from Inbox” to bring in at most "
        "<b>one big, three medium, five small</b> tasks. When in doubt, pick fewer — finishing 3 beats starting 8.",
        "<b>Do one (now).</b> The top task shows in the Work block. Press <b>Start</b>. Work until you finish "
        "or stop; press <b>Done</b>. Enjoy the confetti — you've earned it.",
        "<b>Optional: connect your calendar (2 min).</b> Settings → Calendar → Connect Google Calendar. "
        "Scheduled tasks then appear on your normal calendar automatically.",
    ]))
    E.append(Spacer(1, 4 * mm))
    E.append(callout(
        "The 1-3-5 day shape",
        "A day that actually finishes looks like this — not like a 20-item wishlist:",
    ))
    E.append(Spacer(1, 3 * mm))
    E.append(Rule135(CONTENT_W))
    E.append(Spacer(1, 2 * mm))
    E.append(Paragraph(
        "DevPlanner shows this mix on Today (“1 big / 3 medium / 5 small” counters) and tracks a daily "
        "capacity in minutes. It learns from what you really complete: if you keep finishing about 3 hours of "
        "work a day, it stops pretending you'll do 6, and plans around 3. Overflow rolls to tomorrow with "
        "your approval (“Preview rollover”) — nothing moves behind your back.",
        S["body"],
    ))
    E.append(PageBreak())

    # ════ 5. SCENARIO: DAILY LIFE ════
    E.append(Paragraph("5. Scenario: plain daily planning", S["h1"]))
    E.append(Paragraph(
        "No big goal — just life: chores, errands, work bits, and the constant feeling of forgetting something.",
        S["body"],
    ))
    E.append(Paragraph("The daily rhythm (10 minutes total)", S["h2"]))
    E.append(data_table(
        ["When", "What", "Where"],
        [
            ["All day", "Anything pops into your head? Ctrl/Cmd+Shift+D, type it, close. 5 seconds.", "Inbox"],
            ["Morning (5 min)", "Open Today. Pull 1 big + up to 3 medium + up to 5 small from Inbox. Check the capacity bar isn't red.", "Today"],
            ["During work", "Press Start on one task. Finish it or stop the timer. Press Done. Repeat.", "Today"],
            ["Evening (2 min)", "Didn't finish something? Click “Preview rollover” and approve — it moves to tomorrow without guilt.", "Today"],
            ["Sunday (15 min)", "Review: wins, carryover, next week's top 3. The app turns it into next week's sprint.", "Review"],
        ],
        [27 * mm, CONTENT_W - 27 * mm - 22 * mm, 22 * mm],
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(Paragraph("Match tasks to your energy, not the clock", S["h2"]))
    E.append(Paragraph(
        "Every task can be marked <b>deep work</b> (needs full brain), <b>shallow</b>, <b>admin</b> (forms, emails), "
        "or <b>quick win</b>. Today has an energy filter: feeling sharp → show deep work; feeling flat → "
        "show admin and quick wins. Tired days still count if the right tasks get done.",
        S["body"],
    ))
    E.append(Paragraph("Make boring stuff recurring", S["h2"]))
    E.append(Paragraph(
        "Bills, laundry, watering plants, weekly reports: set a repeat rule on the task (for example "
        "<i>every Monday</i>). When you tick it off, DevPlanner automatically creates the next one on the "
        "next date. You will never re-remember a chore again.",
        S["body"],
    ))
    E.append(callout(
        "If you only adopt one habit",
        "Capture everything into Inbox the moment you think of it. A thought written down stops nagging you. "
        "Your head is for having ideas, not for storing them.",
        fill=SAND, edge=SAND_EDGE,
    ))
    E.append(PageBreak())

    # ════ 6. SCENARIO: EXAM ════
    E.append(Paragraph("6. Scenario: an exam, with no reading guideline", S["h1"]))
    E.append(Paragraph(
        "The scariest version of studying: a date on the calendar, a pile of material, and nobody telling you "
        "what to read when. Let's walk the recipe with a real example — <b>biology exam, 6 weeks away</b>.",
        S["body"],
    ))
    E.extend(numbered([
        "<b>Goal sentence:</b> “By 24 July, I pass biology with 70%+.” Proof: the grade.",
        "<b>Borrow the structure:</b> no reading guideline, so open the textbook's table of contents — "
        "say it lists <b>12 chapters</b>. That list IS the plan. (No textbook? Group 3 years of past questions "
        "by theme; the themes are your chapters. Or ask the AI helper to list the standard topics for your exam.)",
        "<b>Do the math:</b> 6 weeks × with the last week reserved for past papers = 5 study weeks. "
        "12 chapters ÷ 5 ≈ <b>2-3 chapters per week</b>. The math just wrote your study plan:",
    ]))
    E.append(Spacer(1, 2 * mm))
    E.append(data_table(
        ["Week (sprint)", "Job", "Day-by-day looks like"],
        [
            ["Week 1", "Chapters 1-3", "Mon: read ch.1 + flashcards • Tue: 10 questions ch.1 • Wed: read ch.2 + cards • ..."],
            ["Week 2", "Chapters 4-6", "Same pattern. Plus 15 min/day: review old flashcards (recurring task)."],
            ["Week 3", "Chapters 7-9", "Same pattern. Friday: redo every question you got wrong so far."],
            ["Week 4", "Chapters 10-12", "Same pattern."],
            ["Week 5", "Weak spots only", "Re-read worst 3 chapters; re-do their questions until clean."],
            ["Week 6", "Past papers", "One timed paper every 2 days; mark it; fix what failed. Nothing new."],
        ],
        [26 * mm, 36 * mm, CONTENT_W - 62 * mm],
        bold_first_col=True,
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(Paragraph("How to enter it in DevPlanner (15 minutes, once)", S["h2"]))
    E.extend(numbered([
        "Plan → Sprints → create “Exam week 1” … “Exam week 6” with their dates. (Or finish a "
        "weekly Review — it creates next week's sprint for you.)",
        "For each chapter, create one task: “Learn chapter 4”, and put it in its week's sprint.",
        "Open a task → ask the AI to <b>break it down</b> → you get subtasks like “read + summarize”, "
        "“make 20 flashcards”, “do 10 questions”. Use <b>“Spread subtasks across days”</b> to lay them over the week.",
        "Create one recurring task: “Review flashcards — 15 min”, repeating every day. Tick it daily; "
        "it respawns itself.",
        "Each morning: open Today, pull the day's study subtasks, press Start on the first one.",
    ]))
    E.append(callout(
        "Why this beats “study harder”",
        "On any given morning you never decide “what should I study?” — the plan already decided. "
        "Your only job is the next 25-minute block. Decisions are what drain you; the ladder removes them.",
    ))
    E.append(PageBreak())

    # ════ 7. SCENARIO: WORK ════
    E.append(Paragraph("7. Scenario: work — a project with a deadline", S["h1"]))
    E.append(Paragraph(
        "A report, a feature, a launch, a client deliverable — anything with a “due by”. "
        "Work goals are the easiest to break down because the finished thing has visible parts.",
        S["body"],
    ))
    E.extend(numbered([
        "<b>Goal sentence:</b> “By 31 July, the quarterly report is sent to the director.”",
        "<b>Walk backwards from the deadline:</b> sent on the 31st ← reviewed by a colleague around the 28th "
        "← full draft by the 21st ← data collected by the 14th ← outline by the 7th. Those dates are your "
        "month-level milestones — put each one in as a task with a due date.",
        "<b>Each week's sprint = the milestone of that week,</b> broken into tasks that start with verbs: "
        "“pull sales numbers”, “draft section 2”, “make the 3 charts”, “ask Dapo to review”.",
        "<b>Define “done” for every task.</b> “Work on report” is a trap — you can “work on” forever. "
        "“Draft section 2 (rough is fine)” can actually finish.",
        "<b>Protect one deep-work block a day.</b> Mark the writing/building tasks as deep work, schedule them "
        "for your sharpest hours (DevPlanner learns your peak hours from your timers and suggests them), and "
        "batch the emails into one admin block.",
    ]))
    E.append(Spacer(1, 3 * mm))
    E.append(callout(
        "The two-list trick for meetings-heavy jobs",
        "Keep project tasks and “reactive” tasks (emails, pings, requests) separate. Reactive stuff goes to "
        "Inbox all day and gets a single afternoon admin block. Your 1 big thing each day should almost always "
        "be a project task — otherwise the urgent eats the important, every day, forever.",
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(Paragraph("8. Every other scenario — same ladder", S["h1"]))
    E.append(data_table(
        ["You want to…", "Borrow structure from", "Week looks like"],
        [
            ["Get fit", "Any beginner program (e.g. couch-to-5k): its weeks are your sprints",
             "3 recurring workout tasks + 1 meal-prep task"],
            ["Learn to code", "A course's module list", "2 modules + 1 tiny build project per week"],
            ["Save money", "Your bank statement's categories", "1 weekly “review spending” recurring task + one cut per week"],
            ["Write a book", "Chapter outline (even a bad one)", "A daily recurring “write 300 words” + Friday “revise”"],
            ["Job hunt", "Stages: list → CV → apply → interview prep", "“Apply to 5” + “prep one interview answer” daily"],
        ],
        [28 * mm, 62 * mm, CONTENT_W - 90 * mm],
    ))
    E.append(Spacer(1, 3 * mm))
    E.append(Paragraph(
        "For life-sized direction, open <b>Plan → Goals</b>: a simple grid of short / mid / long term × "
        "personal / professional / work. One sentence per box is enough — it's the compass your weekly "
        "sprints should roughly point at. Review it monthly, not daily.",
        S["body"],
    ))
    E.append(PageBreak())

    # ════ 9. WEEKLY RHYTHM + WHEN IT GOES WRONG ════
    E.append(Paragraph("9. The weekly rhythm (15 minutes that hold it together)", S["h1"]))
    E.append(Paragraph(
        "Plans rot in about a week. The fix is a tiny weekly reset — DevPlanner's <b>Review</b> tab walks "
        "you through it step by step:",
        S["body"],
    ))
    E.extend(numbered([
        "<b>Wins</b> — list what got done. (The page shows your time per area vs. your weekly targets.)",
        "<b>Carryover</b> — what didn't finish, and what actually blocked it.",
        "<b>Top 3 intentions</b> — the three things that matter most next week.",
        "<b>Draft sprint</b> — rough notes on what goes in next week's basket.",
        "<b>Finish</b> — the app creates next week's sprint automatically. Add the tasks, done.",
    ]))
    E.append(Spacer(1, 2 * mm))
    E.append(Paragraph(
        "Want effort targets? Settings → Areas lets you set weekly hour targets per area (say, 10h study, "
        "3h fitness). Timers feed the Review page's progress bars, so you can see where the week really went.",
        S["body"],
    ))
    E.append(Spacer(1, 3 * mm))
    E.append(Paragraph("10. When it goes wrong (it will — that's normal)", S["h1"]))
    E.append(data_table(
        ["What happened", "What to do (the app helps)"],
        [
            ["I missed two days completely",
             "Don't double tomorrow. Open Today → “Preview rollover”, approve the moves, and continue as if "
             "the plan always said this. A plan you restart instantly is worth more than a perfect one."],
            ["My list is always too long",
             "That's not a character flaw — your capacity number is just smaller than your hopes. DevPlanner "
             "learns your real pace and plans to it. Cooperate: fewer, smaller tasks. Finishing builds momentum; overplanning kills it."],
            ["I keep avoiding one task",
             "It's too big or too vague. Rewrite it to start with a verb and fit in 45 minutes, or open it and let "
             "the AI break it into subtasks. Then do only the first subtask."],
            ["I have zero motivation today",
             "Set the energy filter to Low, do two quick wins, start a 10-minute timer on anything. Motivation "
             "usually follows starting — not the other way round."],
            ["I deleted something by mistake",
             "Every delete shows an Undo button for a few seconds. Click it. Crisis over."],
        ],
        [44 * mm, CONTENT_W - 44 * mm],
        bold_first_col=True,
    ))
    E.append(PageBreak())

    # ════ CHEAT SHEET ════
    E.append(Paragraph("The one-page cheat sheet", S["h1"]))
    E.append(Paragraph("Print this page. It's the whole system.", S["small"]))
    E.append(Spacer(1, 2 * mm))
    E.append(Paragraph("The 7 rules", S["h2"]))
    E.extend(bullets([
        "<b>1.</b> Goals are sentences with dates. Tasks are verbs that fit in a day. Never confuse the two.",
        "<b>2.</b> Never invent structure — borrow it (syllabus, table of contents, past papers, course outline, or ask the AI).",
        "<b>3.</b> Divide chunks by weeks left. The arithmetic is the plan. Reserve the last 10-20% for practice/polish.",
        "<b>4.</b> A day is 1 big + up to 3 medium + up to 5 small. When in doubt, plan less.",
        "<b>5.</b> Everything new goes to Inbox first (Ctrl/Cmd+Shift+D). Sort later, capture now.",
        "<b>6.</b> Unfinished work rolls forward guilt-free — approve the rollover and keep moving.",
        "<b>7.</b> Fifteen minutes of Review every week. This is the rule that keeps the other six alive.",
    ]))
    E.append(Spacer(1, 3 * mm))
    E.append(Paragraph("Shortcuts & buttons", S["h2"]))
    E.append(data_table(
        ["Where", "Action", "What it does"],
        [
            ["Anywhere", "Ctrl/Cmd + Shift + D", "Brain Dump — capture thoughts (type or speak)"],
            ["Anywhere", "Ctrl/Cmd + K", "Search / command menu"],
            ["Anywhere", "Alt + T", "Notifications tray"],
            ["Anywhere", "AI button (bottom right)", "Ask for plans, breakdowns, progress; tick “Can edit” to let it create/organize tasks"],
            ["Today", "Start / Done", "Timer on the current task; Done ticks it off (recurring tasks respawn)"],
            ["Today", "Preview rollover", "Approve moving unfinished work forward"],
            ["Plan → Goals", "—", "Short/mid/long-term goals grid (your compass)"],
            ["Settings → Areas", "—", "Weekly hour targets per life area"],
            ["Settings → Calendar", "—", "Google Calendar / CalDAV two-way sync"],
        ],
        [30 * mm, 46 * mm, CONTENT_W - 76 * mm],
    ))
    E.append(Spacer(1, 3 * mm))
    E.append(Paragraph("The 4-question goal recipe", S["h2"]))
    E.append(callout(
        None,
        "<b>1.</b> What do I want to be true, by when? (one sentence + date)<br/>"
        "<b>2.</b> How will I know? (the proof)<br/>"
        "<b>3.</b> What are the 2-5 big chunks? (borrow the structure!)<br/>"
        "<b>4.</b> What's the first 25-minute task? (do it today)",
    ))
    E.append(Spacer(1, 4 * mm))
    E.append(Paragraph(
        "That's everything. You don't need discipline made of steel or a perfect system — you need a ladder, "
        "an inbox, 3-7 honest tasks a day, and a 15-minute Sunday. DevPlanner holds the structure; you just "
        "climb one rung at a time.",
        S["quote"],
    ))

    doc.build(E)
    print("Wrote", os.path.abspath(OUT))


if __name__ == "__main__":
    build()
