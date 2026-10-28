import { scaleNutrients } from './nutritionEditing';

export function quickFoodBody(log: Record<string, any>, factor: number, context: {clientRequestId:string;loggedAt:string;mealType:string;visibility:string}) {
  if (![0.5,1,2].includes(factor)) throw new Error('份量不合法');
  const body: Record<string,any> = {};
  for(const key of ['calories','proteinGram','carbsGram','fatGram','fiberGram','sugarGram','sodiumMg','nutrients','items','note','source','aiProvider','aiModel','aiRoute']) {
    if(log[key]!=null)body[key]=log[key];
  }
  for(const key of ['calories','proteinGram','carbsGram','fatGram']) {
    if(!Number.isFinite(body[key])||body[key]<0)throw new Error('常用餐食数据不完整，请重新收藏');
  }
  return {...scaleNutrients(body,factor),clientRequestId:context.clientRequestId,loggedAt:context.loggedAt,mealType:context.mealType,visibility:context.visibility};
}
