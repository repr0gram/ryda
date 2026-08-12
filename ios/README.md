# Ryda for iOS

A SwiftUI app and a WidgetKit extension against the same API the website uses.
Read-only over the network: rides are imported and analysed on the web app, and
this reads what the server computed.

Nothing here re-implements the power model. Watts, metrics and zones all arrive
already computed from `/api/rides/:id/streams?include=power`, because two
implementations of that physics would disagree within a month — see the note at
the top of `src/app/api/summary/route.ts`.

## Layout

| | |
|---|---|
| `RydaKit/` | Swift package: API client, models, stream decoding, keychain, palette. Builds and tests on macOS in about a second, with no simulator. Nothing in it may import UIKit, MapKit or WidgetKit. |
| `Ryda/` | the app |
| `RydaWidget/` | the widget extension |
| `project.yml` | the project. `Ryda.xcodeproj` is generated from it and gitignored. |

## Simulator

```bash
make bootstrap     # xcodegen + the iOS runtime, once
make run
```

`make test` runs the RydaKit suite. It needs no simulator and takes about a
second, which is the whole reason the shared code is a package.

## On your iPhone

Signing lives in `Local.xcconfig`, which is gitignored so it survives
`xcodegen generate` — Xcode's UI does not, because the project is regenerated.

1. **Sign in to Xcode** — Settings → Accounts → add your Apple ID. Without this
   every build fails with *"No Account for Team"*.
2. `cp Local.xcconfig.example Local.xcconfig` and set `DEVELOPMENT_TEAM`. Find
   it with:
   ```bash
   security find-certificate -c "Apple Development" -p \
     | openssl x509 -noout -subject | tr ',' '\n' | grep OU=
   ```
   Note that the id in the certificate's *name* is your user id, not the team —
   the team is the `OU`.
3. **Plug the phone in and unlock it.** Provisioning cannot be prepared ahead of
   the cable: Apple issues a profile against registered devices, so with none
   registered the build fails with *"Your team has no devices"*.
4. `make device`, or just hit Run in Xcode with the phone selected.
5. On the phone, **Settings → General → VPN & Device Management** → trust the
   developer certificate. The app will refuse to launch until you do.

### What to expect on a free Apple ID

- **The build expires after 7 days** and the app stops launching. Re-run
  `make device` to renew it. A paid account extends this to a year.
- **The widget may not be able to read your session.** It is a separate process
  and reaches the token through a shared keychain group, which needs the App
  Group entitlement — generally a paid-account capability. The Simulator does
  not enforce this, so it works there regardless.

  If it fails, the widget says **"Can't reach your session"** rather than
  "Sign in", specifically so this is distinguishable from being signed out. That
  message means the entitlement, not your credentials, and no amount of signing
  in will change it. The fix is a paid account, not code.

## Verifying against the real API

```bash
RYDA_LIVE=1 RYDA_TOKEN=<session token> swift test --package-path RydaKit
```

Drives every endpoint the app touches and decodes a real ride's streams. Gated
behind `RYDA_LIVE` so it never runs in the normal suite. Get a token from a
sign-in response:

```bash
curl -s -X POST https://ryda-nine.vercel.app/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}' | jq -r .token
```

## Debug affordances

`simctl` cannot tap a screen and the system puts a confirmation in front of deep
links, so driving the app for screenshots needs a way in that is not a gesture.
All three are inside `#if DEBUG` and cannot be reached from a Release build.

```bash
xcrun simctl launch booted com.fadi.ryda \
  -RydaDebugToken "<session token>" \
  -RydaDebugRide  "<ride id>" \
  -RydaDebugTab   1
```
