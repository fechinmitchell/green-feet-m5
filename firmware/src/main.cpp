// Green Feet: shoe-mounted slope sensor for M5StickC Plus.
//
// The stick does very little thinking on purpose. It streams a smoothed
// gravity vector and a "how still am I" number over Bluetooth, reports button
// presses, and shows whatever the phone tells it to. All the slope maths,
// calibration and green-reading logic live in the web app, so improving the
// reads never needs a re-flash.
//
// Power: the stick naps (deep sleep) whenever the app doesn't need it. While
// napping it wakes for ~1.5 s every 15 s to see if the app wants it, so both
// sticks come back on their own when you start a putt. A press of A wakes it
// straight away.

#include <M5StickCPlus.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <esp_sleep.h>

#ifndef FW_VERSION
#define FW_VERSION "dev"
#endif

// Keep these in sync with frontend/src/ble/protocol.js
#define SERVICE_UUID "6a4e0001-6f1d-4b8e-9f33-6f72e3f2a7c1"
#define TILT_UUID    "6a4e0002-6f1d-4b8e-9f33-6f72e3f2a7c1"  // notify: 20 bytes, see sendTilt()
#define EVENT_UUID   "6a4e0003-6f1d-4b8e-9f33-6f72e3f2a7c1"  // notify: "A:<n>" / "B:<n>"
#define CMD_UUID     "6a4e0004-6f1d-4b8e-9f33-6f72e3f2a7c1"  // write: text commands
#define INFO_UUID    "6a4e0005-6f1d-4b8e-9f33-6f72e3f2a7c1"  // read: "fw=..;side=..;id=.."
#define BATT_UUID    "6a4e0006-6f1d-4b8e-9f33-6f72e3f2a7c1"  // notify every 5 s: battery monitor, see sendBatt()

static const int LED_PIN = 10;  // red LED, active low

Preferences prefs;
NimBLECharacteristic *tiltChr, *eventChr, *infoChr, *battChr;
volatile bool connected = false;
char side = '?';
char devId[5] = "0000";

// Smoothed accelerometer (in g) and motion level.
float fx = 0, fy = 0, fz = 1, motion = 1.0f;
uint32_t eventCount = 0;

// What the screen should show. Set by the phone via "disp:" commands.
String dTitle = "", dValue = "", dSub = "";
bool screenDirty = true;

// Power saving. The backlight is the biggest drain after Bluetooth, so the
// screen switches off 20 s after the last button press or phone update.
const uint32_t SCREEN_MS = 20000;
uint32_t screenOnUntil = SCREEN_MS;
bool screenOn = true;
volatile bool wakeRequested = false;

void wakeScreen() {
  screenOnUntil = millis() + SCREEN_MS;
  if (!screenOn) {
    M5.Lcd.writecommand(0x11);  // ST7789 sleep out
    delay(10);
    M5.Axp.SetLDO2(true);  // LDO2 powers the LCD backlight
    screenOn = true;
    screenDirty = true;
  }
}

void sleepScreen() {
  M5.Axp.SetLDO2(false);
  M5.Lcd.writecommand(0x10);  // ST7789 sleep in: the display chip itself stops too
  screenOn = false;
}

// Streaming speed. Sampling stays at 100 Hz with the same smoothing either way,
// so readings are exactly as accurate; only how often we send to the phone
// changes. The phone asks for fast mode while you're measuring or calibrating.
const uint32_t SLOW_MS = 250;  // 4 Hz
const uint32_t FAST_MS = 50;   // 20 Hz
uint32_t fastUntil = 0;

// Napping.
const uint64_t NAP_US = 15ULL * 1000000;         // sleep 15 s between checks
const uint32_t LISTEN_MS = 1500;                 // ...then listen for the app this long
const uint16_t NAP_MAX = 2 * 60 * 60 / 16;       // ~2 h of napping with no app: power fully off
const uint32_t NO_APP_NAP_MS = 60UL * 1000;      // app went away: nap after 1 min
const uint32_t FIRST_CONNECT_MS = 3UL * 60 * 1000;  // fresh power-on: wait 3 min to be paired
RTC_DATA_ATTR uint8_t sleepKind = 0;  // survives deep sleep: 1 = napping, 2 = switched off
RTC_DATA_ATTR uint16_t napCount = 0;
uint32_t lastConnectedAt = 0;
bool everConnected = false;
bool lcdReady = false;
volatile bool pendingCmd = false;
bool napRequested = false;
String cmdBuf;

