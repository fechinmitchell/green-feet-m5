// Keeps track of the connected sticks (real or demo) and gives the pages one
// simple interface: who's connected, live tilt, button presses, and a
// "hold still and measure" capture.

import { SERVICE, TILT, EVENT, CMD, INFO, BATT, NAME_PREFIX, parseTilt, parseInfo, parseBatt, dispCommand } from './protocol.js';
import { randomMount, sensorUp, noisy } from '../lib/sim.js';
import { vec } from '../lib/slope.js';

const STILL = 0.025; // g. Below this the foot counts as still (walking is well above 0.1).

class Emitter {
  constructor() {
    this.handlers = {};
  }
  on(evt, fn) {
    (this.handlers[evt] ||= new Set()).add(fn);
    return () => this.handlers[evt].delete(fn);
  }
  emit(evt, ...args) {
    this.handlers[evt]?.forEach((fn) => fn(...args));
  }
}

// Live battery monitor reading: volts, mA, charge counter.
function setPower(p) {
  this.power = { ...p, at: Date.now() };
  this.powerHistory = [...(this.powerHistory || []), this.power].slice(-200); // ~16 min at 5 s
  this.emit('power', this.power);
}

// Battery readings over time, for the "time left" estimate.
function recordBattery() {
  if (this.charging) {
    this.battHistory = [];
    return;
  }
  this.battHistory = [...(this.battHistory || []), { t: Date.now(), pct: this.battery }].slice(-300);
}

// Recent connection events, shown on the Admin page to help troubleshoot.
export const connLog = [];
function logConn(stick, text) {
  connLog.unshift({ t: Date.now(), stick: stick.side !== '?' ? stick.side : stick.id, text });
  connLog.length = Math.min(connLog.length, 60);
}

class RealStick extends Emitter {
  log(text) {
    logConn(this, text);
  }
  constructor(device) {
    super();
    this.kind = 'real';
    this.device = device;
    this.id = device.name?.replace(`${NAME_PREFIX}-`, '') || '????';
    this.side = '?';
    this.fw = '';
    this.battery = null;
    this.charging = false;
    this.connected = false;
    this.latest = null;
    this.queue = Promise.resolve();
    device.addEventListener('gattserverdisconnected', () => this.onDrop());
  }

  recordBattery() {
    recordBattery.call(this);
  }
  setPower(p) {
    setPower.call(this, p);
  }

  async connect() {
    // A napping stick only listens for ~1.5 s at a time, so don't wait forever.
    // The timer is cancelled as soon as the connection is made: it must never
    // be able to hang up a good connection.
    let timer;
    const server = await Promise.race([
      this.device.gatt.connect().finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          this.log('connect timed out');
          try {
            this.device.gatt.disconnect();
          } catch {
            /* ignore */
          }
          reject(new Error('timeout'));
        }, 8000);
      }),
    ]);
    const svc = await server.getPrimaryService(SERVICE);
    this.cmdChr = await svc.getCharacteristic(CMD);
    const info = await svc.getCharacteristic(INFO);
    const parsed = parseInfo(new TextDecoder().decode(await info.readValue()));
    this.fw = parsed.fw || '';
    this.side = parsed.side === 'L' || parsed.side === 'R' ? parsed.side : '?';
    if (parsed.id) this.id = parsed.id;

    // Handlers are created once and re-attached on reconnect, never doubled up.
    this.onTilt ||= (e) => {
      const t = parseTilt(e.target.value);
      if (t.battery !== this.battery || t.charging !== this.charging || t.accurate !== this.accurate) {
        this.battery = t.battery;
        this.charging = t.charging;
        this.accurate = t.accurate;
        this.recordBattery();
        this.emit('change'); // battery gauge in the header updates live
      }
      this.latest = { up: t.up, motion: t.motion, at: performance.now() };
      this.emit('tilt', this.latest);
    };
    this.onEvent ||= (e) => {
      const text = new TextDecoder().decode(e.target.value);
      if (text.charAt(0) === 'S') {
        this.asleep = true; // switched off on purpose (held A)
        this.emit('change');
        return;
      }
      this.emit('button', text.charAt(0));
    };
    this.onBatt ||= (e) => this.setPower(parseBatt(e.target.value));

    const listen = async (uuid, handler) => {
      const chr = await svc.getCharacteristic(uuid);
      chr.removeEventListener('characteristicvaluechanged', handler);
      chr.addEventListener('characteristicvaluechanged', handler);
      await chr.startNotifications();
    };
    await listen(TILT, this.onTilt);
    await listen(EVENT, this.onEvent);
    // Battery monitor (firmware 1.3.0+). Older sticks just don't have it.
    try {
      await listen(BATT, this.onBatt);
    } catch {
      this.power = null;
    }

    this.connected = true;
    this.log(this.napping ? 'connected (woke from nap)' : 'connected');
    this.napping = false;
    this.asleep = false;
    this.emit('connected');
    this.emit('change');
  }

  async onDrop() {
    this.log(this.napping ? 'napping' : this.asleep ? 'switched off' : 'connection dropped');
    this.connected = false;
    this.emit('change');
    // A napping stick is fine: it comes back when the app needs it.
    if (this.hub?.wanted) this.reconnect();
  }

  /**
   * Keep trying to reach the stick while the app needs it. A napping stick
   * listens for ~1.5 s every 15 s, so this usually connects within 15 s.
   */
  async reconnect() {
    if (this.reconnecting || this.connected || this.closing) return;
    this.reconnecting = true;
    const until = Date.now() + 30 * 60000;
    for (let i = 0; Date.now() < until && !this.closing && !this.connected && (this.hub?.wanted || this.asleep); i++) {
      try {
        await this.connect();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, Math.min(1500, 300 + i * 300)));
      }
    }
    this.reconnecting = false;
  }

  send(text) {
    // GATT allows one operation at a time, so queue writes.
    this.queue = this.queue
      .then(() => {
        if (!this.connected || !this.cmdChr) return;
        const data = new TextEncoder().encode(text);
        return this.cmdChr.writeValueWithoutResponse
          ? this.cmdChr.writeValueWithoutResponse(data).catch(() => this.cmdChr.writeValue(data))
          : this.cmdChr.writeValue(data);
      })
      .catch(() => {});
    return this.queue;
  }

  setSide(side) {
    this.side = side;
    this.emit('change');
    return this.send(`side:${side}`);
  }

  nap() {
    this.log('sent to nap');
    this.napping = true;
    this.emit('change');
    return this.send('nap');
  }

  disconnect() {
    this.closing = true;
    this.device.gatt.disconnect();
  }
}

