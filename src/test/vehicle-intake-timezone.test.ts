import {afterEach,describe,expect,it,vi} from 'vitest';
import {defaultVehicleEntryForm} from '@/lib/vehicleEntryService';
import {workshopDateTime} from '@/lib/workshopDateTime';
afterEach(()=>vi.useRealTimers());
describe('workshop intake local clock',()=>{
  it('does not assign the previous UTC day to an after-midnight Oman arrival',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T20:15:00Z'));
    expect(defaultVehicleEntryForm()).toMatchObject({arrival_date:'2026-11-05',arrival_time:'00:15'});
  });
  it('keeps claim-only projection and entry defaults on the same timezone',()=>{
    expect(workshopDateTime('2026-10-20T21:30:00Z')).toEqual({date:'2026-10-21',time:'01:30'});
    expect(workshopDateTime('invalid')).toEqual({date:'',time:''});
  });
});