// Battery: the raw voltage jumps around, so smooth it, then map it onto a
// typical LiPo discharge curve (voltage is not linear with charge left).
float battV = 0;
float battMa = 0;  // smoothed battery current in mA: negative = draining, positive = charging
bool charging = false;

// Accurate %: the power chip's charge counter keeps running while the stick
// sleeps. We zero it each time a charge finishes, so % = 100 - (used / capacity).
// Until the first full charge after this update, % falls back to voltage.
const float CAP_MAH = 120.0f;  // M5StickC Plus battery
bool anchored = false;
bool fullLatched = false;
int pctCache = -1;

int voltagePct();

void updateBattery() {
  float v = M5.Axp.GetBatVoltage();
  battV = battV == 0 ? v : battV + 0.2f * (v - battV);
  float ma = M5.Axp.GetBatCurrent();
  battMa = battMa == 0 ? ma : battMa + 0.2f * (ma - battMa);
  charging = M5.Axp.GetBatChargeCurrent() > 1.0f;  // mA flowing into the battery

  // Charge finished: plugged in, no current flowing in, battery at full voltage.
  bool full = M5.Axp.GetVBusVoltage() > 4.4f && !charging && battV > 4.10f;
  if (full && !fullLatched) {
    M5.Axp.ClearCoulombcounter();
    M5.Axp.EnableCoulombcounter();
    anchored = true;
    prefs.putUChar("anch", 1);
  }
  fullLatched = full;

  int p = voltagePct();
  if (anchored) {
    float c = M5.Axp.GetCoulombData();  // mAh since the last full charge (negative = used)
    if (c > 30 || c < -CAP_MAH * 1.3f) {
      anchored = false;  // counter was reset (battery unplugged?) - fall back to voltage
      prefs.putUChar("anch", 0);
    } else {
      p = (int)(100.0f + c / CAP_MAH * 100.0f + 0.5f);
      if (battV < 3.45f && p > 3) p = 3;  // trust a nearly flat battery over the count
      p = constrain(p, 0, 100);
    }
  }
  pctCache = p;
}

int batteryPct() {
  return pctCache < 0 ? voltagePct() : pctCache;
}

int voltagePct() {
  static const float volts[] = {3.40f, 3.60f, 3.70f, 3.80f, 3.95f, 4.15f};
  static const float pct[] = {0, 10, 25, 50, 75, 100};
  float v = battV;
  if (v <= volts[0]) return 0;
  for (int i = 1; i < 6; i++) {
    if (v <= volts[i]) return (int)(pct[i - 1] + (v - volts[i - 1]) / (volts[i] - volts[i - 1]) * (pct[i] - pct[i - 1]));
  }
  return 100;
}

void updateInfo() {
  char buf[48];
  snprintf(buf, sizeof(buf), "fw=%s;side=%c;id=%s", FW_VERSION, side, devId);
  infoChr->setValue((uint8_t *)buf, strlen(buf));
}

void beep(int freq, int ms) {
  M5.Beep.tone(freq, ms);
}

