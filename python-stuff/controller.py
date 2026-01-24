import argparse
import time

from ledwall import LedSerialController


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", help="Serial port like COM5 or /dev/ttyUSB0")
    args = parser.parse_args()

    ctrl = LedSerialController(port=args.port)
    port = ctrl.connect()
    print(f"Using port: {port}")
    print(ctrl.info().raw or "INFO failed")

    ctrl.ping()
    ctrl.brightness(20)
    ctrl.clear()

    ctrl.fill(255, 0, 0)
    time.sleep(0.7)
    ctrl.fill(0, 255, 0)
    time.sleep(0.7)
    ctrl.fill(0, 0, 255)
    time.sleep(0.7)
    ctrl.clear()
    ctrl.close()

if __name__ == "__main__":
    main()
