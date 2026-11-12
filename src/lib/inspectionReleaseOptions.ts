import type {InspectionReleaseForm} from './vehicleInspectionRelease';

type Choice={id:string;en:string;ar:string};
/** Choices resolve to the existing text fields. No second persistence model,
 * guessed findings, historical rewrite or additional database column. */
export const inspectionReleaseChoices:Partial<Record<keyof InspectionReleaseForm,Choice[]>>={
  inspection_summary:[
    {id:'visual',en:'Visual inspection only',ar:'معاينة ظاهرية فقط'},
    {id:'diagnostic',en:'Diagnostic inspection',ar:'فحص تشخيصي'},
    {id:'damage_assessment',en:'Accident damage assessment',ar:'معاينة أضرار الحادث'},
    {id:'technical_report',en:'Inspection as recorded in the linked technical declaration',ar:'الفحص حسب الإقرار الفني المرتبط'},
  ],
  pending_action:[
    {id:'insurance_approval',en:'Awaiting insurance approval',ar:'بانتظار موافقة التأمين'},
    {id:'repair_order',en:'Awaiting repair order / LPO',ar:'بانتظار أمر الإصلاح / LPO'},
    {id:'customer_decision',en:'Awaiting customer decision',ar:'بانتظار قرار العميل'},
    {id:'return_appointment',en:'Arrange a return appointment',ar:'تنسيق موعد العودة'},
    {id:'parts',en:'Awaiting parts availability',ar:'بانتظار توفر القطع'},
  ],
  exit_condition:[
    {id:'drivable',en:'Drivable at temporary release',ar:'تتحرك عند التسليم المؤقت'},
    {id:'towing',en:'Requires towing / transport',ar:'تحتاج رافعة / نقل'},
    {id:'not_tested',en:'Driving condition not tested',ar:'لم تُختبر قابلية القيادة'},
  ],
  inspected_items:[
    {id:'exterior',en:'Exterior and visible damage',ar:'الهيكل الخارجي والأضرار الظاهرة'},
    {id:'dashboard',en:'Dashboard warning indicators',ar:'لمبات التحذير'},
    {id:'diagnostics',en:'Diagnostic scan',ar:'فحص الكمبيوتر'},
    {id:'chassis',en:'Chassis inspection',ar:'فحص الشاصي'},
    {id:'electrical',en:'Electrical inspection',ar:'فحص الكهرباء'},
  ],
  uninspected_items:[
    {id:'no_full_mechanical',en:'No full mechanical inspection performed',ar:'لم يُجر فحص ميكانيكي شامل'},
    {id:'no_road_test',en:'No road test performed',ar:'لم تُجر تجربة قيادة'},
    {id:'concealed',en:'Concealed damage not inspected without dismantling',ar:'الأضرار المخفية لم تُفحص دون فك'},
  ],
  visible_damage:[{id:'entry_map',en:'As recorded in the entry damage map',ar:'حسب خريطة الأضرار المسجلة عند الدخول'}],
  recipient_relation:[
    {id:'visit_customer',en:'Visit customer',ar:'عميل الزيارة'},
    {id:'authorized_person',en:'Authorized representative',ar:'مفوض بالاستلام'},
    {id:'driver',en:'Driver',ar:'سائق'},
    {id:'tow_driver',en:'Tow-truck driver',ar:'سائق الرافعة'},
  ],
};

export function inspectionReleaseChoiceId(field:keyof InspectionReleaseForm,value:string):string|undefined{
  return inspectionReleaseChoices[field]?.find(option=>option.en===value.trim()||option.ar===value.trim())?.id;
}
export function inspectionReleaseDisplayValue(field:keyof InspectionReleaseForm,value:string,language:'ar'|'en'):string{
  return String(value||'').split('\n').map(line=>{
    const option=inspectionReleaseChoices[field]?.find(item=>item.en===line.trim()||item.ar===line.trim());
    return option?option[language]:line;
  }).join('\n');
}
