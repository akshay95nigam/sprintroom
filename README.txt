SPRINT ROOM  v1.1.0  (Node.js edition)
===================

A scrum team tool: team dashboard, sprint and meeting schedule,
retrospective board, and scrum poker. Nothing to install and no
accounts. One person (usually the scrum master) runs it, and the
rest of the team uses it from their web browsers.


START IT
--------
1. Unzip this folder somewhere you can write to, for example
   Documents\SprintRoom. (Don't run it from inside the zip.)
2. Double-click SprintRoom.exe.
3. Your browser opens Sprint Room. A black window also opens.
   That window is the app: keep it open while you use Sprint Room.
   Close it to stop. Your data stays saved.

The first time only, Windows may show:
 - "Windows protected your PC" (SmartScreen). Click "More info",
   then "Run anyway". This appears because the program isn't
   signed with a paid certificate.
 - A Windows Defender Firewall prompt. Tick "Private networks" and
   click "Allow access" so teammates can connect.


INVITE YOUR TEAM
----------------
Click "Invite team" in the top right of Sprint Room, or read the
black window. It shows an address like

    http://192.168.1.20:4280

Teammates on the same office network or VPN open that address in
Chrome, Edge or Firefox. They install nothing. Each person clicks
"Who are you?" once and picks their name, so their scrum poker
votes show under it.


WORKS OFFLINE, OR JUST BY SHARING YOUR SCREEN
---------------------------------------------
Sprint Room needs no internet connection. If your team can't reach
your computer (remote call, locked-down network), run it only on your
own computer and share your screen in Teams, Zoom or Meet. You can
click "Cancel" on the firewall prompt in that case.


SCRUM POKER
-----------
1. Put a story on the table (type it in, or press "Estimate" next to
   a story in the sprint list).
2. Collect the votes. Pick how at the top of the Scrum poker tab:
   - "Screen share: I enter each vote" (the default). Sprint Room
     shows who to ask next. Ask that person for their card and
     click it. Cards stay face down on the shared screen so nobody
     is swayed by earlier votes. Use "Skip" for anyone absent.
   - "Everyone votes on their own device". Teammates open the
     Invite team address and pick their own card.
3. Press "Reveal cards". Sprint Room shows every vote and the
   average, which becomes the story's points. You can switch to
   the nearest card instead, then press "Save".


RETROSPECTIVE EXCEL REPORT
--------------------------
At the end of the retrospective, press "Finish retrospective &
download Excel" on the Retrospective tab. You get an .xlsx file
with these sheets:
  Summary, Retro notes, Action items, Story estimates, Team
"Excel report, all sprints" gives the same report covering every
sprint. The file lands in your Downloads folder.


YOUR DATA
---------
Everything is stored in sprint-room-data.json next to
SprintRoom.exe. (If that folder is read-only, it goes to
%APPDATA%\SprintRoom instead. The black window shows the exact path.)

 - Back up: click "Download backup" at the bottom of the page,
   or copy sprint-room-data.json.
 - Move to a new computer: copy SprintRoom.exe and
   sprint-room-data.json into the same folder there.
 - Start fresh: close Sprint Room and delete sprint-room-data.json.
   The next start loads the sample team again, and the banner at
   the top lets you remove it.

Anyone who can open the address can view and edit the team's data,
so only run Sprint Room on a network you trust (your office or VPN),
not on public Wi-Fi.


TROUBLESHOOTING
---------------
Teammates can't connect
  - Make sure they're on the same network or VPN as you.
  - Try the other addresses listed under "Invite team".
  - Allow SprintRoom.exe through Windows Defender Firewall:
    Start > "Allow an app through Windows Firewall" >
    Change settings > Allow another app > pick SprintRoom.exe >
    tick Private.

"Ports are all in use"
  Sprint Room is probably already running. Look for its black
  window, or end SprintRoom.exe in Task Manager.

Use a different port (advanced)
  Run from Command Prompt:  SprintRoom.exe -port 8080
  Other options:  -data "D:\team\data.json"   -no-browser
