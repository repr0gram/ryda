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
3. **Enable Developer Mode on the phone** — Settings → Privacy & Security →
   Developer Mode → on, then let it restart. The entry only appears after the
   phone has been connected to Xcode once. Until this is on, the device shows as
   `connected (no DDI)` in `make devices` and no build can reach it.
4. **Plug the phone in and unlock it.** Provisioning cannot be prepared ahead of
   the cable: Apple issues a profile against registered devices, so with none
   registered the build fails with *"Your team has no devices"*. Note that this
   is also what you get when the phone is connected but the build targets
   `generic/platform=iOS` — a generic destination never tells Xcode which device
   to register, which is why `make device` targets the connected one by id.
5. `make device`, or hit Run in Xcode with the phone selected.
6. On the phone, **Settings → General → VPN & Device Management** → trust the
   developer certificate. The app will refuse to launch until you do.

`make devices` shows what this Mac can see, and is the first thing to check when
a device build fails for a reason that is not the code.

### What to expect on a free Apple ID

- **The build expires after 7 days** and the app stops launching. Re-run
  `make device` to renew it. A paid account extends this to a year.
- **App Groups turned out to be granted.** This was expected to be the thing
  that broke — the widget is a separate process and reaches the token through a
  shared keychain group, and App Groups is widely described as paid-only. On a
  free personal team here, Apple issued a profile carrying both
  `com.apple.security.application-groups` and `keychain-access-groups`, and both
  are signed onto the app and the extension. Verify on any new setup with:

  ```bash
  codesign -d --entitlements - \
    ios/build-device/Build/Products/Debug-iphoneos/Ryda.app/PlugIns/RydaWidgetExtension.appex
  ```

  If a future profile does drop them, the widget says **"Can't reach your
  session"** rather than "Sign in", specifically so that case is
  distinguishable from being signed out. That message means the entitlement,
  not your credentials.

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
