# Design direction

## Identity

Aim for visual density, large editorial type, dark monochrome surfaces, and quick in-gym controls. Use `nicereps` branding and original icons, illustrations, copy, and component shapes. Avoid gender-coded color or imagery.

Dark is the default; a matching light theme ships in the first release. Grayscale intensity carries the heatmap, with text labels that convey the same information. Reserve the strongest contrast for the current action and logged values. Large numbers and short labels should remain legible from arm's length. Use a consistent spacing, type, radius, and motion scale.

## One-page interaction map

```text
HOME (one vertical scroll; no tabs)
  Start workout  ->  Planned today / Recent sessions (last done) / Templates / Fresh
  Getting started -> Start, planning and Import data; until there is data
  12-week dots   ->  Day sessions and plan, inline; the grid ends 7 days after today
                     for planning: every weekday or this day only
  Muscle sets    ->  Last 7 days breakdown, inline
  Recent work    ->  Workout page (summary, muscles, exercises, repeat, edit,
                     save as template, share image, delete); Finish opens it too
  Templates      ->  Summary, start, edit, delete, inline
  Measurements   ->  Last-measured parts with trend and guide, inline;
                     + opens Log measurements (date, photos, parts);
                     View all page (progress by day or month, star series)
  Stats          ->  Past week volume opens Volume page (range, weekly trend);
                     starred PRs open their lift page; Show all opens Stats
                     page (volume range, PRs, lifts opening their lift page)
  Settings       ->  Page under a back header

ACTIVE WORKOUT (replaces home content)
  Workout header ->  Name (✎ to rename) / elapsed time / finish / discard
  Exercise list  ->  Tap to expand sets and notes; ⋮ for bar, history, how-to
  Set row        ->  Weight + reps (target greyed) + large Complete target
                     bodyweight lifts show + body weight under weight; tap to log it;
                     with no added weight, the field shows BW greyed
  Prev line      ->  Matching set from last session; tap copies it. "· try 85" when every working set met its target
  Below the list ->  Tiles, muscles worked
  Bottom dock    ->  Rest timer; full-width Finish the first time every set is complete
  Optional row   ->  Target RPE / logged RPE / rest / comment
  Add exercise   ->  Local searchable catalog and custom entry
```

The first tap on **Start workout** reveals choices on the page, not a modal. Recent entries show the workout name and elapsed time since last done, omitting a 0 min duration. A fresh workout starts empty. Active logging uses the same screen position and a clear return path; it is not a new tab. Minimise (header button or Android back) returns home with the workout still running; the start action becomes **Resume** with the workout name and elapsed time, and every other page shows the active workout strip under the status bar. Tapping the workout name or its ✎ renames it in place; a blank name keeps the old one. Only Finish or Discard ends a workout. Autosaved unfinished work reappears when the app opens. Below the exercise list, the workout page's tiles and **Muscles worked** chart total the sets completed so far.

A finished workout in Recent opens its own page under a back header titled **Recent**: the date in caps (with the start time unless it lasted 0 min), the name, and its note when there is one. Below are tiles for **Duration** (omitted at 0 min), **Working sets**, **Volume** (weight × reps over completed working reps sets, adding body weight on bodyweight lifts as in Stats, in t for 1000 kg or more), and **Records**, inverted with ◆ when the workout holds any. **Muscles worked** draws the workout's muscle sets, by the muscle sets rule, as up to six vertical bars in heat steps. Tapping a bar highlights its label and expands, below the bars, the exercises that make it up with their sets, as tapping a home muscle sets row does under that row; tapping again collapses it. Each exercise card shows a **◆ Record** pill or its working set count; for reps exercises the top set by e1RM with that e1RM (**with body weight** on bodyweight lifts), for timed ones the longest hold; a line of the last 8 sessions' e1RM or longest hold up to this workout, with its last point marked (no line for distance or interval exercises); and chips for completed sets, warm-ups faded with W and record sets inverted with ◆, as in History. **Repeat workout** (hidden while a workout is active) and **Edit** return home with that workout open; **Save as template** expands the name field and **Keep weight** / **Keep reps** switches in place, and confirms or shows the error below. A centred, muted **Delete workout** below them reads **Tap again to delete workout** after one tap; the second tap deletes it and returns home. **Share image** draws a 390 dp card in the current theme with Skia from the page's own pieces: the date line, the name, the same tiles, a card per exercise with records holding its ◆ record chips, and the `nicereps` wordmark. It writes one PNG to the app's export cache, which erase clears, and opens the system share sheet. **Finish** opens this page with the back header titled **Home**. A workout that no longer exists shows **Workout not found**.

