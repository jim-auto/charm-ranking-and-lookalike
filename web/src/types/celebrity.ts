export interface ScoreDetails {
  symmetry: number;
  golden_ratio: number;
  eyes: number;
  nose: number;
  mouth: number;
  contour: number;
  skin: number;
}

export interface Celebrity {
  id: string;
  name: string;
  category: 'actor' | 'actress' | 'idol' | 'influencer';
  score: number;
  details: ScoreDetails;
  embedding: number[];
  thumbnail: string;
}
