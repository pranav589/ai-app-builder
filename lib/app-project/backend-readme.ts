// README section for a ZIP/GitHub export of an app connected to CloudHike.
export const BACKEND_README = `
## Backend (CloudHike)

This app stores its data, sign-ups and uploaded files in a CloudHike project. The app never connects to the database itself: a database password inside a phone app could be pulled out of the app by anyone who installs it. Instead the app calls a small server that holds the credentials. You have two ways to run that server.

\`lib/backend/config.ts\` decides which one the app uses.

### Option A: keep using the hosted backend (default)

The app was exported pointing at the server it was built with. Nothing to set up:

1. \`npm install\`
2. \`npx expo start\`

Good to know:

- If the builder was running on your own computer when you exported, that address is your computer's network IP (see \`API_URL\` in \`lib/backend/config.ts\`): the app only reaches it from a phone on the same Wi-Fi, while the builder is running.
- It works for as long as that server is online and the app is still connected to CloudHike in the builder. If you disconnect the backend there, the key below stops working and the app shows errors.
- \`lib/backend/config.ts\` contains the app's key for that server. It's not a password (every installed copy of the app carries it) and it can only do what the app itself can do, but if you push this project to a public repository, anyone can read it. To revoke it, disconnect and reconnect the backend in the builder, then export again.
- Your CloudHike database may be asleep after being idle, so the first request can take a few seconds.

### Option B: run your own server

You'll run the server in \`server/\`, which uses your own CloudHike credentials. Nothing depends on the builder after this.

**1. Get your CloudHike values.** Open your CloudHike dashboard, open the project this app uses, and go to its environment settings. You need: \`DATABASE_URL\`, \`DIRECT_URL\`, \`AUTH_URL\`, \`AUTH_PUBLISHABLE_KEY\`, and the \`S3_*\` values (endpoint, bucket, access key id, secret access key).

**2. Install the server** (needs Node 20.6 or newer):

\`\`\`bash
cd server
npm install
\`\`\`

**3. Create \`server/.env\`.** Copy \`server/.env.example\` to \`server/.env\` and fill in:

- the CloudHike values from step 1;
- \`APP_KEY\`: any long random string, for example the output of \`openssl rand -base64 24\`;
- \`PUBLIC_URL\`: the address your phone will use to reach the server, such as \`http://192.168.1.20:3001\` (your computer's network IP, not \`localhost\`, which on a phone means the phone itself).

\`.env\` files are in \`.gitignore\`. Never commit them.

**4. Start the server:**

\`\`\`bash
npm run dev
\`\`\`

You should see "Database tables are ready." and "Backend listening on ...". Check it responds by opening \`<PUBLIC_URL>/health\` in a browser. The first start creates this app's tables in your CloudHike database and adds the sample data to empty ones.

If it doesn't start: "DATABASE_URL is not set" means \`server/.env\` is missing or in the wrong folder. A database timeout usually means the CloudHike database was asleep, so wait a few seconds and start again.

**5. Point the app at your server.** Back in the project root, copy \`.env.example\` to \`.env\`, remove the \`#\` from the two lines and set:

\`\`\`
EXPO_PUBLIC_API_URL=http://192.168.1.20:3001/data
EXPO_PUBLIC_APP_KEY=<the same value as APP_KEY in server/.env>
\`\`\`

The URL must end in \`/data\`. On an Android emulator the computer is \`10.0.2.2\` instead of its network IP.

**6. Run the app:**

\`\`\`bash
npm install
npx expo start --clear
\`\`\`

\`--clear\` matters: Expo only picks up \`EXPO_PUBLIC_\` changes after the cache is cleared.

**7. Release it.** A server on your computer only works while it's running and your phone is on the same network. For an APK or a store release:

1. Deploy \`server/\` to any Node host (Railway, Render, Fly.io, a VPS). Use \`npm start\` as the start command and set each variable from \`server/.env\` in the host's environment settings (don't upload the file). Set \`PUBLIC_URL\` to the host's public https address.
2. Build the app with \`EXPO_PUBLIC_API_URL=https://your-host/data\` and \`EXPO_PUBLIC_APP_KEY=<APP_KEY>\`. With EAS Build, add them to the build profile's \`env\` in \`eas.json\`, or create them with \`eas env:create\`. A gitignored \`.env\` isn't uploaded to EAS.
3. Rebuild the app whenever the server's address changes, since the address is baked into the build.

Your data stays in your CloudHike project either way, so you can switch between Option A and Option B without losing anything.
`
