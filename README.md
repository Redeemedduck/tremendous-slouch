# Golf Group Coordinator

A small shared web app for a golf group to post tee times and claim spots.
Built for a thread of ~12-15 friends who got tired of losing track of who's
playing what when in a group SMS.

Anyone can post a tee time (course, date, time, # of spots, optional notes).
Anyone can claim or drop a spot. Everyone sees the same up-to-date list. No
auth — group is trusted, honor system.

## Run locally

Prerequisites: Node.js 20+.

```
npm install
npm run dev
```

Then open http://localhost:3000 on your phone or browser.

The server uses a local SQLite file (`golf_coordinator.db`) created on first
run. Delete that file to reset state.
