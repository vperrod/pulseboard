import { useState, useRef, useCallback, useEffect } from 'react';

const HR_SERVICE = 'heart_rate';
const HR_MEASUREMENT = 'heart_rate_measurement';

export interface WebBluetoothState {
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  heartRate: number | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWebBluetooth(
  onHeartRate?: (hr: number, deviceName: string) => void,
): WebBluetoothState {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const charRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const onHrRef = useRef(onHeartRate);
  const nameRef = useRef('');

  useEffect(() => {
    onHrRef.current = onHeartRate;
  }, [onHeartRate]);

  const supported =
    typeof navigator !== 'undefined' && navigator.bluetooth !== undefined;

  const handleDisconnect = useCallback(() => {
    setConnected(false);
    setHeartRate(null);
  }, []);

  const connect = useCallback(async () => {
    if (!supported) {
      setError('Web Bluetooth not supported. Use Chrome on a laptop or Android.');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const device = await navigator.bluetooth!.requestDevice({
        filters: [{ services: [HR_SERVICE] }],
      });

      deviceRef.current = device;
      const name = device.name || 'HR Sensor';
      setDeviceName(name);
      nameRef.current = name;

      device.addEventListener('gattserverdisconnected', handleDisconnect);

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(HR_SERVICE);
      const char = await service.getCharacteristic(HR_MEASUREMENT);
      charRef.current = char;

      char.addEventListener(
        'characteristicvaluechanged',
        (event: Event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          const value = target.value;
          if (!value) return;

          const flags = value.getUint8(0);
          const is16bit = flags & 0x01;
          const hr = is16bit ? value.getUint16(1, true) : value.getUint8(1);

          setHeartRate(hr);
          onHrRef.current?.(hr, nameRef.current);
        },
      );

      await char.startNotifications();
      setConnected(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      if (!msg.includes('cancel')) {
        setError(msg);
      }
    } finally {
      setConnecting(false);
    }
  }, [supported, handleDisconnect]);

  const disconnect = useCallback(() => {
    try {
      charRef.current?.stopNotifications();
    } catch {
      /* ignore */
    }
    charRef.current = null;

    if (deviceRef.current) {
      deviceRef.current.removeEventListener(
        'gattserverdisconnected',
        handleDisconnect,
      );
      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
      deviceRef.current = null;
    }

    setConnected(false);
    setHeartRate(null);
    setDeviceName(null);
  }, [handleDisconnect]);

  useEffect(() => {
    return () => {
      try {
        charRef.current?.stopNotifications();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return {
    supported,
    connected,
    connecting,
    deviceName,
    heartRate,
    error,
    connect,
    disconnect,
  };
}
