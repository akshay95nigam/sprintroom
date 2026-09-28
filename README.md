# Sprint Room

A standalone scrum team tool for Windows: team dashboard, sprint and meeting schedule, retrospective board, and scrum poker where everyone votes on a story and the average becomes its story points.

No installation, no accounts, no internet service. One person runs it, and the rest of the team joins from their browsers on the same network.

## Download

**[SprintRoom-Windows.zip](SprintRoom-Windows.zip)** (64-bit Windows 10/11)

## Run it

1. Unzip the folder somewhere you can write to, such as `Documents\SprintRoom`.
2. Double-click `SprintRoom.exe`. Your browser opens Sprint Room, along with a console window. Keep that window open while you use the app; close it to stop.
3. Click **Invite team** and share the address it shows (like `http://192.168.1.20:4280`). Teammates on the same office network or VPN open it in any browser and click **Who are you?** to pick their name.

On first launch Windows may show:

- **"Windows protected your PC"**: the program isn't code-signed. Click **More info → Run anyway**.
- **A firewall prompt**: allow **Private networks** so teammates can connect.

## Features

- **Dashboard**: current sprint, progress, next meeting countdown, team availability, sprint load against capacity, and the last sprint's retrospective with open action items.
- **Team**: members with role, availability and capacity.
- **Sprints & meetings**: sprint dates and goal, plus planning, daily stand-up, review and retrospective times.
- **Retrospective**: went well / to improve / action items, with +1 voting, owners and done tracking.
- **Scrum poker**: Fibonacci deck (0, ½, 1, 2, 3, 5, 8, 13, 21, ?, ☕). Votes stay hidden until revealed; the average becomes the story's points (or round to the nearest card). Record votes for people without a laptop.

## Data

Everything is saved in `sprint-room-data.json` next to `SprintRoom.exe`. Use **Download backup** at the bottom of the page to keep a copy. Anyone who can reach the address can view and edit, so run it only on a trusted network.

See `README.txt` inside the zip for troubleshooting.