class DemoStick extends Emitter {
  constructor(side) {
    super();
    this.kind = 'demo';
    this.id = side === 'L' ? 'D001' : 'D002';
    this.side = side;
    this.fw = 'demo';
    this.battery = side === 'L' ? 86 : 74;
    this.charging = false;
    this.ticks = 0;
    this.recordBattery();
    this.connected = true;
    this.mount = randomMount(Math.random, 9);
    this.pose = { cross: 0, along: 0 };
    this.motion = 0.2;
    this.timer = setInterval(() => this.tick(), 50);
  }
  setPose(pose) {
    this.pose = pose;
    this.motion = 0.15; // you just moved
  }
  recordBattery() {
    recordBattery.call(this);
  }
  setPower(p) {
    setPower.call(this, p);
  }
  tick() {
    // Fake battery monitor every 5 s: ~45 mA draw, charge counter going down.
    if (this.ticks % 100 === 0) {
      const ma = -(42 + Math.random() * 8);
      this.mah = (this.mah || 0) + (ma * 5) / 3600;
      this.setPower({ v: 3.4 + (this.battery / 100) * 0.75, ma, mah: this.mah, pct: this.battery, charging: false });
    }
    // Drain about 1% every 108 s, like a real stick on power-saving firmware.
    if (++this.ticks % 2160 === 0 && this.battery > 0) {
      this.battery--;
      this.recordBattery();
      this.emit('change');
    }
    this.motion = Math.max(0.003, this.motion * 0.9);
    const up = noisy(sensorUp(this.mount, this.pose.cross, this.pose.along), 0.0015 + this.motion * 0.2);
    this.latest = { up, motion: this.motion, at: performance.now() };
    this.emit('tilt', this.latest);
  }
  send() {
    return Promise.resolve();
  }
  setSide(side) {
    this.side = side;
    this.emit('change');
  }
  pressA() {
    this.emit('button', 'A');
  }
  nap() {}
  disconnect() {
    clearInterval(this.timer);
    this.connected = false;
    this.emit('change');
  }
}

export class Hub extends Emitter {
  constructor() {
    super();
    this.sticks = [];
    this.version = 0;
    this.wanted = 0;
    this.lastDisp = null;
  }

  /**
   * Pages that need live sticks (pairing, calibrating, guessing/measuring) call
   * want() and the returned release() when done. With nobody wanting them, the
   * sticks are sent to nap after a short grace period.
   */
  /** Settings: "let sticks nap between putts" switched off. */
  setKeepAwake(on) {
    if (on === !!this.keepAwake) return;
    this.keepAwake = on;
    if (on) {
      this.release = this.want();
    } else {
      this.release?.();
      this.release = null;
    }
  }

