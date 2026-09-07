export function scaleNutrients<T extends Record<string, any>>(value: T, factor: number): T {
  const result = { ...value };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'number' && /^(calories|estimatedWeightGram)$|Gram$|Mg$|IU$/.test(key)) {
      (result as Record<string, any>)[key] = Math.round(result[key] * factor * 10) / 10;
    }
  }
  if (Array.isArray(value.items)) (result as Record<string, any>).items = value.items.map(item => scaleNutrients(item, factor));
  if (value.nutrients) (result as Record<string, any>).nutrients = scaleNutrients(value.nutrients, factor);
  return result;
}
