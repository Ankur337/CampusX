# CampusX - Campus Repair Board (BBDITM mini project)

## Run
1. Install Node.js 20 or later
2. In this folder run:  npm start      (or: node server.js)
3. Open http://localhost:3000

No `npm install` is needed - only Node.js built-in modules are used.

## Demo logins
- Facilities admin: admin@campusx.local / admin123
- Student: use "Create account" on the sign-in page

## Files
- server.js        Node.js HTTP server + API (register, login, reports, votes, status)
- public/index.html  Frontend (HTML, CSS, JavaScript)
- users.json / data.json  Created automatically on first run (accounts and reports)

To reset all data, stop the server and delete users.json and data.json.
