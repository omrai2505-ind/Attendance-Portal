const EMBEDDING_DIMENSIONS = 128;

function validateEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new TypeError(`Embedding must contain ${EMBEDDING_DIMENSIONS} values`);
  }

  if (!embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('Embedding values must be finite numbers');
  }

  const norm = Math.hypot(...embedding);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new TypeError('Embedding must have a non-zero finite norm');
  }
  return embedding;
}

function cosineSimilarity(left, right) {
  validateEmbedding(left);
  validateEmbedding(right);

  let dotProduct = 0;
  let leftNormSquared = 0;
  let rightNormSquared = 0;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    dotProduct += left[index] * right[index];
    leftNormSquared += left[index] * left[index];
    rightNormSquared += right[index] * right[index];
  }

  const denominator = Math.sqrt(leftNormSquared) * Math.sqrt(rightNormSquared);
  if (!Number.isFinite(denominator) || denominator === 0) {
    throw new TypeError('Embedding similarity is undefined');
  }

  const similarity = dotProduct / denominator;
  if (!Number.isFinite(similarity)) {
    throw new TypeError('Embedding similarity is not finite');
  }
  return similarity;
}

function averageEmbeddings(embeddings) {
  if (!Array.isArray(embeddings) || embeddings.length < 2 || embeddings.length > 3) {
    throw new TypeError('Enrollment requires two or three embeddings');
  }
  embeddings.forEach(validateEmbedding);

  const mean = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    embeddings.reduce((sum, embedding) => sum + embedding[index], 0) / embeddings.length
  );
  const norm = Math.hypot(...mean);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new TypeError('Enrollment samples produced an invalid average embedding');
  }
  return mean.map((value) => value / norm);
}

module.exports = { EMBEDDING_DIMENSIONS, validateEmbedding, cosineSimilarity, averageEmbeddings };
