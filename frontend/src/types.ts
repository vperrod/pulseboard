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
  heart_rate_preview: number | null;
  has_hr_service: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  max_hr: number;
  device_address: string | null;
  device_name: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  user_name: string;
  score: number;
  heart_rate: number;
  zone: number;
  zone_label: string;
  zone_color: string;
  zone_seconds: Record<string, number>;
  power: number | null;
}

export interface ScoreUpdate {
  type: 'leaderboard';
  entries: LeaderboardEntry[];
  session_id: string;
  session_name: string;
  elapsed_seconds: number;
  paused: boolean;
}

export interface ActiveSession {
  session_id: string;
  session_name: string;
  elapsed_seconds: number;
  paused: boolean;
}

export interface SessionScheduleSlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
}

export type ViewMode = 'split' | 'metrics' | 'leaderboard';
