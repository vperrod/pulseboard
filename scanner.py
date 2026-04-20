#!/usr/bin/env python3
"""PulseBoard local BLE scanner — bridges your watch HR to the cloud dashboard.

Usage:
    python scanner.py                         # interactive device picker
    python scanner.py --device "fēnix 7X"    # auto-connect by name

Requires: pip install bleak httpx

Environment variables (or edit the defaults below):
    PULSEBOARD_URL          Cloud dashboard URL
    PULSEBOARD_SCANNER_KEY  Scanner API key
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import struct
import sys
import time

import httpx
from bleak import BleakClient, BleakScanner

HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"

DEFAULT_URL = "https://pulseboard-app.wonderfulwater-2c91b112.westeurope.azurecontainerapps.io"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("scanner")


def parse_hr(data: bytearray) -> int:
    flags = data[0]
    return struct.unpack_from("<H", data, 1)[0] if flags & 0x01 else data[1]


async def scan_for_hr_devices(timeout: float = 10.0) -> list[tuple[str, str, int]]:
    """Return [(address, name, rssi)] of devices advertising HR service."""
    log.info("Scanning for HR devices (%ds)...", timeout)
    results = await BleakScanner.discover(timeout=timeout, return_adv=True)
    hr_devices = []
    for addr, (device, adv) in results.items():
        service_uuids = [str(s).lower() for s in adv.service_uuids]
        if HR_SERVICE in service_uuids:
            hr_devices.append((addr, device.name or "Unknown", adv.rssi))
    hr_devices.sort(key=lambda d: d[2], reverse=True)  # strongest signal first
    return hr_devices


async def stream_hr(
    address: str,
    name: str,
    api_url: str,
    scanner_key: str,
) -> None:
    """Connect to a BLE HR device and push readings to the cloud API."""
    headers = {"Authorization": f"Bearer {scanner_key}"}

    # Register device with the API
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            f"{api_url}/api/devices/discovered",
            json=[{"address": address, "name": name, "rssi": -50, "services": [HR_SERVICE]}],
            headers=headers,
        )
        log.info("Registered device %s (%s)", name, address)

    http = httpx.AsyncClient(timeout=10)
    last_push = 0.0

    def on_hr(_sender: int, data: bytearray) -> None:
        nonlocal last_push
        hr = parse_hr(data)
        now = time.time()
        sys.stdout.write(f"\r  ♥ {hr} bpm  ({name})   ")
        sys.stdout.flush()

        # Push at most every 1 second to avoid flooding
        if now - last_push >= 1.0:
            last_push = now
            asyncio.get_event_loop().create_task(
                http.post(
                    f"{api_url}/api/metrics/push",
                    json={"device_address": address, "device_name": name, "heart_rate": hr},
                    headers=headers,
                )
            )

    log.info("Connecting to %s (%s)...", name, address)
    async with BleakClient(address) as client:
        log.info("Connected! Streaming HR data (Ctrl+C to stop)")
        await client.start_notify(HR_MEASUREMENT, on_hr)
        try:
            while client.is_connected:
                await asyncio.sleep(1)
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            print()
            log.info("Disconnected")
            await http.aclose()


async def main() -> None:
    import os

    parser = argparse.ArgumentParser(description="PulseBoard BLE scanner")
    parser.add_argument("--url", default=os.getenv("PULSEBOARD_URL", DEFAULT_URL), help="API base URL")
    parser.add_argument("--key", default=os.getenv("PULSEBOARD_SCANNER_KEY", ""), help="Scanner API key")
    parser.add_argument("--device", default="", help="Auto-connect to device with this name (substring match)")
    parser.add_argument("--scan-time", type=float, default=10, help="BLE scan duration in seconds")
    args = parser.parse_args()

    if not args.key:
        print("ERROR: Scanner key required. Set PULSEBOARD_SCANNER_KEY or use --key")
        sys.exit(1)

    devices = await scan_for_hr_devices(args.scan_time)

    if not devices:
        print("No HR devices found. Make sure HR broadcast is enabled on your watch.")
        sys.exit(1)

    # Auto-select by name if --device was given
    if args.device:
        matches = [(a, n, r) for a, n, r in devices if args.device.lower() in n.lower()]
        if not matches:
            print(f"No device matching '{args.device}' found. Available:")
            for a, n, r in devices:
                print(f"  {n} ({a}) rssi={r}")
            sys.exit(1)
        address, name, rssi = matches[0]
        log.info("Auto-selected: %s (%s) rssi=%d", name, address, rssi)
    else:
        print(f"\nFound {len(devices)} HR device(s):\n")
        for i, (a, n, r) in enumerate(devices):
            print(f"  [{i}] {n}  ({a})  rssi={r}")
        print()
        try:
            choice = int(input("Select device number: "))
            address, name, rssi = devices[choice]
        except (ValueError, IndexError):
            print("Invalid selection")
            sys.exit(1)

    while True:
        try:
            await stream_hr(address, name, args.url, args.key)
        except Exception as e:
            log.warning("Connection lost: %s. Reconnecting in 3s...", e)
            await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBye!")
