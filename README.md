# UORRT dispatch bot

Standalone Discord dispatch bot for Utah Off Road Recovery Team volunteers. A requester's call for help is posted to a test or production Discord server by an intake assistant named Ranger. Volunteers respond from Discord. The bot records who is going, closes the recovery, and links each volunteer to UORRT's existing after-action and mileage Google Forms.

This Worker does not use the uorrt.org app, its Supabase database, its `/dispatch` board, or Pushover. It does not run a Discord gateway and it does not stay connected. Discord sends HTTP interactions to the Worker. State lives in Cloudflare D1. A Google Sheet receives a copy of claims and outcomes; if that copy fails, Discord still works.

People are called volunteers or responders in every message the bot sends.

## Architecture

```text
Ranger  --HMAC-->  POST /intake
                      |
                      v
Discord  --Ed25519--> POST /interactions     Cloudflare Worker (src/index.ts)
                      |                              |
                      v                              v
                 #recoveries                     D1 (source of truth)
                 public message                  recoveries, responders,
                 + private thread                idempotency, sheet outbox
                      |
                      v
                 Google Sheet (Claims, Outcomes) via a service-account JWT
                 Existing AAR form + existing mileage form (links only)
```

| Path | Role |
| --- | --- |
| `src/index.ts` | Worker entry: `/health`, `/intake`, `/interactions`, and the scheduled hook |
| `src/intake.ts` | Ranger authentication, validation, photo intake |
| `src/interactions.ts` | Discord signature check and button / slash-command routing |
| `src/recoveryFlow.ts` | Create a recovery, record responders, close out |
| `src/messages.ts` | Public post vs private thread text |
| `src/discordVerify.ts` | Ed25519 check for Discord |
| `src/discordApi.ts` | Discord REST calls |
| `src/photos.ts` | Download or accept images and stay inside Discord's file limits |
| `src/prefill.ts` | Prefilled links to the existing Google Forms |
| `src/googleJwt.ts`, `src/googleSheets.ts`, `src/sheetLog.ts` | Sheet append, with an outbox when Google fails |
| `src/scheduled.ts` | Retry the outbox. `escalationHook` is intentionally empty in v1 |
| `src/db.ts`, `migrations/0001_init.sql` | D1 schema and queries |
| `scripts/register-commands.ts` | Registers the `/recovery` slash command |
| `wrangler.toml` | Worker config with placeholder ids |
| `.dev.vars.example` | Local secret template. Copy to `.dev.vars` (gitignored) |

There is no 15-minute escalation in v1. The scheduled handler in `src/scheduled.ts` retries failed Sheet rows and then calls `escalationHook`, which returns without doing anything. That function is where a later change can look for open recoveries that still have no responders.

Responders paste Glympse links in the private thread themselves. The bot does not read or store live location.

## What Discord shows

The public message in `#recoveries` contains only:

- the recovery id
- the requester's name
- coordinates and a Google Maps link
- the photos, attached as files
- who is going
- **I'm responding** and **Can't make it**

Phone, injuries, vehicle, situation, and county are posted only in a private thread on that message. **I'm responding** adds that volunteer to the thread, including someone who responds later, and refreshes the list. Clicking it again does not add them twice. **Can't make it** records the volunteer and removes them from the thread if they had joined.

**Close out** is on the thread message. A volunteer who is marked as responding can use it, and so can anyone with the configured coordinator role. The outcome is one of: recovered, cancelled, declined, or referred to tow. The thread then gets:

- one prefilled link to UORRT's existing after-action Google Form (recovery id, Denver date, responders)
- one prefilled link to UORRT's existing mileage Google Form for each responding volunteer (recovery id, Denver date, volunteer name)

Those forms are not built by this bot. v1 only fills links to forms that already exist.

`/recovery` replies with the same public summary and does not reveal the private fields.

## Privacy and photos

D1 is the source of truth and stores the private fields. The Sheet log does not. Claims are time, recovery id, Discord user id, volunteer name, and status. Outcomes are time, recovery id, outcome, who closed it, the responding names, and the recovery date.

