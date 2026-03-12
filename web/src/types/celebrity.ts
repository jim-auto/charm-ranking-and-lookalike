export interface ScoreDetails {
  symmetry: number;
  golden_ratio: number;
  eyes: number;
  nose: number;
  mouth: number;
  contour: number;
  skin: number;
}

export interface SnsFollowers {
  instagram?: number;
  twitter?: number;
  tiktok?: number;
  youtube?: number;
}

export interface Celebrity {
  id: string;
  name: string;
  category: 'actor' | 'actress' | 'idol' | 'influencer';
  gender: 'male' | 'female';
  score: number;
  scoreWithAge: number;
  scoreCharm: number;
  age: number;
  sns: SnsFollowers;
  totalFollowers: number;
  details: ScoreDetails;
  embedding: number[];
  thumbnail: string;
}

export type ScoreMode = 'face' | 'age' | 'charm';