void drawScreen() {
  auto &lcd = M5.Lcd;
  lcd.fillScreen(BLACK);
  lcd.setTextDatum(TC_DATUM);

  // Header: side + link dot + battery
  lcd.setTextColor(WHITE, BLACK);
  lcd.setTextSize(3);
  lcd.drawString(side == '?' ? "?" : String(side), 22, 8);
  lcd.fillCircle(67, 20, 6, connected ? GREEN : DARKGREY);
  lcd.setTextSize(1);
  int bp = batteryPct();
  lcd.setTextColor(charging ? CYAN : bp < 15 ? RED : bp < 35 ? YELLOW : WHITE, BLACK);
  lcd.drawString(String(charging ? "+" : "") + String(bp) + "%", 108, 16);

  if (!connected) {
    lcd.setTextSize(2);
    lcd.setTextColor(GREEN, BLACK);
    lcd.drawString("GREEN", 67, 80);
    lcd.drawString("FEET", 67, 100);
    lcd.setTextSize(1);
    lcd.setTextColor(LIGHTGREY, BLACK);
    lcd.drawString("open the app", 67, 150);
    lcd.drawString("to connect", 67, 162);
    lcd.drawString(String("id ") + devId, 67, 215);
    return;
  }

  lcd.setTextColor(LIGHTGREY, BLACK);
  lcd.setTextSize(2);
  lcd.drawString(dTitle.length() ? dTitle : "READY", 67, 60);

  lcd.setTextColor(GREEN, BLACK);
  int sz = dValue.length() <= 4 ? 4 : 3;
  lcd.setTextSize(sz);
  lcd.drawString(dValue.length() ? dValue : "-", 67, 105);

  lcd.setTextColor(WHITE, BLACK);
  lcd.setTextSize(1);
  // Sub line may contain "\n" separated rows
  int y = 165, start = 0;
  String s = dSub.length() ? dSub : "press A to read";
  while (start <= (int)s.length()) {
    int nl = s.indexOf('\n', start);
    if (nl < 0) nl = s.length();
    lcd.drawString(s.substring(start, nl), 67, y);
    y += 14;
    start = nl + 1;
  }
}

void handleCommand(const String &cmd) {
  if (cmd.startsWith("side:") && cmd.length() >= 6) {
    char s = toupper(cmd.charAt(5));
    if (s == 'L' || s == 'R') {
      side = s;
      prefs.putUChar("side", (uint8_t)s);
      updateInfo();
      beep(2500, 80);
    }
  } else if (cmd.startsWith("disp:")) {
    String rest = cmd.substring(5);
    int a = rest.indexOf('|');
    int b = a < 0 ? -1 : rest.indexOf('|', a + 1);
    dTitle = a < 0 ? rest : rest.substring(0, a);
    dValue = a < 0 ? "" : (b < 0 ? rest.substring(a + 1) : rest.substring(a + 1, b));
    dSub = b < 0 ? "" : rest.substring(b + 1);
    dSub.replace("\\n", "\n");
  } else if (cmd.startsWith("beep:")) {
    int comma = cmd.indexOf(',');
    int f = cmd.substring(5, comma < 0 ? cmd.length() : comma).toInt();
    int ms = comma < 0 ? 120 : cmd.substring(comma + 1).toInt();
    beep(f > 0 ? f : 3000, ms > 0 ? ms : 120);
  } else if (cmd.startsWith("led:")) {
    digitalWrite(LED_PIN, cmd.charAt(4) == '1' ? LOW : HIGH);
  } else if (cmd == "nap") {
    napRequested = true;  // handled in loop()
    return;
  } else if (cmd.startsWith("rate:")) {
    // "rate:fast" lasts 30 s unless renewed, so a dropped phone can't leave it fast
    fastUntil = cmd.substring(5) == "fast" ? millis() + 30000 : 0;
    return;  // don't wake the screen for this
  }
  screenDirty = true;
  wakeScreen();
}

class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s) override {
    connected = true;
    screenDirty = true;
    wakeRequested = true;
  }
  void onConnect(NimBLEServer *s, ble_gap_conn_desc *desc) override {
    // 30-50 ms interval, may skip up to 4 events when there's nothing to send.
    // Button presses still go out at the next event, so they feel instant.
    s->updateConnParams(desc->conn_handle, 24, 40, 4, 400);
  }
  void onDisconnect(NimBLEServer *s) override {
    connected = false;
    dTitle = dValue = dSub = "";
    screenDirty = true;
    wakeRequested = true;
    NimBLEDevice::startAdvertising();
  }
};

class CmdCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override {
    cmdBuf = String(c->getValue().c_str());
    pendingCmd = true;  // handled in loop() so we never draw from the BLE task
  }
};