  want() {
    this.wanted++;
    clearTimeout(this.napTimer);
    this.sticks.forEach((s) => s.kind === 'real' && !s.connected && s.reconnect());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.wanted--;
      if (!this.wanted) this.scheduleNap(20000);
    };
  }

  scheduleNap(ms) {
    clearTimeout(this.napTimer);
    this.napTimer = setTimeout(() => {
      if (this.wanted || this.keepAwake) return;
      this.connected.forEach((s) => s.kind === 'real' && s.nap());
    }, ms);
  }

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }
  get demo() {
    return this.sticks.some((s) => s.kind === 'demo');
  }
  get connected() {
    return this.sticks.filter((s) => s.connected);
  }
  bySide(side) {
    return this.sticks.find((s) => s.side === side && s.connected);
  }
  /** A paired stick for this foot, connected or napping. */
  known(side) {
    return this.sticks.find((s) => s.side === side);
  }
  get napping() {
    return this.sticks.filter((s) => !s.connected && s.napping);
  }

  changed() {
    this.version++;
    this.emit('change');
  }

  track(stick) {
    stick.hub = this;
    stick.on('change', () => this.changed());
    stick.on('connected', () => {
      // Back from a nap: show what the phone is showing, and nap again later
      // if nothing needs it (e.g. woken by a press of A).
      if (this.lastDisp) stick.send(this.lastDisp);
      if (!this.wanted && !this.keepAwake) this.scheduleNap(60000);
    });
    stick.on('button', (b) => this.emit('button', b, stick));
    this.sticks.push(stick);
    this.changed();
  }

  async pair() {
    if (!this.supported) throw new Error('This browser has no Bluetooth. On iPhone, open the app in Bluefy.');
    if (this.demo) this.clear();
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: NAME_PREFIX }],
      optionalServices: [SERVICE],
    });
    const existing = this.sticks.find((s) => s.device === device);
    if (existing) {
      if (!existing.connected) await existing.connect();
      return existing;
    }
    const stick = new RealStick(device);
    await stick.connect();
    this.track(stick);
    stick.send('beep:2600,120');
    return stick;
  }

  startDemo() {
    this.clear();
    this.track(new DemoStick('L'));
    this.track(new DemoStick('R'));
  }

  clear() {
    this.sticks.forEach((s) => s.disconnect());
    this.sticks = [];
    this.changed();
  }

  /** Demo only: put both feet on a slope (foot frame, percent). */
  demoPose(pose) {
    this.sticks.forEach((s) => s.kind === 'demo' && s.setPose(pose));
  }
  demoPress() {
    this.sticks.find((s) => s.kind === 'demo')?.pressA();
  }

  display(title, value, sub) {
    const cmd = dispCommand(title, value, sub);
    this.lastDisp = cmd;
    this.connected.forEach((s) => s.send(cmd));
  }
  /** Ask sticks to stream 20x a second (measuring) or 4x (saving battery). */
  fast(on) {
    this.connected.forEach((s) => s.send(on ? 'rate:fast' : 'rate:slow'));
  }

  beep(freq = 3000, ms = 150) {
    this.connected.forEach((s) => s.send(`beep:${freq},${ms}`));
  }

  /**
   * Wait until every connected stick has been still for `seconds`, then return
   * the averaged "up" vector per side. Restarts the window whenever a foot moves.
   * onProgress(fraction 0..1, stillNow) is called as it goes.
   */
  capture({ seconds = 2, timeout = 15, onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const sticks = this.connected;
      if (!sticks.length) return reject(new Error('No sticks connected.'));
      this.fast(true);
      let samples = new Map(sticks.map((s) => [s, []]));
      let start = performance.now();
      const deadline = start + timeout * 1000;
      const offs = [];
      const finish = (err, val) => {
        offs.forEach((o) => o());
        clearInterval(timer);
        err ? reject(err) : resolve(val);
      };
      signal?.addEventListener('abort', () => finish(new Error('cancelled')));

      offs.push(
        ...sticks.map((s) =>
          s.on('tilt', (t) => {
            if (t.motion > STILL) {
              samples = new Map(sticks.map((x) => [x, []]));
              start = performance.now();
            } else {
              samples.get(s).push(t.up);
            }
          })
        )
      );

      const timer = setInterval(() => {
        const now = performance.now();
        const frac = Math.min(1, (now - start) / (seconds * 1000));
        const still = sticks.every((s) => (s.latest?.motion ?? 1) <= STILL);
        onProgress?.(frac, still);
        if (frac >= 1 && [...samples.values()].every((list) => list.length >= 5)) {
          const out = {};
          for (const [s, list] of samples) out[s.side === '?' ? s.id : s.side] = vec.mean(list);
          finish(null, out);
        } else if (now > deadline) {
          finish(new Error('Couldn’t get a steady reading. Stand still with your weight even on both feet.'));
        }
      }, 100);
    });
  }
}

export const hub = new Hub();
