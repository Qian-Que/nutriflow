import { scaleNutrients } from './nutritionEditing';
import type { JobTimings } from './backgroundRecognition';

export const REVIEW_CACHE_KEY = 'recognition-review-v1';
export const nutrientFields = [
  ['calories', '热量', 'kcal'], ['proteinGram', '蛋白质', 'g'], ['carbsGram', '碳水', 'g'],
  ['fatGram', '脂肪', 'g'], ['fiberGram', '纤维', 'g'],
] as const;
export type ReviewDraft = {
  kind: 'FOOD' | 'EXERCISE'; body: Record<string, any>; confidence: number;
  fallback?: string; acknowledged: boolean; submitted?: boolean;
  weightBases?: Record<number, Record<string, any>>;
  jobId?: string;
  timings?: JobTimings;
};
export const reviewCacheKey = (jobId?: string) => jobId ? `recognition-review:${jobId}` : REVIEW_CACHE_KEY;
export function needsReviewAcknowledgement(draft: ReviewDraft) {
  return draft.fallback === 'TEXT_ONLY' || !Number.isFinite(draft.confidence) || draft.confidence < 0.7;
}
function numeric(value: unknown, max = 100000, min = 0) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`请填写 ${min}–${max} 范围内的数字`);
  return n;
}
export function reviewBody(draft: ReviewDraft) {
  if (needsReviewAcknowledgement(draft) && !draft.acknowledged) throw new Error('请先确认已核对不确定的识别结果');
  const body = { ...draft.body };
  if (draft.kind === 'FOOD') {
    if (!Array.isArray(body.items) || !body.items.length) throw new Error('至少保留一种食物');
    body.items = body.items.map((item: Record<string, any>) => {
      const result: Record<string, any> = { ...item, name: String(item.name ?? '').trim() };
      if (!result.name || result.name.length > 100) throw new Error('食物名称须为 1–100 个字');
      for (const [key] of nutrientFields) result[key] = numeric(item[key] ?? (key === 'fiberGram' ? 0 : undefined));
      if (item.estimatedWeightGram !== undefined) result.estimatedWeightGram = numeric(item.estimatedWeightGram, 100000, 0.1);
      return result;
    });
    for (const [key] of nutrientFields) body[key] = numeric(body[key] ?? 0);
  } else {
    body.exerciseType = String(body.exerciseType ?? '').trim();
    if (!body.exerciseType || body.exerciseType.length > 60) throw new Error('请填写运动名称（最多 60 字）');
    body.durationMin = numeric(body.durationMin, 600, 1);
    body.calories = numeric(body.calories, 5000);
    body.met = numeric(body.met, 20, 1);
  }
  if (String(body.note ?? '').length > 300) throw new Error('备注最多 300 字');
  return body;
}
export function changeReviewItem(draft: ReviewDraft, index: number, key: string, value: string): ReviewDraft {
  const current = draft.body.items[index];
  const basis = Number(current.estimatedWeightGram) > 0 ? current : draft.weightBases?.[index];
  const weightBases = basis ? { ...draft.weightBases, [index]: basis } : draft.weightBases;
  const items = draft.body.items.map((item: Record<string, any>, i: number) => {
    if (i !== index) return item;
    let next = { ...item, [key]: value };
    if (key === 'estimatedWeightGram' && Number(value) > 0 && basis) {
      const numericItem = { ...basis, name: item.name };
      for (const [field] of nutrientFields) numericItem[field] = Number(basis[field] ?? 0);
      next = { ...scaleNutrients(numericItem, Number(value) / Number(basis.estimatedWeightGram)), [key]: value };
    }
    return next;
  });
  const body: Record<string, any> = { ...draft.body, items };
  if (key !== 'name') {
    for (const [field] of nutrientFields) body[field] = Math.round(items.reduce((sum: number, item: any) => sum + (Number(item[field]) || 0), 0) * 10) / 10;
    // Item-level micronutrients are unavailable; do not retain stale whole-meal estimates after a correction.
    delete body.nutrients; delete body.sugarGram; delete body.sodiumMg;
  }
  return { ...draft, body, weightBases };
}
export function scaleReview(draft: ReviewDraft, factor: number): ReviewDraft {
  const body = reviewBody({ ...draft, acknowledged: true });
  return { ...draft, body: scaleNutrients(body, factor) };
}
export function removeReviewItem(draft: ReviewDraft, index: number): ReviewDraft {
  if (draft.body.items.length <= 1) return draft;
  const next = { ...draft, body: { ...draft.body, items: draft.body.items.filter((_: unknown, i: number) => i !== index) }, weightBases: undefined };
  return changeReviewItem(next, 0, 'calories', String(next.body.items[0].calories));
}
