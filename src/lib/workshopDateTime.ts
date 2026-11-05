/** Entry/custody wall-clock values use the workshop timezone, not browser UTC. */
export function workshopDateTime(value:Date|string|number|null|undefined):{date:string;time:string}{
  if(value==null)return {date:'',time:''};
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return {date:'',time:''};
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Muscat',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part=(name:string)=>parts.find(item=>item.type===name)?.value || '';
  return {date:`${part('year')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}`};
}