Discord allows 10 files on a message. The default limit here is 10 files, 10 MB each, and 25 MB combined. Extra or unusable photos are listed in the private thread, not on the public post. Only `https` images are fetched. Redirects are not followed. Local and private-network addresses are rejected. A photo that cannot be attached does not stop the recovery from being posted.

## Local checks

```bash
npm install
npm test
npm run typecheck
npm run lint
```

`npm test` uses Vitest with an in-memory SQLite stand-in for D1. Discord and Google are mocked. The test setup refuses any other network call. Nothing in the test suite deploys a Worker or contacts a live Discord server or Google account.

## Setup Vernon needs to do

Do these on a Discord **test** server first. Do not point the interactions URL at a production server until the test server behaves the way you want. Real server ids, form ids, and secrets stay out of git while this repository is public. Put them in Wrangler secrets or in the gitignored `.dev.vars` file.

### 1. Create a Discord test server

Create a new server in the Discord app, used only for this bot. Add a standard text channel named `#recoveries`. Private threads have to be allowed for the bot on that channel. A forum channel will not work with this flow.

Copy the channel id (Discord Developer Mode: right-click the channel, Copy Channel ID). You will store it as `RECOVERIES_CHANNEL_ID`. Do not commit it.

Create a role for coordinators, for example `Recovery coordinator`. Give that role **Manage Threads** on `#recoveries` so a coordinator can open private threads and press **Close out** without personally responding. Copy the role id into `COORDINATOR_ROLE_ID`.

Volunteers who should see requests need access to view `#recoveries`. Only people the bot adds, plus people who can manage threads, can read the private thread.

### 2. Create the application and bot

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. New Application. This can be a test application, separate from any production bot.
2. Open **Bot** and add a bot user. Reset and copy the bot token once. That value is `DISCORD_BOT_TOKEN`.
3. Leave privileged intents off. This bot has no gateway connection, so it does not need the message content intent.
4. Copy the Application ID. That value is `DISCORD_APPLICATION_ID`.
5. On **General Information**, copy the Public Key. That value is `DISCORD_PUBLIC_KEY`.

### 3. Secrets to store with `wrangler secret put`

From this directory, after `npx wrangler login`, set these names. The command prompts for the value. Do not put the values in the shell history if you can avoid it, and never commit them.

Required:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put RANGER_SHARED_SECRET
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
```

`GOOGLE_SERVICE_ACCOUNT_JSON` is the entire JSON key file on one line. Keep the `\n` escapes inside `private_key` that Google puts in that file.

While the repo is public, also store the real identifiers as secrets so they override the placeholders in `wrangler.toml` and are not committed:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put RECOVERIES_CHANNEL_ID
npx wrangler secret put COORDINATOR_ROLE_ID
npx wrangler secret put SHEET_ID
npx wrangler secret put AAR_FORM_ID
npx wrangler secret put AAR_ENTRY_RECOVERY_ID
npx wrangler secret put AAR_ENTRY_DATE
npx wrangler secret put AAR_ENTRY_RESPONDERS
npx wrangler secret put MILEAGE_FORM_ID
npx wrangler secret put MILEAGE_ENTRY_RECOVERY_ID
npx wrangler secret put MILEAGE_ENTRY_DATE
npx wrangler secret put MILEAGE_ENTRY_VOLUNTEER
```

For local `wrangler dev` and `npm run register-commands`, copy `.dev.vars.example` to `.dev.vars` and fill the same names there. `.dev.vars` is gitignored.

`RANGER_SHARED_SECRET` should be a long random string (at least 16 characters). The Worker rejects empty values and values that still start with `replace-`.

### 4. Create the D1 database

```bash
npx wrangler d1 create uorrt-dispatch
```

Wrangler prints a database id. Put that id in the `database_id` field of `wrangler.toml` only in a private copy, or keep the committed file on the placeholder `00000000-0000-0000-0000-000000000000` and pass the real id another way you are comfortable with. Do not commit a production database id to a public repo.