void sendEvent(char button) {
  char buf[16];
  snprintf(buf, sizeof(buf), "%c:%lu", button, (unsigned long)++eventCount);
  eventChr->setValue((uint8_t *)buf, strlen(buf));
  if (connected) eventChr->notify();
}

// 20-byte packet, little endian:
//   float32 ax, ay, az   smoothed acceleration in g (sensor frame)
//   float32 motion       smoothed |a - mean| in g, small when standing still
//   uint8   battery %    uint8 flags (bit0 = side known, bit1 = charging, bit2 = accurate %)   uint16 sequence
void sendTilt() {
  static uint16_t seq = 0;
  uint8_t buf[20];
  float vals[4] = {fx, fy, fz, motion};
  memcpy(buf, vals, 16);
  buf[16] = (uint8_t)batteryPct();
  buf[17] = (side == '?' ? 0 : 1) | (charging ? 2 : 0) | (anchored ? 4 : 0);
  seq++;
  memcpy(buf + 18, &seq, 2);
  tiltChr->setValue(buf, sizeof(buf));
  tiltChr->notify();
}

// 16-byte battery packet, little endian:
//   float32 volts   float32 mA (negative = draining)
//   float32 coulomb counter in mAh since power-on (negative = used)
//   uint8 battery %   uint8 flags (bit1 = charging, bit2 = screen on, bit3 = fast stream, bit4 = accurate %)   uint16 sequence
void sendBatt() {
  static uint16_t seq = 0;
  uint8_t buf[16];
  float vals[3] = {battV, battMa, M5.Axp.GetCoulombData()};
  memcpy(buf, vals, 12);
  buf[12] = (uint8_t)batteryPct();
  buf[13] = (charging ? 2 : 0) | (screenOn ? 4 : 0) | (millis() < fastUntil ? 8 : 0) | (anchored ? 16 : 0);
  seq++;
  memcpy(buf + 14, &seq, 2);
  battChr->setValue(buf, sizeof(buf));
  battChr->notify();
}

// ---- Sleeping ----
// Nap: deep sleep, wake every 15 s to check for the app, or on a press of A.
// Off (hold A 2 s): deep sleep, only a 1 s hold of A wakes it; after 2 h it
// powers fully off and then only the side power button turns it on.
const gpio_num_t BTN_A_PIN = GPIO_NUM_37;
const uint64_t OFF_TO_POWEROFF_US = 2ULL * 60 * 60 * 1000000;

void quietPeripherals() {
  Wire1.beginTransmission(0x68);  // MPU6886 PWR_MGMT_1: sleep
  Wire1.write(0x6B);
  Wire1.write(0x40);
  Wire1.endTransmission();
  if (lcdReady) sleepScreen();
  digitalWrite(LED_PIN, HIGH);
}

void goNap() {
  quietPeripherals();
  sleepKind = 1;
  esp_sleep_enable_ext0_wakeup(BTN_A_PIN, 0);  // A pulls the pin low
  esp_sleep_enable_timer_wakeup(NAP_US);
  esp_deep_sleep_start();
}

void sleepNow(const char *why) {
  if (connected) {
    // Tell the app this was on purpose, so it says "off" rather than "lost".
    eventChr->setValue((uint8_t *)"S:0", 3);
    eventChr->notify();
    delay(150);
  }
  wakeScreen();
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextDatum(MC_DATUM);
  M5.Lcd.setTextColor(WHITE, BLACK);
  M5.Lcd.setTextSize(2);
  M5.Lcd.drawString("OFF", 67, 100);
  M5.Lcd.setTextSize(1);
  M5.Lcd.drawString(why, 67, 130);
  M5.Lcd.drawString("hold A to turn on", 67, 150);
  M5.Beep.tone(1400);
  delay(120);
  M5.Beep.tone(900);
  delay(160);
  M5.Beep.mute();
  delay(1200);

  quietPeripherals();
  while (digitalRead(BTN_A_PIN) == LOW) delay(10);  // wait for A to be let go
  sleepKind = 2;
  esp_sleep_enable_ext0_wakeup(BTN_A_PIN, 0);
  esp_sleep_enable_timer_wakeup(OFF_TO_POWEROFF_US);
  esp_deep_sleep_start();
}