Templates are plans, not workouts. A template row expands to its exercises with **Start**, **Edit**, and **Delete** (tap again to confirm); editing happens in place with the same set fields, keypad, and exercise picker as logging, and changes apply only to workouts started afterwards. Planning lives in the 12-week dots: a day from today on shows its planned template, marked done once any workout is finished that day. Today's planned workout leads the start choices. That day's detail offers two choice rows, or a hint to make a template when none exist: **Every <weekday>** (Rest or a template) changes the repeating plan; **<date> only** (Weekly plan, Rest, or a template) changes that one date and leaves the repeating plan intact. Moving a session is two one-day changes. Reminders are Settings switches: **Planned-workout reminders**, then its time once on, and **Measurement reminders**, then its time, a **Repeat** chip row (Daily, Weekly, Fortnightly, Monthly), an **On** weekday chip row for weekly and fortnightly or a **Day of the month** field for monthly, and a muted line with the next reminder. Times and the day are typed on the keypad in a modal sheet; each time shows as h:mm with **AM** and **PM** chips beside it. Settings also chooses the Weight (kg/lb), Length (cm/in), and Distance (km/mi) units; every weight, tape, and distance value, pace, keypad label, and record follows them. A template's weight × reps exercise is labelled **Weight × target reps**. A finished workout in Recent offers **Save as template**: a name plus **Keep weight** and **Keep reps** switches (both on); a switched-off value is saved as 0, and kept reps fall back to a blank set's target.

## Micro-interactions

