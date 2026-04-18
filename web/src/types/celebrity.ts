export interface ScoreDetails {
  symmetry?: number;
  golden_ratio: number;
  eyes: number;
  nose: number;
  mouth: number;
  contour: number;
  skin?: number;
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
  category: string;
  gender?: 'male' | 'female' | 'unknown';
  score: number;
  scoreWithAge?: number;
  scoreCharm?: number;
  scores: ScoreSet;
  age?: number;
  sns?: SnsFollowers;
  totalFollowers?: number;
  details: ScoreDetails;
  group?: string;
  thumbnail: string;
  birthDate?: string;
  rank?: number;
  rankingEligible?: boolean;
  rankingExclusionReasons?: string[];
  faceValidationStatus?: 'accepted' | 'undetected' | 'rejected';
  faceValidationReason?: string;
  faceValidationSource?: string;
}
