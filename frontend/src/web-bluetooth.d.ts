/* Minimal Web Bluetooth API type declarations */

interface Bluetooth {
  requestDevice(options: {
    filters?: Array<{ services?: string[] }>;
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }): Promise<BluetoothDevice>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(
    characteristic: string,
  ): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly value: DataView | null;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
