#include <Arduino.h>
#include <FastLED.h>

#define DATA_PIN 21
#define NUM_LEDS 15
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define DEFAULT_BRIGHTNESS 32

CRGB leds[NUM_LEDS];
String line;

void replyOK() {
  Serial.println("OK");
}

void replyErr(const String& msg) {
  Serial.print("ERR ");
  Serial.println(msg);
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

int clamp8(int v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // Increased delay to ensure ESP32 is fully ready

  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(DEFAULT_BRIGHTNESS);
  FastLED.clear(true);

  Serial.println("READY");
}

void loop() {
  if (!readLine(line)) return;

  line.toUpperCase();

  if (line == "PING") {
    replyOK();
  }
  else if (line == "INFO") {
    Serial.print("OK ");
    Serial.print("NUM_LEDS ");
    Serial.print(NUM_LEDS);
    Serial.print(" BRIGHT ");
    Serial.println(FastLED.getBrightness());
  }
  else if (line.startsWith("BRIGHT ")) {
    int b;
    if (sscanf(line.c_str(), "BRIGHT %d", &b) == 1) {
      FastLED.setBrightness(clamp8(b));
      FastLED.show();
      replyOK();
    } else replyErr("usage: BRIGHT <0-255>");
  }
  else if (line.startsWith("FILL ")) {
    int r, g, b;
    if (sscanf(line.c_str(), "FILL %d %d %d", &r, &g, &b) == 3) {
      fill_solid(leds, NUM_LEDS, CRGB(clamp8(r), clamp8(g), clamp8(b)));
      FastLED.show();
      replyOK();
    } else replyErr("usage: FILL <r> <g> <b>");
  }
  else if (line.startsWith("SET ")) {
    int i, r, g, b;
    if (sscanf(line.c_str(), "SET %d %d %d %d", &i, &r, &g, &b) == 4) {
      if (i < 0 || i >= NUM_LEDS) {
        replyErr("index out of range");
      } else {
        leds[i] = CRGB(clamp8(r), clamp8(g), clamp8(b));
        FastLED.show();
        replyOK();
      }
    } else replyErr("usage: SET <index> <r> <g> <b>");
  }
  else if (line.startsWith("SETN ")) {
    int i, r, g, b;
    if (sscanf(line.c_str(), "SETN %d %d %d %d", &i, &r, &g, &b) == 4) {
      if (i < 0 || i >= NUM_LEDS) {
        replyErr("index out of range");
      } else {
        leds[i] = CRGB(clamp8(r), clamp8(g), clamp8(b));
        replyOK();
      }
    } else replyErr("usage: SETN <index> <r> <g> <b>");
  }
  else if (line == "SHOW") {
    FastLED.show();
    replyOK();
  }
  else if (line == "CLEAR") {
    FastLED.clear(true);
    replyOK();
  }
  else {
    replyErr("unknown command");
  }

  line = "";
}
