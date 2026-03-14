export interface ScoreDetails {
  golden_ratio: number;
  eyes: number;
  nose: number;
  mouth: number;
  contour: number;
}

export interface SnsFollowers {
  instagram?: number;
  twitter?: number;
  tiktok?: number;
  youtube?: number;
}

export interface ScoreSet {
  face: number;
  faceAge: number;
  faceSns: number;
  faceAgeSns: number;
}

export interface Celebrity {
  id: string;
  name: string;
  category: 'actor' | 'actress' | 'idol' | 'influencer' | 'artist';
  gender: 'male' | 'female';
  score: number;
  scoreWithAge: number;
  scoreCharm: number;
  scores: ScoreSet;
  age: number;
  sns: SnsFollowers;
  totalFollowers: number;
  details: ScoreDetails;
  group?: string;
  embedding: number[];
  thumbnail: string;
}