Apply the migration to the database you just created (remote test database, not a production database):

```bash
npx wrangler d1 migrations apply uorrt-dispatch --remote
```

Use `--local` instead while you are only running `wrangler dev` on your machine.

### 5. Deploy to a test Worker URL, only after you approve it

This repository does not deploy anything by itself. When you are ready to try it on the test server:

```bash
npx wrangler deploy
```

Wrangler prints a `*.workers.dev` URL. Use that test URL. Do not add a custom domain or a production route in `wrangler.toml` until you mean to.

There is no `npm run deploy` script, so a test run cannot deploy by accident.

### 6. Set the Interactions Endpoint URL

In the Developer Portal, open the application, then **General Information** (or the Interactions Endpoint URL field on the application page). Set:

```text
https://<your-test-worker>.workers.dev/interactions
```

Discord sends a ping as soon as you save. The Worker must answer it. If verification fails, the public key secret does not match the application.

Ranger posts intakes to:

```text
https://<your-test-worker>.workers.dev/intake
```

A health check, with no secrets in the response, is:

```text
https://<your-test-worker>.workers.dev/health
```

### 7. Invite URL

Replace `YOUR_APPLICATION_ID` with the application id. Do not commit the filled-in URL if the repository is public.

```text
https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=360777370624&scope=bot%20applications.commands
```

That permission integer is the combination of:

| Permission | Bit |
| --- | --- |
| View Channel | 1024 |
| Send Messages | 2048 |
| Embed Links | 16384 |
| Attach Files | 32768 |
| Read Message History | 65536 |
| Manage Threads | 17179869184 |
| Create Private Threads | 68719476736 |
| Send Messages in Threads | 274877906944 |

The scopes are `bot` and `applications.commands`. Open the URL, choose the **test** server, and authorize.

Then register the slash command. Set `DISCORD_GUILD_ID` to the test server id in `.dev.vars` so the command appears immediately on that server:

```bash
npm run register-commands
```

The only command is `/recovery`, which takes a recovery id and shows the public summary.

### 8. Channel id and coordinator role id

| Name | Where it comes from |
| --- | --- |
| `RECOVERIES_CHANNEL_ID` | The `#recoveries` text channel on the test server |
| `COORDINATOR_ROLE_ID` | The coordinator role that may close a recovery without being one of the responders |

Store both with `wrangler secret put` as shown above. The committed `wrangler.toml` keeps the placeholders `REPLACE_WITH_RECOVERIES_CHANNEL_ID` and `REPLACE_WITH_COORDINATOR_ROLE_ID`.

### 9. Ranger shared secret

Generate a long random string and store it as `RANGER_SHARED_SECRET` (step 3). Give the same value to the Ranger intake assistant. Ranger signs every request:

- Header `X-Ranger-Timestamp`: unix time in seconds
- Header `X-Ranger-Signature`: lowercase hex HMAC-SHA256
- Signed bytes: the timestamp, a `.`, then the **raw** request body (the exact bytes on the wire, including multipart bytes)

The Worker rejects timestamps more than `REPLAY_WINDOW_SECONDS` away from its clock (default 300). Discord interaction signatures use a different scheme (Ed25519 over timestamp + body, with no dot) and the same window.

Each intake JSON body needs `idempotencyKey` (8 to 120 characters, letters, digits, `_`, `-`). Retries with the same key return the original recovery and do not post a second Discord message. A `409` means that key is already being processed; retry shortly.

```json
{
  "idempotencyKey": "ranger-example-001",
  "requesterName": "Jordan Lee",
  "phone": "5555550100",
  "lat": 40.45,
  "lon": -111.5,
  "injuries": "None reported",
  "vehicle": "Jeep",
  "situation": "High-centered on a rock",
  "county": "Utah",
  "photoUrls": ["https://example.com/scene.jpg"]
}
```

