/*
  ESP32 LED strip firmware (Arduino + FastLED).

  Listens on USB serial (115200 baud) for a simple, line-based command protocol and
  controls a WS2812B strip. Commands are ASCII lines; responses are single lines
  starting with "OK" or "ERR".

  This firmware is intentionally minimal: it does not "know" physical positions
  beyond LED indices (0..NUM_LEDS-1) which are determined by strip wiring order.
*/

#include <Arduino.h>
#include <FastLED.h>
#include <WiFi.h>
#include <WebServer.h>
#include <cstring>

#ifdef __has_include
#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#endif
#endif

#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif

#define DATA_PIN 21
#define NUM_LEDS 35
#define LED_TYPE WS2812B
#define COLOR_ORDER GBR
#define DEFAULT_BRIGHTNESS 32
#define MAX_COMMAND_CHARS 8192
#define WIFI_CONNECT_TIMEOUT_MS 15000UL
#define WIFI_RETRY_INTERVAL_MS 5000UL

CRGB leds[NUM_LEDS];
String line;
WebServer server(80);

const char* WIFI_STA_SSID = WIFI_SSID;
const char* WIFI_STA_PASS = WIFI_PASSWORD;
bool httpServerStarted = false;
unsigned long lastWifiRetryMs = 0;

int clamp8(int v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  return -1;
}

bool parseHexByte(const String& s, int offset, uint8_t& out) {
  if (offset < 0 || offset + 1 >= s.length()) return false;
  int hi = hexNibble(s[offset]);
  int lo = hexNibble(s[offset + 1]);
  if (hi < 0 || lo < 0) return false;
  out = (uint8_t)((hi << 4) | lo);
  return true;
}

bool applyHexFrame(const String& hex) {
  if (hex.length() != NUM_LEDS * 6) {
    return false;
  }

  for (int i = 0; i < NUM_LEDS; i++) {
    const int o = i * 6;
    uint8_t r, g, b;
    if (!parseHexByte(hex, o, r) || !parseHexByte(hex, o + 2, g) || !parseHexByte(hex, o + 4, b)) {
      return false;
    }
    leds[i] = CRGB(r, g, b);
  }

  FastLED.show();
  return true;
}

void replyErr(const String& msg) {
  Serial.print("ERR ");
  Serial.println(msg);
}

String runCommand(const String& raw) {
  String cmd = raw;
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "PING") {
    return "OK";
  }
  else if (cmd == "INFO") {
    return "OK NUM_LEDS " + String(NUM_LEDS) + " BRIGHT " + String(FastLED.getBrightness());
  }
  else if (cmd.startsWith("BRIGHT ")) {
    int b;
    if (sscanf(cmd.c_str(), "BRIGHT %d", &b) == 1) {
      FastLED.setBrightness(clamp8(b));
      FastLED.show();
      return "OK";
    }
    return "ERR usage: BRIGHT <0-255>";
  }
  else if (cmd.startsWith("FILL ")) {
    int r, g, b;
    if (sscanf(cmd.c_str(), "FILL %d %d %d", &r, &g, &b) == 3) {
      fill_solid(leds, NUM_LEDS, CRGB(clamp8(r), clamp8(g), clamp8(b)));
      FastLED.show();
      return "OK";
    }
    return "ERR usage: FILL <r> <g> <b>";
  }
  else if (cmd.startsWith("SET ")) {
    int i, r, g, b;
    if (sscanf(cmd.c_str(), "SET %d %d %d %d", &i, &r, &g, &b) == 4) {
      if (i < 0 || i >= NUM_LEDS) {
        return "ERR index out of range";
      }
      leds[i] = CRGB(clamp8(r), clamp8(g), clamp8(b));
      FastLED.show();
      return "OK";
    }
    return "ERR usage: SET <index> <r> <g> <b>";
  }
  else if (cmd.startsWith("SETN ")) {
    int i, r, g, b;
    if (sscanf(cmd.c_str(), "SETN %d %d %d %d", &i, &r, &g, &b) == 4) {
      if (i < 0 || i >= NUM_LEDS) {
        return "ERR index out of range";
      }
      leds[i] = CRGB(clamp8(r), clamp8(g), clamp8(b));
      return "OK";
    }
    return "ERR usage: SETN <index> <r> <g> <b>";
  }
  else if (cmd == "SHOW") {
    FastLED.show();
    return "OK";
  }
  else if (cmd == "CLEAR") {
    FastLED.clear(true);
    return "OK";
  }
  else if (cmd.startsWith("FRAME ")) {
    String payload = cmd.substring(6);
    payload.trim();
    if (applyHexFrame(payload)) {
      return "OK";
    }
    return "ERR usage: FRAME <hex rgb payload of length NUM_LEDS*6>";
  }

  return "ERR unknown command";
}

