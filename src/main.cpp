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

#define DATA_PIN 21
#define NUM_LEDS 35
#define LED_TYPE WS2812B
#define COLOR_ORDER GBR
#define DEFAULT_BRIGHTNESS 32

CRGB leds[NUM_LEDS];
String line;
WebServer server(80);

const char* AP_SSID = "LED-WALL-ESP32";
const char* AP_PASS = "climbsafe123";

int clamp8(int v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

void replyOK() {
  Serial.println("OK");
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
    if (out.length() > 200) {
      out = "";
      replyErr("line too long");
    }
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // Increased delay to ensure ESP32 is fully ready

  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(DEFAULT_BRIGHTNESS);
  FastLED.clear(true);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  server.on("/", HTTP_GET, []() {
    String msg = "LED Wall ESP32 AP ready\n";
    msg += "SSID: ";
    msg += AP_SSID;
    msg += "\nIP: ";
    msg += WiFi.softAPIP().toString();
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

  server.begin();

  Serial.println("READY");
  Serial.print("AP SSID: ");
  Serial.println(AP_SSID);
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());
}

void loop() {
  server.handleClient();

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
