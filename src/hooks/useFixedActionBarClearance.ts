import {useLayoutEffect,type RefObject} from 'react';

/** Keep global floating actions above a form's sticky save/navigation bar. */
export function useFixedActionBarClearance(ref:RefObject<HTMLElement>,enabled=true){
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!enabled||!element)return;
    const root=document.documentElement;
    const key='--app-form-action-clearance';
    const previous=root.style.getPropertyValue(key);
    const update=()=>{
      const rect=element.getBoundingClientRect();
      const visible=rect.top<window.innerHeight && rect.bottom>0;
      // A sticky bar can still be above the bottom edge while in normal flow.
      // Reserve its measured viewport position, not just its own height.
      const clearance=visible && rect.bottom>window.innerHeight-160 ? Math.max(0,Math.ceil(window.innerHeight-rect.top)+12):0;
      const value=`${clearance}px`;
      if(root.style.getPropertyValue(key)!==value)root.style.setProperty(key,value);
    };
    update();
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null;
    observer?.observe(element);
    // Changing wizard steps moves the bar without changing its own size.
    if(element.parentElement)observer?.observe(element.parentElement);
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,{passive:true,capture:true});
    return ()=>{observer?.disconnect();window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);if(previous)root.style.setProperty(key,previous);else root.style.removeProperty(key);};
  },[ref,enabled]);
}
