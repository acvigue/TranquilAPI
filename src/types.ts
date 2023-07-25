export interface Pattern {
  uuid: string;
  name: string;
  date: string;
  popularity: number;
  creator: string;
}

export interface Playlist {
  uuid: string;
  name: string;
  description: string;
  patterns: string[];
  featured_pattern: string;
  date: string;
}

export interface User {
  email: string;
  password: string;
  uuid: string;
  is_admin: boolean;
  is_active: boolean;
}