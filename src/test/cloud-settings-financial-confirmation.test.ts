import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({tenant:'tenant-a' as string|null,read:vi.fn()}));
vi.mock('@/lib/cloud/createCloudStore',()=>({getCurrentTenantId:async()=>db.tenant}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select(){return this;},eq(){return this;},maybeSingle:db.read})}}));
import { clearCloudSettingsCache, readCloudSettingFresh, setCloudSettingsTenantScope } from '@/lib/cloudSettings';
beforeEach(()=>{clearCloudSettingsCache();db.tenant='tenant-a';db.read.mockReset();});
describe('confirmed financial setting reads',()=>{
  it('accepts an explicitly absent setting only after a successful cloud response',async()=>{
    db.read.mockResolvedValue({data:null,error:null});
    await expect(readCloudSettingFresh('monthly',{}, {requireConfirmed:true})).resolves.toEqual({});
  });
  it('does not turn unavailable tenant or denied reads into zero overhead',async()=>{
    db.tenant=null;
    await expect(readCloudSettingFresh('monthly',{}, {requireConfirmed:true})).rejects.toThrow('CLOUD_SETTING_TENANT_REQUIRED');
    expect(db.read).not.toHaveBeenCalled();db.tenant='tenant-a';
    db.read.mockResolvedValue({data:null,error:new Error('42501')});
    await expect(readCloudSettingFresh('monthly',{}, {requireConfirmed:true})).rejects.toThrow('42501');
  });
  it('rejects a response from a previous login or tenant',async()=>{
    db.read.mockImplementation(async()=>{setCloudSettingsTenantScope('tenant-b');return {data:{value:{total:5},version:1},error:null};});
    await expect(readCloudSettingFresh('monthly',{}, {requireConfirmed:true})).rejects.toThrow('CLOUD_SETTING_SESSION_CHANGED_DURING_READ');
  });
  it('rejects a replica response older than the latest confirmed value',async()=>{
    db.read.mockResolvedValueOnce({data:{value:{total:50},version:2},error:null})
      .mockResolvedValueOnce({data:{value:{total:0},version:1},error:null});
    await readCloudSettingFresh('monthly',{}, {requireConfirmed:true});
    await expect(readCloudSettingFresh('monthly',{}, {requireConfirmed:true})).rejects.toThrow('CLOUD_SETTING_STALE_READ');
  });
  it('keeps non-financial callers backward compatible without a tenant',async()=>{
    db.tenant=null;await expect(readCloudSettingFresh('theme','light')).resolves.toBe('light');
  });
});
