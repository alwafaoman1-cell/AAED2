import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryKeys } from "@/lib/queryKeys";
import { getExpenseCategory, listExpenseCategories, saveExpenseCategory } from "@/lib/expenses/expenseClassificationService";

const initial:any={code:"",name_ar:"",name_en:"",parent_id:"",category_type:"category",expense_scope:"both",accounting_mapping_key:"",sort_order:100,description_ar:"",description_en:"",is_active:true};
export default function ExpenseCategoryFormPage(){
 const {i18n}=useTranslation(); const isAr=i18n.language?.startsWith('ar');
 const {categoryId}=useParams(); const edit=!!categoryId; const {profile,user}=useAuth(); const tenantId=profile?.tenant_id||""; const nav=useNavigate(); const qc=useQueryClient(); const [form,setForm]=useState(initial);
 const parents=useQuery({queryKey:queryKeys.expenseManagement.categories({tenantId}),enabled:!!tenantId,queryFn:()=>listExpenseCategories(tenantId,false)});
 const detail=useQuery({queryKey:queryKeys.expenseManagement.category(categoryId),enabled:!!tenantId&&edit,queryFn:()=>getExpenseCategory(tenantId,categoryId!)});
 useEffect(()=>{if(detail.data)setForm({...initial,...detail.data,parent_id:detail.data.parent_id||""})},[detail.data]);
 const save=useMutation({mutationFn:()=>saveExpenseCategory(tenantId,user?.id||"",{...form,parent_id:form.parent_id||null,accounting_mapping_key:form.accounting_mapping_key||null,sort_order:Number(form.sort_order)},categoryId),onSuccess:()=>{toast.success("تم حفظ التصنيف");void qc.invalidateQueries({queryKey:queryKeys.expenseManagement.all});nav('/accounting/expenses/categories')},onError:(e:Error)=>toast.error(e.message)});
 const submit=(e:FormEvent)=>{e.preventDefault();if(!form.name_ar.trim()||!form.name_en.trim()||!form.code.trim()){toast.error('الاسم العربي والإنجليزي والكود مطلوبة');return}save.mutate()};
 return <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6" dir={isAr?'rtl':'ltr'}><div><h1 className="text-2xl font-bold">{edit?'تعديل تصنيف':'تصنيف مصروف جديد'}</h1><p className="text-sm text-muted-foreground">لا توجد نافذة مؤقتة؛ جميع خصائص التصنيف محفوظة في Supabase.</p></div><form onSubmit={submit}><Card><CardHeader><CardTitle>البيانات الأساسية</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
  <div><Label>الكود</Label><Input value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/></div><div><Label>التصنيف الأب</Label><Select value={form.parent_id||"root"} onValueChange={v=>setForm({...form,parent_id:v==='root'?'':v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="root">جذر / Root</SelectItem>{(parents.data||[]).filter(p=>p.id!==categoryId).map(p=><SelectItem key={p.id} value={p.id}>{p.name_ar} / {p.name_en}</SelectItem>)}</SelectContent></Select></div>
  <div><Label>الاسم بالعربية</Label><Input value={form.name_ar} onChange={e=>setForm({...form,name_ar:e.target.value})}/></div><div><Label>English name</Label><Input dir="ltr" value={form.name_en} onChange={e=>setForm({...form,name_en:e.target.value})}/></div>
  <div><Label>النوع</Label><Select value={form.category_type} onValueChange={v=>setForm({...form,category_type:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="department">Department</SelectItem><SelectItem value="category">Category</SelectItem><SelectItem value="subcategory">Subcategory</SelectItem></SelectContent></Select></div>
  <div><Label>النطاق</Label><Select value={form.expense_scope} onValueChange={v=>setForm({...form,expense_scope:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="work_order">Work Order</SelectItem><SelectItem value="operating">Operating</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent></Select></div>
  <div><Label>Accounting Mapping Key</Label><Input dir="ltr" value={form.accounting_mapping_key||""} onChange={e=>setForm({...form,accounting_mapping_key:e.target.value})}/></div><div><Label>ترتيب العرض</Label><Input type="number" value={form.sort_order} onChange={e=>setForm({...form,sort_order:e.target.value})}/></div>
  <div><Label>وصف عربي</Label><Textarea value={form.description_ar||""} onChange={e=>setForm({...form,description_ar:e.target.value})}/></div><div><Label>English description</Label><Textarea dir="ltr" value={form.description_en||""} onChange={e=>setForm({...form,description_en:e.target.value})}/></div>
  <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending?'جاري الحفظ...':'حفظ'}</Button><Button variant="outline" asChild><Link to="/accounting/expenses/categories">إلغاء</Link></Button></div>
 </CardContent></Card></form></div>;
}