Uploads use `multipart/form-data` with a `payload` field containing that JSON and one or more `photos` files. The signature still covers the raw multipart body. `src/intakeAuth.ts` (`signRangerBody`) is the reference implementation.

### 10. Google service account, Sheet, and tab names

1. In Google Cloud, create a service account for this bot. Create a JSON key. Store the file contents as `GOOGLE_SERVICE_ACCOUNT_JSON`.
2. Create a Google Sheet for the log. Copy the id from the sheet URL (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`). Store it as `SHEET_ID`.
3. Share the sheet with the service account email (`client_email` in the JSON key) as **Editor**.
4. Add two tabs, unless you change the names in configuration:

| Tab | Config name | Default | Columns the bot appends |
| --- | --- | --- | --- |
| Claims | `SHEET_CLAIMS_TAB` | `Claims` | time (UTC), recovery id, Discord user id, volunteer name, status (`responding` or `cant_make_it`) |
| Outcomes | `SHEET_OUTCOMES_TAB` | `Outcomes` | time (UTC), recovery id, outcome, closed-by Discord user id, closed-by name, responding names, recovery date (`America/Denver`) |

Put a header row in each tab yourself. The bot appends data rows only.

If Google is down or the key is wrong, the Discord buttons still succeed. The failed row is stored in the D1 table `sheet_outbox` and the scheduled trigger (`*/10 * * * *`) retries it up to 8 times.

### 11. Where the AAR and mileage form ids go

Do not build a new after-action form or a mileage form. Use the forms UORRT already has.

The id in a prefilled link is **not** the id in the form editor URL. Open the form's send / prefill link. It looks like:

```text
https://docs.google.com/forms/d/e/<FORM_ID>/viewform
```

`<FORM_ID>` is what the Worker expects.

In the form UI, use **Get pre-filled link**, fill one field, and copy the generated URL. Each field has an `entry.<number>` query parameter. Those numbers are the entry ids.

| Config name | What it is |
| --- | --- |
| `AAR_FORM_ID` | Existing after-action form id from `/d/e/<id>/viewform` |
| `AAR_ENTRY_RECOVERY_ID` | Entry id for the recovery id |
| `AAR_ENTRY_DATE` | Entry id for the date |
| `AAR_ENTRY_RESPONDERS` | Entry id for the responding volunteers |
| `MILEAGE_FORM_ID` | Existing mileage form id |
| `MILEAGE_ENTRY_RECOVERY_ID` | Entry id for the recovery id |
| `MILEAGE_ENTRY_DATE` | Entry id for the date |
| `MILEAGE_ENTRY_VOLUNTEER` | Entry id for the volunteer name |

Store them with `wrangler secret put` (step 3). The committed placeholders start with `REPLACE_WITH_`. Until they are replaced, close-out still runs and the thread says the links are placeholders.

The link builder is `buildGoogleFormPrefillUrl` in `src/prefill.ts`. A close-out link looks like:

```text
https://docs.google.com/forms/d/e/<FORM_ID>/viewform?usp=pp_url&entry.<FIELD>=<value>
```

## Commands you will run

```bash
npm install
cp .dev.vars.example .dev.vars
npm test
npm run typecheck
npm run lint
npx wrangler d1 migrations apply uorrt-dispatch --local
npx wrangler dev
npm run register-commands
```

`wrangler dev` serves the Worker on your machine. `register-commands` talks to Discord only when you run it, using the token in the environment.

## Limitations

- Tests exercise the SQL against Node's SQLite, not the Cloudflare D1 runtime. The statements are ordinary SQLite that D1 accepts.
- Photo URL checks block private addresses and redirects. They do not resolve DNS, so a public hostname that points at an internal address is not fully covered.
- A crash in the moment after Discord accepts the public message and before D1 stores the message id can leave a duplicate if Ranger retries. The idempotency key covers the normal retry case.
- Escalation after 15 minutes with no responders is not implemented. Add it in `escalationHook` in `src/scheduled.ts`.
- The bot does not track location, call tow companies, or write an after-action report. It only links to the existing forms.
