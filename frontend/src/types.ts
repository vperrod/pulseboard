export interface LiveMetric {
  user_id: string;
  user_name: string;
  heart_rate: number;
  power: number | null;
  zone: number;
  zone_label: string;
  zone_color: string;
  timestamp: string;
  connected: boolean;
}

export interface ScannedDevice {
  address: string;
  name: string;
  rssi: number;
  services: string[];
  claimed_by: string | null;
}

export interface UserProfile {
  id: string;
  name: string;
  max_hr: number;
  device_address: string | null;
  device_name: string | null;
}