void powerOffFully() {
  Wire1.begin(21, 22);  // internal I2C to the power chip
  M5.Axp.PowerOff();
}

// Runs first on every boot. Returns true for a "quick" nap check (no screen).
bool checkWake() {
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (cause == ESP_SLEEP_WAKEUP_TIMER) {
    if (sleepKind == 2) powerOffFully();  // switched off 2 h ago
    if (++napCount > NAP_MAX) powerOffFully();  // napping for ~2 h with no app
    return true;
  }
  if (cause == ESP_SLEEP_WAKEUP_EXT0 && sleepKind == 2) {
    // Switched off: only a deliberate 1 s hold turns it on (not a knock in the bag).
    pinMode(BTN_A_PIN, INPUT);
    uint32_t start = millis();
    while (digitalRead(BTN_A_PIN) == LOW) {
      if (millis() - start >= 1000) return false;
      delay(10);
    }
    esp_sleep_enable_ext0_wakeup(BTN_A_PIN, 0);
    esp_sleep_enable_timer_wakeup(OFF_TO_POWEROFF_US);
    esp_deep_sleep_start();
  }
  return false;  // power button, or A pressed while napping: wake fully
}

void initBle() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  snprintf(devId, sizeof(devId), "%02X%02X", mac[4], mac[5]);

  String name = String("GreenFeet-") + devId;
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setPower(ESP_PWR_LVL_N0);  // 0 dBm: plenty for shoe-to-pocket, saves power
  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  NimBLEService *svc = server->createService(SERVICE_UUID);
  tiltChr = svc->createCharacteristic(TILT_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  eventChr = svc->createCharacteristic(EVENT_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *cmd = svc->createCharacteristic(CMD_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  cmd->setCallbacks(new CmdCB());
  infoChr = svc->createCharacteristic(INFO_UUID, NIMBLE_PROPERTY::READ);
  battChr = svc->createCharacteristic(BATT_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  updateInfo();
  svc->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(name.c_str());
  adv->setScanResponse(true);
  adv->addServiceUUID(SERVICE_UUID);
  adv->setMinInterval(32);  // advertise every 20-30 ms so the phone finds it fast
  adv->setMaxInterval(48);
  adv->start();
}

// Switch off the 5 V output for add-on hats; nothing here uses it.
void disable5vOut() {
  Wire1.beginTransmission(0x34);
  Wire1.write(0x10);
  Wire1.endTransmission();
  Wire1.requestFrom(0x34, 1);
  if (Wire1.available()) {
    uint8_t v = Wire1.read();
    Wire1.beginTransmission(0x34);
    Wire1.write(0x10);
    Wire1.write(v & ~0x04);  // EXTEN off
    Wire1.endTransmission();
  }
}

void setup() {
  bool quick = checkWake();
  setCpuFrequencyMhz(80);  // plenty for sensing + Bluetooth, uses much less power than 240
  prefs.begin("greenfeet", false);
  uint8_t s = prefs.getUChar("side", '?');
  side = (s == 'L' || s == 'R') ? (char)s : '?';
  anchored = prefs.getUChar("anch", 0) == 1;

  if (quick) {
    // Nap check: no screen, just Bluetooth. Does the app want us?
    Wire1.begin(21, 22);  // internal I2C (power chip + motion sensor), for going back to sleep
    initBle();
    uint32_t start = millis();
    while (!connected && millis() - start < LISTEN_MS) delay(20);
    if (!connected) goNap();  // no: straight back to sleep
  }

  pinMode(BTN_A_PIN, INPUT);
  while (digitalRead(BTN_A_PIN) == LOW) delay(10);  // the wake press must not count as a reading
  M5.begin(true, true, false);
  lcdReady = true;
  sleepKind = 0;
  napCount = 0;
  disable5vOut();
  M5.Imu.Init();
  // We only use the accelerometer. Switch the gyro off (MPU6886 PWR_MGMT_2,
  // bits 0-2 = gyro z/y/x standby) to save a few mA.
  Wire1.beginTransmission(0x68);
  Wire1.write(0x6C);
  Wire1.write(0x07);
  Wire1.endTransmission();
  M5.Lcd.setRotation(0);  // portrait, 135 x 240
  M5.Axp.EnableCoulombcounter();  // counts mAh in and out of the battery
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  if (!quick) initBle();
  lastConnectedAt = millis();

  float ax, ay, az;
  M5.Imu.getAccelData(&ax, &ay, &az);
  fx = ax; fy = ay; fz = az;
  updateBattery();
  drawScreen();
  beep(2000, 60);
}

void loop() {
  static uint32_t lastSample = 0, lastSend = 0, lastScreen = 0, lastBatt = 0, lastBattSend = 0;
  uint32_t now = millis();
  M5.update();
  M5.Beep.update();

  // 100 Hz sampling. alpha 0.05 gives ~0.2 s smoothing: steady but responsive.
  if (now - lastSample >= 10) {
    lastSample = now;
    float ax, ay, az;
    M5.Imu.getAccelData(&ax, &ay, &az);
    const float a = 0.05f;
    fx += a * (ax - fx);
    fy += a * (ay - fy);
    fz += a * (az - fz);
    float dev = fabsf(ax - fx) + fabsf(ay - fy) + fabsf(az - fz);
    motion += 0.03f * (dev - motion);
  }

  uint32_t period = (int32_t)(fastUntil - now) > 0 ? FAST_MS : SLOW_MS;
  if (connected && now - lastSend >= period) {
    lastSend = now;
    sendTilt();
  }
  if (connected && now - lastBattSend >= 5000) {
    lastBattSend = now;
    sendBatt();
  }

  // A: a short press is a reading (sent when you let go); holding 2 s turns off.
  static uint32_t aDownAt = 0;
  static bool aHoldShown = false;
  if (M5.BtnA.wasPressed()) { aDownAt = now; aHoldShown = false; wakeScreen(); }
  if (M5.BtnA.isPressed() && aDownAt) {
    uint32_t held = now - aDownAt;
    if (held >= 700 && !aHoldShown) {  // past a normal press: show what holding does
      aHoldShown = true;
      M5.Lcd.fillScreen(BLACK);
      M5.Lcd.setTextDatum(MC_DATUM);
      M5.Lcd.setTextSize(2);
      M5.Lcd.setTextColor(YELLOW, BLACK);
      M5.Lcd.drawString("KEEP", 67, 100);
      M5.Lcd.drawString("HOLDING", 67, 122);
      M5.Lcd.setTextSize(1);
      M5.Lcd.drawString("to turn off", 67, 150);
    }
    if (held >= 2000) sleepNow("held A");
  }
  if (M5.BtnA.wasReleased() && aDownAt) {
    if (now - aDownAt < 700) { sendEvent('A'); beep(3200, 40); }
    else screenDirty = true;  // let go early: put the normal screen back
    aDownAt = 0;
  }
  if (M5.BtnB.wasPressed()) { sendEvent('B'); beep(1800, 40); wakeScreen(); }
  if (wakeRequested) { wakeRequested = false; wakeScreen(); }
  if (screenOn && !charging && (int32_t)(now - screenOnUntil) > 0) sleepScreen();

  if (connected) everConnected = true;
  if (connected || charging) lastConnectedAt = now;
  uint32_t idleLimit = everConnected ? NO_APP_NAP_MS : FIRST_CONNECT_MS;
  if (now - lastConnectedAt > idleLimit) goNap();
  if (napRequested) {
    delay(100);  // let the write finish before the radio goes off
    goNap();
  }

  if (pendingCmd) {
    pendingCmd = false;
    String c = cmdBuf;
    handleCommand(c);
  }

  if (now - lastBatt >= 2000) {
    lastBatt = now;
    bool wasCharging = charging;
    updateBattery();
    if (wasCharging != charging) screenDirty = true;
  }

  // Refresh the battery figure now and then, redraw when something changed.
  if (screenOn && (screenDirty || now - lastScreen > 30000)) {
    screenDirty = false;
    lastScreen = now;
    drawScreen();
  }
  delay(1);
}
