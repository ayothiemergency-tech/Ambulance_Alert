# Database contract (Firebase Realtime Database)

Everything lives under `ambulance/unit1/`. The website already reads and writes exactly this.
Your ESP32 firmware only has to follow it. No changes are needed in the Firebase console:
the rules in `database.rules.json` already allow every path below.

## The vehicle (ESP32) writes

`telemetry` - about once per second
| field | type | meaning |
|---|---|---|
| lat, lon | number | GPS position (omit or null with no fix) |
| heading | number | degrees 0-359 (0 = north) |
| speed | number | km/h |
| sats | number | satellites in use |
| gpsOk | boolean | true only with a valid fix |
| motorOn | boolean | true while the drive motors run |
| lastSeen | server timestamp | `{".sv":"timestamp"}`; the website shows the vehicle online if this is < 7 s old |

`diagnostics` - optional, written when something changes. Each entry is `{status, detail}`
where status is `"ok"`, `"warn"` or `"fail"` and detail is a short text (max 28 characters).
- `gps`, `lora`, `drive`, `display`  -> the four lamps in "Vehicle subsystems"
- `buttons` = `{b1:bool, b2:bool, b3:bool}` -> the three key lamps, true while pressed

`control/arrived` - when the vehicle reaches the hospital (within 40 m) it writes
`control = {emergency:false, confirmedHospital:null, selectedIndex:0, listId:0, arrived:{hospName:"...", at:<ms>}}`
and stops its motors. The website then shows ARRIVED until someone presses Reset.

## The vehicle (ESP32) reads

`control`
| field | meaning |
|---|---|
| emergency | true = an emergency is active |
| listId | identifies this emergency (a number below 2,000,000,000) |
| selectedIndex | highlighted hospital, 0-3 |
| confirmedHospital | `{hospIndex, hospName, hospLat, hospLon, hospLcd}`; when present, drive there at full speed. `hospLcd` is plain ASCII for the 16x2 display |

`hospitals` = `{listId, source, list:[{name, lcd, city, lat, lon, emergency, distance}]}` - written by the website
(the first open dashboard tab) for the current `listId`. Use `lcd` for the display.

Vehicle buttons write `control/selectedIndex` (keys 2 and 3), `control/confirmedHospital` (key 1 in the
selection step), and start the emergency by writing `control` like the website does (key 1 on standby).

## Other paths
- `nearbyVehicles/<id>` = `{label, lat, lon, heading}` - other vehicles being tracked.
- `direction` - written by the website: the lane and bearing filter result for each tracked vehicle.
