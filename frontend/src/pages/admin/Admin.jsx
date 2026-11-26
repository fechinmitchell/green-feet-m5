import { useEffect, useState } from 'react';
import { useHub, useStore } from '../../hooks.js';
import { store } from '../../lib/store.js';
import { connLog } from '../../ble/hub.js';

// Programs the M5Sticks straight from the browser over USB (Web Serial).
// Works in Chrome or Edge on a computer. The firmware file is built by GitHub
// Actions (.github/workflows/firmware.yml) into /firmware/.

export default function Admin() {
  const hub = useHub();
  const { putts } = useStore();
  const [manifest, setManifest] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const serial = typeof navigator !== 'undefined' && 'serial' in navigator;

  useEffect(() => {
    fetch('/firmware/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setManifest)
      .catch(() => setManifest(null))
      .finally(() => setLoaded(true));
    if (serial) import('esp-web-tools');
  }, [serial]);

  const exportHref = `data:application/json;charset=utf-8,${encodeURIComponent(store.exportJson())}`;

  return (
    <div className="stack">
      <h1>Admin</h1>

      <section className="card">
        <h2>Update sticks</h2>
        <p>
          Latest stick software: <b>{manifest ? `v${manifest.version}` : loaded ? 'not built yet' : '…'}</b>
        </p>
        {hub.connected
          .filter((s) => s.kind === 'real')
          .map((s) => (
            <p key={s.id} className="mono">
              {s.side} · {s.id} runs v{s.fw} {manifest && s.fw !== manifest.version ? '→ update available' : '✓ up to date'}
            </p>
          ))}

        {!serial ? (
          <div className="note warn">
            Programming sticks needs <b>Chrome or Edge on a computer</b> (your MacBook is fine). It doesn’t work on iPhone or in Safari.
          </div>
        ) : !manifest ? (
          <div className="note">The stick software hasn’t been built yet. It’s built automatically when the code is pushed to GitHub.</div>
        ) : (
          <>
            <ol className="howto">
              <li>Plug one stick into the Mac with its USB-C cable.</li>
              <li>
                Click <b>Install</b>, pick the port that appears (often <span className="mono">usbserial</span>) and wait about a minute.
              </li>
              <li>Unplug it and do the other stick.</li>
              <li>On your phone, connect both and tell the app which foot each is on.</li>
            </ol>
            <esp-web-install-button manifest="/firmware/manifest.json">
              <button slot="activate" className="btn primary big">
                Install v{manifest.version} on a stick
              </button>
            </esp-web-install-button>
          </>
        )}
        <details>
          <summary>Stick not showing up?</summary>
          <p>
            Try a different USB-C cable (some only charge). If Chrome still doesn’t list a port, install the USB driver for the stick’s chip from M5Stack’s download page (docs.m5stack.com → Download → “CH9102 driver” for macOS), then restart Chrome.
          </p>
        </details>
      </section>

      <section className="card">
        <h2>Connection log</h2>
        <p className="hint">Latest first. Useful if sticks keep dropping. Send me a screenshot.</p>
        {connLog.length ? (
          <ul className="list mono">
            {connLog.slice(0, 30).map((e, i) => (
              <li key={i}>
                {new Date(e.t).toLocaleTimeString()} · {e.stick} · {e.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Nothing yet in this session.</p>
        )}
      </section>

      <section className="card">
        <h2>Data</h2>
        <p>{putts.length} putts saved on this device.</p>
        <a className="btn" href={exportHref} download="green-feet-putts.json">
          Download putts (JSON)
        </a>
        {!confirmClear ? (
          <button className="btn ghost" onClick={() => setConfirmClear(true)}>
            Delete all putts…
          </button>
        ) : (
          <div className="row-between">
            <span>Delete {putts.length} putts? This can’t be undone.</span>
            <div className="row">
              <button className="btn ghost" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  store.clearPutts();
                  setConfirmClear(false);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