bool readLine(String& out) {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      out.trim();
      return true;
    }
    out += c;
    if (out.length() > MAX_COMMAND_CHARS) {
      out = "";
      replyErr("line too long");
    }
  }
  return false;
}

bool connectWifiStation() {
  if (std::strlen(WIFI_STA_SSID) == 0) {
    Serial.println("WARN Wi-Fi credentials missing. Add include/wifi_secrets.h");
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);

  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_STA_SSID);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("ERR Wi-Fi connect failed, status=");
    Serial.println((int)WiFi.status());
    return false;
  }

  Serial.print("Wi-Fi connected, IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

void maintainWifiConnection() {
  if (std::strlen(WIFI_STA_SSID) == 0) {
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  const unsigned long now = millis();
  if (now - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }
  lastWifiRetryMs = now;

  Serial.println("Wi-Fi disconnected, retrying...");
  WiFi.disconnect();
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // Increased delay to ensure ESP32 is fully ready
  line.reserve(MAX_COMMAND_CHARS + 8);

  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(DEFAULT_BRIGHTNESS);
  FastLED.clear(true);

  const bool wifiConnected = connectWifiStation();

  server.on("/", HTTP_GET, []() {
    String msg = "LED Wall ESP32 STA ready\n";
    msg += "SSID: ";
    msg += WIFI_STA_SSID;
    msg += "\nIP: ";
    msg += (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "DISCONNECTED";
    msg += "\nUse /cmd?q=PING\n";
    server.send(200, "text/plain", msg);
  });

  server.on("/cmd", HTTP_GET, []() {
    String q = server.arg("q");
    if (q.length() == 0) {
      server.send(400, "text/plain", "ERR missing q");
      return;
    }
    String response = runCommand(q);
    int code = response.startsWith("OK") ? 200 : 400;
    server.send(code, "text/plain", response);
  });

  server.on("/frame", HTTP_POST, []() {
    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "ERR missing body");
      return;
    }

    String payload = server.arg("plain");
    payload.trim();
    bool applied = applyHexFrame(payload);

    if (applied) {
      server.send(200, "text/plain", "OK");
      return;
    }

    server.send(400, "text/plain", "ERR invalid frame payload");
  });

  if (wifiConnected) {
    server.begin();
    httpServerStarted = true;
  }

  Serial.println("READY");
  if (wifiConnected) {
    Serial.print("Wi-Fi SSID: ");
    Serial.println(WIFI_STA_SSID);
    Serial.print("Wi-Fi IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("HTTP disabled until Wi-Fi connects.");
  }
}

void loop() {
  maintainWifiConnection();
  if (!httpServerStarted && WiFi.status() == WL_CONNECTED) {
    server.begin();
    httpServerStarted = true;
    Serial.print("HTTP server started, IP: ");
    Serial.println(WiFi.localIP());
  }
  if (httpServerStarted) {
    server.handleClient();
  }

  if (readLine(line)) {
    String response = runCommand(line);
    if (response.startsWith("OK")) {
      Serial.println(response);
    } else if (response.startsWith("ERR ")) {
      replyErr(response.substring(4));
    } else {
      Serial.println(response);
    }
    line = "";
  }
}
