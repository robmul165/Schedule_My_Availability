# Is Rob Free?

A tiny, free website you can send someone a link to. They can see when you're
free and request a time. Runs entirely on **GitHub Pages** (free static
hosting) plus a **Google Sheet** as the "database" — no server, no monthly
cost, no account for visitors to make.

You update your schedule by editing a Google Sheet (works great from your
phone). Requests land as new rows in that same sheet, and you get emailed
about them. Check a box to accept one and it's automatically blocked off.

---

## How it works

- `index.html`, `styles.css`, `config.js`, `app.js` — the website itself (static files GitHub Pages serves for free).
- `Code.gs` — a small script that lives inside your Google Sheet and acts as the "backend": it hands your schedule to the website as JSON, saves incoming requests as new rows, emails you about them, and auto-blocks accepted times.
- Google Sheet — two tabs: **Availability** (your recurring free time + one-off overrides) and **Requests** (auto-filled — this is where you'll see who wants to hang out, and accept them).

Nothing here costs money. GitHub Pages and Google Apps Script are both free at this scale.

---

## Setup (about 10 minutes, one time)

### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something like "Schedule Data".
2. Rename the first tab (bottom-left) to **Availability**. Add this header row exactly:

   | Type | Date | DayOfWeek | Start | End | Note |
   |------|------|-----------|-------|-----|------|

   - `Type`: `Free` or `Busy`
   - `Date`: leave **blank** for a recurring weekly row, or fill in a specific date (`2026-09-05`) to affect just that one day
   - `DayOfWeek`: only used when `Date` is blank — e.g. `Monday`, `Tuesday`... (used for recurring weekly rows)
   - `Start` / `End`: 24-hour `HH:MM`, e.g. `18:00` and `21:30`
   - `Note`: optional, not shown on the site yet but handy for your own reference

   **Every day defaults to open** across `defaultDayStart`–`defaultDayEnd` in `config.js` (midnight–midnight, i.e. the whole day, out of the box) — you don't need to add any rows at all until you want to say when you're *not* free. Add `Busy` rows for the chunks you're unavailable:

   - Recurring every week: `Busy`, blank `Date`, a `DayOfWeek` — e.g. "every Wednesday I'm at work 9–5."
   - Just one day: `Busy`, a specific `Date`, blank `DayOfWeek`.

   You can still add `Free` rows if you want — a recurring `Free` row for a weekday *replaces* the default hours for that weekday (handy if, say, Sundays you're only free 11am–8pm), and a one-off `Free` row on a specific date adds extra time on top of whatever's already open that day (e.g. an early morning before a trip).

   **Important:** on any one-off row, leave `DayOfWeek` blank. `Date` always wins — if a row somehow has both filled in, `DayOfWeek` is ignored and it only affects that one date — but leaving it blank keeps the sheet unambiguous, especially if you copy an existing recurring row as a starting point and forget to clear that cell.

   Example rows:

   | Type | Date | DayOfWeek | Start | End | Note |
   |------|------|-----------|-------|-----|------|
   | Busy |  | Wednesday | 09:00 | 17:00 | at the office |
   | Busy |  | Monday | 09:00 | 17:00 | at the office |
   | Busy | 2026-09-07 |  | 18:00 | 21:00 | dinner with the in-laws, just that night |
   | Free |  | Sunday | 11:00 | 20:00 | shorter day than usual |
   | Free | 2026-09-10 |  | 06:00 | 08:00 | extra morning free before a trip |

3. Add a second tab named **Requests** and leave it empty — the script fills in the header row automatically the first time it runs (`Timestamp`, `Type`, `Name`, `Contact`, `Date`, `Start`, `End`, `Message`, `Accepted`, `Processed`), and every submission from the site becomes a new row here.

*(If you forget a tab or header, the script actually creates any missing tab with the right headers the first time it runs — but matching the names above exactly avoids confusion.)*

### 2. Add the Apps Script backend

1. In your Sheet, go to **Extensions → Apps Script**.
2. Delete anything in the default `Code.gs` editor and paste in the entire contents of this project's `Code.gs` file.
3. Near the top, set `NOTIFY_EMAIL` to the address you want emailed whenever someone submits a request (leave it `''` to turn that off).
4. Click the disk icon (or Ctrl/Cmd+S) to save.
5. Click **Deploy → New deployment**.
6. Click the gear icon next to "Select type" and choose **Web app**.
7. Fill in:
   - Description: anything, e.g. "schedule site"
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Click **Deploy**. Google will ask you to authorize the script — click through **Authorize access**, pick your account, then **Advanced → Go to (project name) (unsafe)** → **Allow**. (This warning shows up because it's your own unpublished script, not because anything is actually unsafe — it only touches this one spreadsheet, plus sending mail as you if `NOTIFY_EMAIL` is set.)
9. Copy the **Web app URL** shown (it ends in `/exec`). You'll need it next.

If you already had this deployed before, paste the updated code in, save, then use **Deploy → Manage deployments → edit (pencil) → New version → Deploy** rather than creating a whole new deployment — that keeps your existing Web app URL working, but Google may ask you to re-authorize since sending mail is a new permission.

### 3. Configure the website

1. Open `config.js` in this project.
2. Paste your Web app URL into `appsScriptUrl`.
3. Optionally tweak `siteName`, `tagline`, `ownerFirstName`, `timezoneLabel`, `daysAhead`, `defaultDayStart`/`defaultDayEnd`, and `accentColor` to make it yours.

### 4. Put it on GitHub Pages

1. Create a new **public** repository on GitHub (e.g. `is-rob-free`).
2. Upload all the files in this project to the repo, keeping them at the root (`index.html`, `styles.css`, `config.js`, `app.js`, `Code.gs`). Easiest way: on the repo's GitHub page, click **Add file → Upload files** and drag the files in — or use `git`:

   ```bash
   git init
   git add .
   git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/is-rob-free.git
   git push -u origin main
   ```

3. In the repo, go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
5. Wait about a minute, then refresh — GitHub shows your live URL, something like `https://YOUR_USERNAME.github.io/is-rob-free/`.

That's your shareable link.

---

## Day to day

- **Update your schedule:** just edit the Availability tab in the Google Sheet. No redeploy needed — the site reads live from the sheet every time someone loads it.
- **See who's interested:** open the Requests tab, or just watch your inbox — you get an email for every submission with their name, contact info, and the time they asked for.
- **Accept a request:** check the box in the **Accepted** column on that row. A script fires automatically and adds a matching `Busy` row to the Availability tab, so that time is instantly blocked off on the site — no need to go add it by hand. You can accept multiple different requests on the same day, as long as their times don't overlap — each one only blocks its own slice of time, so the rest of the day stays open for other requests. (Unchecking the box doesn't undo it — delete the `Busy` row yourself if you change your mind.) Leave the **Processed** column alone; it's how the script avoids double-booking a busy row if you edit that row again later.
- **If two requests overlap:** checking "Accepted" on a request that conflicts with something you already accepted automatically unchecks itself and shows a heads-up at the top of the sheet, instead of double-booking you. Resolve the other one first (decline it or delete its `Busy` row), then check the box again.
- **Decline a request:** just leave the box unchecked, or delete the row.

---

## A few notes

- **Times** are shown exactly as you enter them in the sheet — set `timezoneLabel` in `config.js` to whatever you actually mean (defaults to Eastern Time) so visitors aren't guessing.
- **Requests aren't restricted to your free windows.** Someone can ask for any time, including times shown as busy — it's just a request either way, and you decide by accepting or ignoring it.
- **Privacy:** GitHub Pages sites are technically public — anyone with the exact URL can view it — but it won't show up in search results or be discoverable unless you share the link. If you want a bit more obscurity, pick a repo name that isn't easy to guess (avoid `is-rob-free` if that feels too on the nose!).
- **Spam:** the request form includes a hidden "honeypot" field that silently ignores basic bots. Apps Script's free quota (tens of thousands of requests/day) is far more than this will ever need. Since accepting is a manual step (you check the box), a spammer submitting junk requests can't lock up your calendar on its own.
- **Testing locally:** once `config.js` has your real Apps Script URL, you can just open `index.html` directly in a browser to try it before pushing to GitHub.
