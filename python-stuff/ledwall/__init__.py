"""
ledwall package.

Exports the public Python API for talking to the ESP32 LED controller over serial.
"""

from .serial_controller import LedSerialController, SerialNotConnectedError

__all__ = ["LedSerialController", "SerialNotConnectedError"]
