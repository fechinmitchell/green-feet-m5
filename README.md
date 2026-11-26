# Green Feet

Learn AimPoint-style green reading with two M5StickC Plus sensors clipped to your shoes.
Straddle the line, press the button on a stick, and the phone shows the slope, which way
it breaks, and how many fingers to aim. In Learn mode you guess first, so your feet get trained.

| Folder | What it is |
| --- | --- |
| `firmware/` | Stick code (Arduino / PlatformIO). Streams tilt + button presses over Bluetooth. |
| `frontend/` | React + Vite web app. Runs in **Bluefy** on iPhone (Safari has no Bluetooth). Works with no Wi-Fi once loaded. |
| `.github/workflows/firmware.yml` | Builds the stick code on every push and drops it in `frontend/public/firmware/`. |

Putts are saved on the phone for now. A Node + Postgres backend can be added later to sync history.

## How a reading works

1. **Calibrate** once per round: stand still → lift your toes → turn 180° on the same spot.
   Turning around cancels both the slope you stood on and how crooked each stick is mounted.
   Lifting the toes tells the app which way the toe points, so the sticks can be mounted at any angle.
2. **Guess** at the ball (Learn mode).
3. **Measure** at halfway, straddling the line facing the hole. Long or double-breaking putts:
   take two readings (ball half, hole half); the hole end counts for 2/3.
4. **Aim**: 1 finger per 1% on a medium green (stimp ~10), scaled for green speed and
   nudged for uphill/downhill. All of these are tunable in Settings → Fine-tuning.

The maths is in `frontend/src/lib/slope.js` and is tested against simulated crooked mounts
(`npm test` in `frontend/`).

## Run it

```bash
cd frontend
npm install
npm run dev
```

Open the address it prints. Use **Try Demo mode** on the Connect screen to use it without sticks.

## Deploy (Vercel)

New project → import this repo → **Root Directory: `frontend`**. Vite is detected automatically.
Open the Vercel address in **Bluefy** on your iPhone.

## Program the sticks

From a computer with **Chrome or Edge**: open `<your site>/admin`, plug a stick in by USB-C,
click **Install**. Then pair it in the app and choose Left or Right.

Alternative: `cd firmware && pio run -t upload` with PlatformIO installed.