- Complete a set by tapping its clear, large target. Mark the completed state in text and shape as well as brightness. Start the rest timer immediately; show a brief confirmation without blocking logging. Completing sweeps the set row left to right in 240 ms into a `text` fill with `bg` text, and the check becomes a `bg` circle with a `text` ✓; un-completing sweeps it back. Each text fades to its inverted colour as the edge reaches it; lines below the fields switch near their left edge. The fill covers the set's Prev, body weight, plates and pace lines, inset slightly inside the row; they invert to `bg` at 60%, like the units. Reduced motion inverts the row without the sweep.
- A completed set that sets a PR shows a **◆ PR** pill in `bg` with `text` caps between its fields and its check, and is announced as a personal record. On completion it fades in from 0.8 scale, overshoots to 1.12 and settles at 1, over 320 ms after a 160 ms delay so the sweep reaches it first; it does not replay when the workout reopens. Reduced motion shows it at once. Un-completing the set removes it.
- Haptics: a medium impact on completing a set (a success notification when it sets a PR), a selection tick on each keypad key and when a set swipe crosses the point where release opens or closes it. A timer phase ending in the foreground plays the chime (`assets/timer.wav`, generated for nicereps) and vibrates 300 ms twice, each behind its Settings switch (Sound, Haptics); Haptics also gates every tick and impact above.
- Swipe a set and tap ⋮ to show a checkbox chip per optional field; a checked field stays visible on that set, and a new set or copied workout carries it. Sets saved before per-field choices show every field when their options were open or any was used. Saving a workout as a template keeps whether a set showed fields. RPE values can be changed at any time.
- Use the in-app keypad for every number entry (weight, reps, RPE, rest, measurements), identical on iOS and Android: large keys in an elevated bottom sheet with a grabber, a title, and **Done**. It slides up in 280 ms and closes in 160 ms; dragging it down dismisses it, and the rest bar rides on top. The first key replaces the value. Tap another field, in a workout or a template, to move to it while the sheet stays open. Opening the sheet scrolls the active field above it; text fields stay above the system keyboard. Durations (time, recovery, rest) show a large `00:00:00` above the keys; digits shift in from the right, so 1, 0, 0 is one minute, up to 99:59:59. Duration fields show `m:ss` or `h:mm:ss` while typing and after, never a count of seconds. Show the unit and selected duration beside the input. Give timer controls Skip and Extend clear tap targets.
- Swipe a set left, including its Prev line and any expanded options, to reveal ⋮ (show or hide that set's field chips: Target RPE, RPE, Rest, Comment, and Plates on a bar exercise) and a bin (delete the set). Repeating swipe + ⋮ hides the options again. Everything under the set row (Prev, plates, body weight, pace, options) runs its full width. Sets have no divider lines; the options sit a step below the Prev line. The comment is bare smaller medium-weight text with no underline or fill, unlike the number fields, and grows a line at a time as its text wraps. Tapping a sets/reps set's label cycles it through working, warm-up (W) and drop (D). Working sets are numbered 1, 2, 3 in order, skipping W and D sets, and templates use the same labels. Screen readers announce sets by position, and get the field chips toggle and delete as actions on the set label.
- The 12-week dots are 84 days in six rows of 14, read left to right, oldest at top; the last dot is 7 days after today, so future days fill the end of the last row. Tap a dot to expand that day below the grid: its workout list and exact completed-set count; any day from today on also offers **Every <weekday>** and **<date> only** choices. A workout in that list opens its workout page, as in Recent, with the back header titled **12 weeks**. Planned and completed sessions must look distinct.
- Auto-advance waits 300 ms after a completion so the sweep reads, then collapses the current exercise and expands the next one, closing any open keypad or set options; the rest timer keeps running. The page scrolls only when the newly opened exercise's top third is off-screen, without animation under reduced motion. Editing any set, opening a field, choosing an exercise, or minimising within the wait cancels the move.
- Open exercise history from an exercise's ⋮ options. Keep current logging values and controls visible on return. Superset links and set tags remain optional and visually quiet.
- **History** expands in the exercise's ⋮ options, beside **How to**: record rows (best weight, best e1RM, best reps at each weight; for a duration exercise, longest hold and longest at each weight), a rep-max row of ≈ 3, 5, 8 and 10RM from the best e1RM, the formula, then dated sessions, ten at first. Tapping a record expands its source session and marks the record set with ◆.
- Editing a finished workout reuses the active-workout screen. The header shows ‹ date › in place of elapsed time and **Done** in place of Finish; there is no rest timer, and Discard becomes **Delete workout**. Back and ⌄ close the editor and restore any minimised workout; closing it with no sets deletes the workout.
- Sheets are appropriate for bounded tasks such as number entry. Prefer inline controls for common logging and statistics. Avoid stacks of nested sheets.
- Use restrained motion for section expansion and completion feedback. Respect reduced-motion settings and verify gestures and timers on a real, slower device.
- Running clocks (the workout header and Resume) roll each changed digit up and the rest countdown rolls it down: the new digit moves in from half its height away while the old one moves out, both fading over 180 ms with a strong ease-out. The keypad duration display rolls the digits it shifts the same way. Reduced motion swaps digits in place.

## Visual system

**Colors** (`src/ui/theme.tsx`, `palettes`). Monochrome; the accent is the text color. `danger` is used only for the swipe-revealed delete-set bin. `warning` marks an unusual weight or reps field and its note, and the incomplete sets' checkboxes after Finish with sets not complete; each warning has a note under its set and pulses twice when it appears (not under reduced motion).

| Token | Dark | Light |
| --- | --- | --- |
| bg | `#0b0b0c` | `#f6f6f4` |
| surface | `#151517` | `#ffffff` |
| raised | `#1d1d20` | `#eeeeec` |
| line | `#2a2a2e` | `#e1e1de` |
| text / accent | `#f4f4f5` | `#111113` |
| muted | `#9a9aa1` | `#6a6a70` |
| faint | `#5c5c63` | `#a6a6aa` |
| onAccent | `#0b0b0c` | `#ffffff` |
| danger | `#ff5a52` | `#d92d20` |
| warning | `#d9b36a` | `#94691f` |
| heat 0–4 | `#26262a` `#4a4a52` `#76767e` `#adadb4` `#f4f4f5` | `#e6e6e3` `#c4c4c0` `#8e8e8c` `#55555a` `#111113` |

Heat levels: 0 sets, under 5, under 9, under 15, 15 or more. Planned days from today on that are not yet done use a dashed `muted` outline; other days after today are hollow with a solid `faint` outline. The legend names both. Today gets a `text` ring; another selected day gets a `muted` ring.

**Spacing:** xs 4, s 8, m 12, l 16, xl 20, xxl 28. **Radius:** s 10, m 16, l 24, pill 999.

**Touch targets:** 44 minimum for every control, a 22 dp set completion circle and 28 dp set number, each reaching 44 with hit slop, 64 for the primary start action. Heatmap day dots measure about 21 dp, 25 dp with hit slop, accepted for that dense grid.

**Type:** Montserrat (OFL, bundled in `assets/fonts/` with expo-font) at 400, 600, 700 and 800, with tabular figures on every variant. Text symbols it lacks (✓ ★ ◆) fall back to the system font. Screens use these variants without local size overrides.

| Variant | Size / weight | Use |
| --- | --- | --- |
| title | 34 / 800 | Workout name, keypad display |
| display | 30 / 800 | Rest clock, volume total |
| brand | 22 / 800 | Wordmark |
| value | 21 / 700 | Weight, reps, keypad keys |
| heading | 18 / 700 | Card titles, start action |
| body | 16 / 600 | Rows |
| input | 16 / 400 | Text fields |
| label | 15 / 700 | Buttons, set numbers |
| meta | 14 / 400 | Secondary lines |
| small | 12 / 400 | Footnotes, Prev, units |
| caps | 12 / 700, uppercase | Section and field labels |

In the background the rest bar becomes an ongoing notification titled with the phase label, plus ` · n/total` for intervals, the exercise name as its text and a system countdown to the phase end, matching the rest bar. Tapping it opens the app. On iOS it is a Live Activity on `bg` with the same title (uppercase, `muted`, bold) over the exercise name, and the countdown in heavy `text` digits on the right; the Dynamic Island shows the title and the countdown when compact, and the countdown alone when minimal. Once the phase ends without the app, the countdown becomes **Rest timer up!**, or **Up!** in the compact and minimal Dynamic Island, where the full text does not fit.

**Icons:** Phosphor (phosphor-react-native, MIT, drawn with react-native-svg) at the bold weight; a starred ★ uses the fill weight. `Icon` takes a size and a colour token: **s** 14 in small or inline controls, **m** 20 for standalone controls, **l** 24 for the keypad delete key. Icons keep their size at large font sizes. Each is imported from `phosphor-react-native/src/icons/<Name>`, since the package root pulls in every icon and doubles the bundle. Controls keep their accessibility labels; the icon adds nothing for screen readers. This file names controls by their old glyphs:

| Glyph | Icon | Colour |
| --- | --- | --- |
| › ⌄ (rows, cards, strip) | CaretRight, CaretDown | `faint`; `muted` on the minimise button; `bg` at 60% on the strip |
| ‹ › (back, day steps) | CaretLeft, CaretRight | `muted` |
| ↓ ↑ (Start workout) | CaretDown, CaretUp | `onAccent` |
| ⋯ (Settings) | DotsThree | `muted` |
| ⋮ (exercise and set options) | DotsThreeVertical | `text`; `muted` in templates |
| ✎ | PencilSimple | `muted` |
| ☆ ★ | Star, filled when starred | `faint`, `text` |
| + (Fresh, Log measurements, Set, Add exercise, picker rows) | Plus | `text` or `muted`, as the label |
| ↑ ↓ (move exercise) | ArrowUp, ArrowDown | `muted` |
| ✕ × (photo, template set) | X | `text`, `muted` |
| bin | Trash | `danger` |
| ✓ (set check) | Check | `text` on `bg` |
| ⌫ | Backspace | `text` |
| ≡ | List | `muted` |

At large font sizes or on screens narrower than 360 dp, the active workout header keeps minimise and **Finish** on one row and puts the name on its own full-width row below, so a word never splits. The rest bar moves **+30s** and **Skip** onto their own row when its text would get narrower than 80 dp, and set labels shrink to fit their column.

**Components:** `Txt` (variant + tone), `Tap` (pressable with role, 44 minimum, 0.97 press scale when it has an action), cards on `surface` with radius l, inline expanders with a 160 ms fade, a round completion checkbox whose set row inverts when done, set rows inset 8 dp inside their completed fill that swipe left to reveal options on `raised` and an unfilled red bin to delete, a floating rest bar above the safe area, a `Keypad` bottom sheet docked under it while a field is active (the template editor docks the same sheet at the screen bottom; measurement entry uses a modal sheet over a dimmed backdrop), a measurements summary listing the starred series (a row whose latest entry predates the last measured date shows that date), or the parts logged on the last measured date when nothing is starred, a **Log measurements** page (one date, a Photos row with 3:4 thumbnails, each with a corner ✕ (tap again to delete), and **Take photo** / **Choose photo**, every part with its guide and value field, one Save, leaving saves) and a **View all** page (a Progress list of days, or month rows once days span months, each with a left photo thumbnail and starred values, a day expanding to its photos with tap-again **Delete photo**; on both pages, tapping a photo opens it full screen on black, and a tap or back closes it; then each series row led by a ☆/★ **Star** switch, ★ when starred), both under a back header, a workout page (tiles, a muscle bar chart, exercise cards with a sparkline and set chips, then actions) under a back header with a centred, muted title, a solid figure with a tape loop (solid front, dotted back) for each body-part measurement guide, a dated dot-and-line trend per measurement series (4 dp line between 8 dp dots) with its first and last dates and its range, an entry list (newest first) whose rows expand to edit the value and step the date, with tap-again confirmation to delete an entry or a series, a Resume state on the start action while a workout is minimised, an active workout strip in inverted colours fixed under the status bar on every other page while a workout is minimised (a live dot, the name and muted elapsed time, then the timer phase, such as **REST**, and its countdown while the timer runs, and ›; it wraps the timer group to a second line at large font sizes; tapping it returns home with the workout open), a **Getting started** card under the start action on an install with no finished workout, template, measurement or photo (Start and the 12-week dots explained, then an **Import data** row), a **Back up your data** card in the same place once a backup is due (no backup folder and nothing exported or dismissed in 30 days), with a muted **Dismiss** in its header and **Backup folder** and **Export data** rows that open Settings, an inline **Set deleted · Undo** row in a deleted set's place for 4 s (160 ms fade; screen readers hear "Set deleted" and keep the row until the next delete), an open exercise card header with the name and a ⋮ that expands its options inline (its progress line, then a **Bar** row on sets/reps exercises showing the exercise's bar weight, or the Settings bar marked **· Settings**, typed on the keypad, then the exercise note as bare smaller medium-weight text like the set comment, then **History** and **How to**; a filled note stays as a muted line under the header while the options are closed, and tapping it opens them), a muted **Per side 25 · 15** line under a bar exercise set's weight while its Plates field is shown (**Bar only** below one plate pair, and the loaded total in brackets when it differs from the typed weight; it follows the keypad while the weight is typed), and a **Settings** page under a back header, its groups (**App**, **Workout**, **Units**, **Data**, **About**) each opening with a `heading` header and separated by an extra xxl gap: **App** holds Theme, a **Home sections** list (fixed-height rows, each with a ≡ drag handle, its name and a Shown/Hidden switch; dragging locks scrolling, ticks per slot, and screen readers get Move up/Move down) and Off/On **Haptics** and **Sound**; **Workout** holds **Bar** choices and **Plates available** checkbox chips for the current weight unit, then the reminders; **Units** holds Weight, Length and Distance; then the **Data** group: **Export data** (saves the ZIP to a folder picked each time and says which; afterwards it lists any photo files missing from the archive), **Backup folder** (**Change backup folder** once chosen, **Back up now** on iOS; below it the folder name and last backup time, any failure in a polite live region, and a muted **Stop backups**), **Import data**, **Blank CSV template** (share sheet, with its columns documented below it) and **Erase all local data**, which expands a warning and a tap-again **Erase everything**, then an **About** group: **Rate nicereps** (Android), **Report a bug** with a muted line naming the email address, **Source code**, then a centred muted **Support me on Ko-fi** link and the line **nicereps never connects to the internet. These links open your email, browser or app store.**; a link that no installed app can open shows **No app found to open this link.** at the end of the group; a **Stats** page under a back header: a **Volume** card with Past week / Past month / All time chips over a large total and its rule, then a **PRs** card (one row per lift and record type: name, then **Weight 100 kg × 5**, **e1RM 116.7 kg** or **Hold 1:30** · **+12.5 kg since Sep 15** (the gain since the first workout in that record's trend, the year shown only when not this year), **no change since Sep 15** or **1 workout**, with a ★/☆ switch; ordered by weight, e1RM then hold on the lift page; starred first, then most recent first; starred rows also list under the home Stats row with a 28 dp sparkline of that record's per-workout trend), then a **Lifts** card whose rows show best e1RM, longest hold or Bodyweight and open the lift page; a **Volume** page under a back header (the same Volume card, then a **Weekly** card with the trend of each 7-day window ending today, back to the first workout); a lift page under a back header titled with the lift: a card per record type (**Weight**, **e1RM**, **Hold**) with the record row and its ★/☆ switch over that record's per-workout trend (two or more workouts), then a **History** card; the home Stats section ends with a **Show all** row that opens the Stats page; and an **Import data** page under a back header: **Choose file**, then a **Selected file** card with new and changed counts for workouts, templates, measurements, photos, and exercises, plan and settings together, plus the file's most recent workout (name and date) and last measurement date, any skipped series, an errors card (first 20) that blocks import, an **Exercises** card for another app's file (**N to match** aside; one row per name with its exercise, **· remembered**, **New custom exercise** or **Not matched**, expanding to **Create … as a custom exercise** and an exercise search; **Import** stays muted with **Match every exercise to import.** until each has one), and a changed-duplicates card with an **All duplicates** Skip/Update/Replace choice and the same choice per row, then **Import**.
