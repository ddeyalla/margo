/** A hover glance's answer: the term's meaning in its sentence, one example, and whether the sentence teaches it. */
export interface Glance {
  gist: string;
  example: string;
  core: boolean;
}
