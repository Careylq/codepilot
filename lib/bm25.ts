/**
 * 极简 BM25 实现。
 *
 * 打分公式：
 *   score = Σ idf(term) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))
 *
 * k1：词频饱和速度（越大，词频影响越持久）
 * b ：长度归一化强度（0 = 不归一化，1 = 完全归一化）
 */

export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  for (const raw of text.split(/[^a-zA-Z0-9_]+/)) {
    if (!raw) continue;

    // 完整标识符（小写），例如 readFileTool -> readfiletool
    const whole = raw.toLowerCase();
    if (whole.length > 1) tokens.push(whole);

    // camelCase 拆开，例如 readFileTool -> read / file / tool
    const parts = raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/\s+/);
    if (parts.length > 1) {
      for (const p of parts) if (p.length > 1) tokens.push(p);
    }
  }

  return tokens;
}

type Doc = { id: number; tokens: string[] };

export class BM25 {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(
    private k1 = 1.5,
    private b = 0.75,
  ) { }

  add(tokens: string[]) {
    const id = this.docs.length;
    this.docs.push({ id, tokens });
    for (const term of new Set(tokens)) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
  }

  finalize() {
    const total = this.docs.reduce((sum, d) => sum + d.tokens.length, 0);
    this.avgLen = total / (this.docs.length || 1);
  }

  score(query: string[]): { id: number; score: number }[] {
    const N = this.docs.length;
    const out: { id: number; score: number }[] = [];

    for (const doc of this.docs) {
      let s = 0;
      const dl = doc.tokens.length;

      for (const term of query) {
        const df = this.df.get(term) ?? 0;
        if (df === 0) continue;

        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const tf = doc.tokens.filter((t) => t === term).length;

        s +=
          idf *
          ((tf * (this.k1 + 1)) /
            (tf + this.k1 * (1 - this.b + (this.b * dl) / this.avgLen)));
      }

      if (s > 0) out.push({ id: doc.id, score: s });
    }

    return out.sort((a, b) => b.score - a.score);
  }

  get size() {
    return this.docs.length;
  }
}
