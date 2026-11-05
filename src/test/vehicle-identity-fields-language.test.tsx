// @vitest-environment jsdom
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import i18n from '@/i18n';
import VehicleColorSelect from '@/components/vehicles/VehicleColorSelect';
import VehicleMakeModelPicker from '@/components/insurance/VehicleMakeModelPicker';
import VinScannerButton from '@/components/scanner/VinScannerButton';
vi.mock('@/hooks/useVehicleMakesModels',()=>({useVehicleMakes:()=>({data:[{id:'make',name:'Dodge',name_ar:'دودج'}]}),useVehicleModels:()=>({data:[]}),useCreateMake:()=>({mutateAsync:vi.fn()}),useCreateModel:()=>({mutateAsync:vi.fn()})}));
beforeEach(async()=>{await i18n.changeLanguage('en');});
afterEach(()=>{vi.restoreAllMocks();});
describe('shared vehicle identity controls',()=>{
  it('shows English make/model/color labels without altering stored Arabic color values',()=>{
    const storedColor='أحمر';
    const change=vi.fn();const {container}=render(<><VehicleMakeModelPicker make="Dodge" model="Ram" plate="TT 99981" year="2022" color={storedColor} vin="1C6RR7LT0NS000001" onChange={change}/><VehicleColorSelect value={storedColor} onChange={change}/></>);
    expect(screen.getByRole('combobox',{name:'Make'})).toBeTruthy();expect(screen.getByRole('combobox',{name:'Model'})).toBeTruthy();
    expect(screen.getAllByText('Red').length).toBeGreaterThan(0);expect(container.textContent).not.toMatch(/[\u0600-\u06ff]/);expect(change).not.toHaveBeenCalled();
  });
  it('stops an active VIN camera when the wizard step unmounts',async()=>{
    const stop=vi.fn(),stream={getTracks:()=>[{stop}]};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue(stream)}});
    const view=render(<VinScannerButton onResult={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Scan VIN with camera'}));
    await screen.findByRole('heading',{name:'Scan VIN'});await waitFor(()=>expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    view.unmount();expect(stop).toHaveBeenCalled();
  });
  it('stops a camera permission result that arrives after navigation instead of leaving the camera open',async()=>{
    const stop=vi.fn();let resolve:(stream:unknown)=>void=()=>{};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(()=>new Promise(done=>{resolve=done;}))}});
    const view=render(<VinScannerButton onResult={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Scan VIN with camera'}));view.unmount();
    await act(async()=>resolve({getTracks:()=>[{stop}]}));expect(stop).toHaveBeenCalledOnce();
  });
});
