# Sprint Room

A scrum team tool for Windows: team dashboard with sprint KPI charts, sprint and meeting schedule, retrospective board with an Excel report, and scrum poker where the average of everyone's votes becomes the story points.

It works offline, installs nothing and needs no accounts. The scrum master can run it on their own computer and share their screen, or teammates on the same network can join from their browsers.

## Download

**[Latest release: Sprint Room 1.2.0 for Windows](https://github.com/akshay95nigam/sprintroom/releases/latest)** (64-bit Windows 10/11, 37 MB zip)

`SprintRoom-Windows.zip` in this repository is the earlier 1.0.0 build (Go, 3 MB). It doesn't have the screen-share scrum poker, the Excel report or the sprint KPIs.

## Run it

1. Unzip the folder somewhere you can write to, such as `Documents\SprintRoom`.
2. Double-click `SprintRoom.exe`. Your browser opens Sprint Room, along with a console window. Keep that window open while you use the app; close it to stop.
3. Either share your screen in Teams, Zoom or Meet, or click **Invite team** and share the address it shows (like `http://192.168.1.20:4280`) with teammates on the same network or VPN.

On first launch Windows may show:

- **"Windows protected your PC"**: the program isn't code-signed. Click **More info → Run anyway**.
- **A firewall prompt**: allow **Private networks** if teammates will connect from their own devices, or click **Cancel** if you'll only share your screen.

## Features

- **Dashboard**: current sprint with **Start sprint** / **End sprint**, progress, next meeting countdown, team availability, sprint load against capacity, and the last sprint's retrospective with open action items.
- **Sprint KPIs**: ending a sprint asks for its velocity, committed points and average cycle time. The dashboard shows KPI tiles (velocity, 3-sprint average velocity, average cycle time, commitment reliability, each compared with the previous sprint), a velocity chart (committed vs completed) and a cycle time trend, with hover details and a table view.
- **Team**: members with role, availability and capacity.
- **Sprints & meetings**: sprint dates and goal, plus planning, daily stand-up, review and retrospective times.
- **Retrospective**: went well / to improve / action items, with +1 voting, owners and done tracking. **Finish retrospective & download Excel** produces an `.xlsx` report (Summary with sprint KPIs, Retro notes, Action items, Story estimates, Team), for one sprint or all of them.
- **Scrum poker**: Fibonacci deck (0, ½, 1, 2, 3, 5, 8, 13, 21, ?, ☕). In screen-share mode the scrum master asks each person in turn and clicks their card; cards stay face down until revealed. Or everyone votes on their own device. The average becomes the story's points, or round to the nearest card.

## Data

Everything is saved in `sprint-room-data.json` next to `SprintRoom.exe`. Use **Download backup** at the bottom of the page to keep a copy. When teammates connect over the network, anyone who can reach the address can view and edit, so only do that on a trusted network.

## Build from source

The app is a single Node.js file with no npm dependencies.

- `npm start` runs it on any machine with Node.js 22 or later.
- `npm run build:win` (on macOS or Linux) produces `dist/SprintRoom-Windows.zip`. It downloads official Node.js builds from nodejs.org, checks their SHA-256, and packages the app as a Node.js single executable application.

| File | Purpose |
| --- | --- |
| `server.js` | HTTP server, JSON API, live updates, file storage and the Excel report |
| `web/index.html` | The web app (HTML, CSS and JavaScript in one file) |
| `sea-config.json`, `build.sh` | Windows single-executable build |
| `README.txt` | End-user instructions shipped inside the zip |
