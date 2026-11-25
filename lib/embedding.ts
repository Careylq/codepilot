/**
 * Embedding 客户端：调 OpenAI 兼容的 /embeddings 接口。
 * 默认用硅基流动的 BAAI/bge-m3（1024 维）。
 */

export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  const baseURL =
    process.env.EMBEDDING_BASE_URL ?? "https://api.siliconflow.cn/v1";
  const model = process.env.EMBEDDING_MODEL ?? "BAAI/bge-m3";

  if (!apiKey) throw new Error("缺少 EMBEDDING_API_KEY");

  const res = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    throw new Error(`embedding 接口报错：${await res.text()}`);
  }

  const data = await res.json();
  return (data.data as { index?: number; embedding: number[] }[])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
