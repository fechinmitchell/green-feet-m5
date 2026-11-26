// Green Feet: shoe-mounted slope sensor for M5StickC Plus.
//
// The stick does very little thinking on purpose. It streams a smoothed
// gravity vector and a "how still am I" number over Bluetooth, reports button
// presses, and shows whatever the phone tells it to. All the slope maths,
// calibration and green-reading logic live in the web app, so improving the
// reads never needs a re-flash.

#include <M5StickCPlus.h>
#include <NimBLEDevice.h>
#include <Preferences.h>

#ifndef FW_VERSION
#define FW_VERSION "dev"
#endif

// Keep these in sync with frontend/src/ble/protocol.js
#define SERVICE_UUID "6a4e0001-6f1d-4b8e-9f33-6f72e3f2a7c1"
#define TILT_UUID    "6a4e0002-6f1d-4b8e-9f33-6f72e3f2a7c1"  // notify: 20 bytes, see sendTilt()
#define EVENT_UUID   "6a4e0003-6f1d-4b8e-9f33-6f72e3f2a7c1"  // notify: "A:<n>" / "B:<n>"
#define CMD_UUID     "6a4e0004-6f1d-4b8e-9f33-6f72e3f2a7c1"  // write: text commands
#define INFO_UUID    "6a4e0005-6f1d-4b8e-9f33-6f72e3f2a7c1"  // read: "fw=..;side=..;id=.."

static const int LED_PIN = 10;  // red LED, active low

Preferences prefs;
NimBLECharacteristic *tiltChr, *eventChr, *infoChr;
volatile bool connected = false;
char side = '?';
char devId[5] = "0000";

// Smoothed accelerometer (in g) and motion level.
float fx = 0, fy = 0, fz = 1, motion = 1.0f;
uint32_t eventCount = 0;

// What the screen should show. Set by the phone via "disp:" commands.
String dTitle = "", dValue = "", dSub = "";
bool screenDirty = true;
volatile bool pendingCmd = false;
String cmdBuf;

int batteryPct() {
  float v = M5.Axp.GetBatVoltage();
  int p = (int)((v - 3.3f) / (4.15f - 3.3f) * 100.0f);
  return constrain(p, 0, 100);
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
  lcd.drawString(String(batteryPct()) + "%", 110, 16);

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
  }
  screenDirty = true;
}

class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s) override {
    connected = true;
    screenDirty = true;
    // Allow a second phone/app connection slot? No: one phone at a time.
  }
  void onDisconnect(NimBLEServer *s) override {
    connected = false;
    dTitle = dValue = dSub = "";
    screenDirty = true;
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
//   uint8   battery %    uint8 flags (bit0 = side known)   uint16 sequence
void sendTilt() {
  static uint16_t seq = 0;
  uint8_t buf[20];
  float vals[4] = {fx, fy, fz, motion};
  memcpy(buf, vals, 16);
  buf[16] = (uint8_t)batteryPct();
  buf[17] = side == '?' ? 0 : 1;
  seq++;
  memcpy(buf + 18, &seq, 2);
  tiltChr->setValue(buf, sizeof(buf));
  tiltChr->notify();
}

void setup() {
  M5.begin(true, true, false);
  M5.Imu.Init();
  M5.Lcd.setRotation(0);  // portrait, 135 x 240
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  prefs.begin("greenfeet", false);
  uint8_t s = prefs.getUChar("side", '?');
  side = (s == 'L' || s == 'R') ? (char)s : '?';

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  snprintf(devId, sizeof(devId), "%02X%02X", mac[4], mac[5]);

  String name = String("GreenFeet-") + devId;
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setPower(ESP_PWR_LVL_P7);
  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  NimBLEService *svc = server->createService(SERVICE_UUID);
  tiltChr = svc->createCharacteristic(TILT_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  eventChr = svc->createCharacteristic(EVENT_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *cmd = svc->createCharacteristic(CMD_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  cmd->setCallbacks(new CmdCB());
  infoChr = svc->createCharacteristic(INFO_UUID, NIMBLE_PROPERTY::READ);
  updateInfo();
  svc->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(name.c_str());
  adv->setScanResponse(true);
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();

  float ax, ay, az;
  M5.Imu.getAccelData(&ax, &ay, &az);
  fx = ax; fy = ay; fz = az;
  drawScreen();
  beep(2000, 60);
}

void loop() {
  static uint32_t lastSample = 0, lastSend = 0, lastScreen = 0;
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

  if (connected && now - lastSend >= 50) {  // 20 Hz to the phone
    lastSend = now;
    sendTilt();
  }

  if (M5.BtnA.wasPressed()) { sendEvent('A'); beep(3200, 40); }
  if (M5.BtnB.wasPressed()) { sendEvent('B'); beep(1800, 40); }

  if (pendingCmd) {
    pendingCmd = false;
    String c = cmdBuf;
    handleCommand(c);
  }

  // Refresh the battery figure now and then, redraw when something changed.
  if (screenDirty || now - lastScreen > 30000) {
    screenDirty = false;
    lastScreen = now;
    drawScreen();
  }
  delay(1);
}
