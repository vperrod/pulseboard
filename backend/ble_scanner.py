"""BLE scanner using bleak — discovers and reads HR + Power from sport watches/straps."""

from __future__ import annotations

import asyncio
import logging
import struct
from collections.abc import Callable, Coroutine
from typing import Any

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

logger = logging.getLogger("pulseboard.ble")

# Standard BLE GATT UUIDs
HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
POWER_SERVICE_UUID = "00001818-0000-1000-8000-00805f9b34fb"
POWER_MEASUREMENT_UUID = "00002a63-0000-1000-8000-00805f9b34fb"

MetricCallback = Callable[[str, int, int | None], Coroutine[Any, Any, None]]


def parse_hr_measurement(data: bytearray) -> int:
    """Parse the Heart Rate Measurement characteristic value.

    Byte 0: Flags
        bit 0: 0 = HR is uint8, 1 = HR is uint16
    Byte 1 (or 1-2): Heart rate value
    """
    flags = data[0]
    if flags & 0x01:
        # 16-bit HR
        return struct.unpack_from("<H", data, 1)[0]
    # 8-bit HR
    return data[1]


def parse_power_measurement(data: bytearray) -> int:
    """Parse the Cycling Power Measurement characteristic value.

    Bytes 0-1: Flags (uint16)
    Bytes 2-3: Instantaneous Power (sint16) in watts
    """
    return struct.unpack_from("<h", data, 2)[0]


class BLEScanner:
    """Manages BLE scanning, connections, and notifications."""

    def __init__(self) -> None:
        self._running = False
        self._discovered: dict[str, dict] = {}  # address → {name, rssi, services}
        self._clients: dict[str, BleakClient] = {}  # address → connected client
        self._callback: MetricCallback | None = None

    def stop(self) -> None:
        self._running = False

    def get_discovered_devices(self) -> list[dict]:
        return list(self._discovered.values())

    async def run(self, callback: MetricCallback) -> None:
        """Main loop: scan → connect → subscribe → reconnect on drop."""
        self._callback = callback
        self._running = True
        logger.info("BLE scanner starting")

        while self._running:
            try:
                await self._scan_and_connect()
            except Exception:
                logger.exception("BLE scanner error")
            await asyncio.sleep(5)  # Re-scan every 5 seconds

    async def _scan_and_connect(self) -> None:
        """Discover BLE devices advertising HR or Power services."""
        try:
            devices = await BleakScanner.discover(timeout=4.0)
        except Exception:
            logger.exception("BLE scan failed")
            return

        for device in devices:
            addr = device.address
            name = device.name or "Unknown"

            # Track all discovered HR/Power devices
            self._discovered[addr] = {
                "address": addr,
                "name": name,
                "rssi": device.rssi if hasattr(device, "rssi") else 0,
                "services": [],
            }

            # If already connected, skip
            if addr in self._clients and self._clients[addr].is_connected:
                continue

            # Try to connect and subscribe
            asyncio.create_task(self._connect_device(device))

    async def _connect_device(self, device: BLEDevice) -> None:
        """Connect to a single BLE device and subscribe to HR/Power notifications."""
        addr = device.address
        try:
            client = BleakClient(device, disconnected_callback=lambda c: self._on_disconnect(addr))
            await client.connect()
            self._clients[addr] = client
            logger.info("Connected to %s (%s)", device.name, addr)

            services = client.services
            service_uuids = [s.uuid for s in services] if services else []
            if addr in self._discovered:
                self._discovered[addr]["services"] = service_uuids

            # Subscribe to Heart Rate Measurement
            if any(HR_SERVICE_UUID in u for u in service_uuids):
                try:
                    await client.start_notify(HR_MEASUREMENT_UUID, lambda _, data, a=addr: self._handle_hr(a, data))
                    logger.info("Subscribed to HR notifications from %s", addr)
                except Exception:
                    logger.warning("Failed to subscribe to HR from %s", addr)

            # Subscribe to Power Measurement
            if any(POWER_SERVICE_UUID in u for u in service_uuids):
                try:
                    await client.start_notify(POWER_MEASUREMENT_UUID, lambda _, data, a=addr: self._handle_power(a, data))
                    logger.info("Subscribed to Power notifications from %s", addr)
                except Exception:
                    logger.warning("Failed to subscribe to Power from %s", addr)

        except Exception:
            logger.debug("Could not connect to %s (%s)", device.name, addr)

    def _handle_hr(self, address: str, data: bytearray) -> None:
        hr = parse_hr_measurement(data)
        if self._callback:
            asyncio.create_task(self._callback(address, hr, None))

    def _handle_power(self, address: str, data: bytearray) -> None:
        power = parse_power_measurement(data)
        if self._callback:
            # Power-only update: HR=0 signals "no HR in this packet"
            asyncio.create_task(self._callback(address, 0, power))

    def _on_disconnect(self, address: str) -> None:
        logger.info("Device %s disconnected", address)
        self._clients.pop(address, None)


# Singleton instance
scanner = BLEScanner()
