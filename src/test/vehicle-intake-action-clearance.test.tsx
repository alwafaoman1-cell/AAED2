// @vitest-environment jsdom
import {render,fireEvent} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useRef} from 'react';
import {useFixedActionBarClearance} from '@/hooks/useFixedActionBarClearance';
function Bar(){const ref=useRef<HTMLDivElement>(null);useFixedActionBarClearance(ref);return <div ref={ref}/>;}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.documentElement.style.removeProperty('--app-form-action-clearance');});
describe('intake action bar and floating shortcuts',()=>{
  it('observes the form container so a wizard step change updates position even when the bar keeps its height',()=>{
    Object.defineProperty(window,'innerHeight',{configurable:true,value:1000});
    let top=500;let changed=()=>{};const observe=vi.fn();
    vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){changed=callback;}observe=observe;disconnect(){} });
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({top,bottom:top+64,height:64} as DOMRect));
    render(<Bar/>);expect(observe).toHaveBeenCalledTimes(2);
    expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('0px');
    top=927;changed();expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('85px');
  });
  it('reserves the actual footer position on a tablet, including the gap below it',()=>{
    Object.defineProperty(window,'innerHeight',{configurable:true,value:1180});
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({top:1040,bottom:1108,height:68} as DOMRect);
    const view=render(<Bar/>);
    expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('152px');
    view.unmount();expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('');
  });
  it('recalculates on nested scrolling and releases clearance when the bar leaves the bottom region',()=>{
    Object.defineProperty(window,'innerHeight',{configurable:true,value:1000});
    let top=920;
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({top,bottom:top+64,height:64} as DOMRect));
    render(<Bar/>);expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('92px');
    top=500;fireEvent.scroll(window);expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('0px');
    top=910;fireEvent.resize(window);expect(document.documentElement.style.getPropertyValue('--app-form-action-clearance')).toBe('102px');
  });
});
