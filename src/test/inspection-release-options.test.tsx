// @vitest-environment jsdom
import {useState} from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import i18n from '@/i18n';
import {InspectionReleaseChoiceField} from '@/components/vehicle-entry/InspectionReleaseChoiceField';
import {inspectionReleaseDisplayValue} from '@/lib/inspectionReleaseOptions';
beforeEach(async()=>{await i18n.changeLanguage('en');});
describe('inspection release choices without invented findings',()=>{
  it('starts unselected and writes the explicit chosen fact only',()=>{
    const change=vi.fn();render(<InspectionReleaseChoiceField field="inspection_summary" value="" disabled={false} required onChange={change}/>);
    expect(change).not.toHaveBeenCalled();expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Visual inspection only'}));expect(change).toHaveBeenCalledWith('Visual inspection only');
  });
  it('preserves unrecognized historical text and exposes it for explicit editing',()=>{
    const change=vi.fn();render(<InspectionReleaseChoiceField field="inspection_summary" value="Old technician wording" disabled={false} onChange={change}/>);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Old technician wording');expect(change).not.toHaveBeenCalled();
  });
  it('supports several inspected items without a parallel persisted schema',()=>{
    function Harness(){const[value,setValue]=useState('');return <InspectionReleaseChoiceField field="inspected_items" value={value} disabled={false} multiple onChange={setValue}/>;}
    render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Exterior and visible damage'}));fireEvent.click(screen.getByRole('button',{name:'Diagnostic scan'}));
    expect(screen.getByRole('button',{name:'Exterior and visible damage'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button',{name:'Diagnostic scan'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('translates known choices for display/print, but never rewrites free text',()=>{
    expect(inspectionReleaseDisplayValue('inspection_summary','معاينة ظاهرية فقط','en')).toBe('Visual inspection only');
    expect(inspectionReleaseDisplayValue('pending_action','Awaiting customer decision','ar')).toBe('بانتظار قرار العميل');
    expect(inspectionReleaseDisplayValue('notes','Legacy custom note','ar')).toBe('Legacy custom note');
  });
});
