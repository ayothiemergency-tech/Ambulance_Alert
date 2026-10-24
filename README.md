# Ambulance Alert System - Unit 1 control room

A live emergency-response console: vehicle GPS on a map, nearest real hospitals, dispatch,
instruments, a mirror of the vehicle's LCD, subsystem status and road clearance alerts.
Static website (no build step) hosted on Vercel, data in Firebase Realtime Database (free plan).

## Deploy - three steps, once

### 1. Put your Firebase config in ONE file
Open `public/js/firebase-config.js`. In the Firebase console go to the gear icon, Project settings,
General, Your apps, your web app, "Config". Copy each value into the file.
Make sure `databaseURL` is filled in (Realtime Database > Data tab shows it at the top, for example
`https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app`).
If anything still says PASTE, the website shows a yellow notice telling you so.

### 2. New GitHub repository
1. github.com > New repository (any name, for example `ambulance-console`) > Create.
2. On your computer open the unzipped folder and select EVERYTHING inside it (Ctrl+A).
3. On the repository page click "uploading an existing file" and DRAG the selected items onto the page.
   Drag them, do not use "choose your files": dragging keeps the folders.
4. Before you commit, check the list shows paths like `public/js/app.js` and `public/css/style.css`.
5. Commit changes.

### 3. Vercel
vercel.com > Add New > Project > import the NEW repository > leave everything as it is > Deploy.
(`vercel.json` already points Vercel at the `public` folder and `package.json` selects Node 24.)
Import it as a NEW project. Do not add it to any other project.

## Database
Nothing to change. The rules you already published (`database.rules.json`) allow everything this site uses.
If you ever need them again: Firebase console > Realtime Database > Rules > paste that file > Publish.
`docs/DATABASE.md` describes exactly what the vehicle firmware must write and read.

## Notes
- Hospital search and the lane/bearing alert run inside the open dashboard tab, so no paid plan is needed.
  Keep a tab open while an emergency is running.
- The site is a demonstration. In a real emergency call 108.
