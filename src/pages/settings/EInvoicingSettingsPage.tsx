import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileJson, Save, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { smartBack } from "@/lib/smartBack";
import { readCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";
import {
  DEFAULT_COMPANY_TAX_PROFILE,
  buildInternalEInvoicePayload,
  makeEInvoiceLine,
} from "@/lib/e-invoicing/einvoicePayload";
import { buildEInvoicingReadinessChecks } from "@/lib/e-invoicing/readinessChecks";
import { downloadJsonFile } from "@/lib/e-invoicing/exportEinvoiceJson";
import type { CompanyTaxProfile, ReadinessStatus, ServiceProviderSettings } from "@/lib/e-invoicing/omanEInvoiceTypes";

const COMPANY_KEY = "company_tax_profile_v1";
const PROVIDER_KEY = "einvoicing_service_provider_v1";

const DEFAULT_PROVIDER: ServiceProviderSettings = {
  status: "not_connected",
  providerName: "",
  environment: "sandbox",
  apiEndpoint: "",
  clientId: "",
  certificateStatus: "not_configured",
};

const STATUS_CLASS: Record<ReadinessStatus, string> = {
  Ready: "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Partially Ready": "bg-amber-100 text-amber-700 border-amber-200",
  "Not Ready": "bg-red-100 text-red-700 border-red-200",
  "Needs Accountant Verification": "bg-blue-100 text-blue-700 border-blue-200",
  "Needs Tax Authority Verification": "bg-purple-100 text-purple-700 border-purple-200",
};

export default function EInvoicingSettingsPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState<CompanyTaxProfile>(DEFAULT_COMPANY_TAX_PROFILE);
  const [provider, setProvider] = useState<ServiceProviderSettings>(DEFAULT_PROVIDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      readCloudSetting<CompanyTaxProfile>(COMPANY_KEY, DEFAULT_COMPANY_TAX_PROFILE),
      readCloudSetting<ServiceProviderSettings>(PROVIDER_KEY, DEFAULT_PROVIDER),
    ]).then(([companyValue, providerValue]) => {
      if (!mounted) return;
      setCompany({ ...DEFAULT_COMPANY_TAX_PROFILE, ...(companyValue || {}) });
      setProvider({ ...DEFAULT_PROVIDER, ...(providerValue || {}) });
    }).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const checks = useMemo(() => buildEInvoicingReadinessChecks({
    company,
    serviceProvider: provider,
    hasInvoices: true,
    hasQr: true,
    hasAudit: true,
    hasExports: true,
    hasSnapshots: false,
    hasCreditNotes: false,
  }), [company, provider]);

  const readinessSummary = useMemo(() => {
    const ready = checks.filter((c) => c.status === "Ready").length;
    const notReady = checks.filter((c) => c.status === "Not Ready").length;
    return {
      dailyAccounting: notReady <= 2 ? "Partially Ready" : "Not Ready",
      vatReporting: "Partially Ready",
      official: provider.status === "connected" ? "Needs Tax Authority Verification" : "Not Ready",
      score: Math.round((ready / checks.length) * 100),
    };
  }, [checks, provider.status]);

  async function save() {
    setSaving(true);
    try {
      await writeCloudSetting(COMPANY_KEY, company);
      await writeCloudSetting(PROVIDER_KEY, provider);
      toast.success("E-Invoicing readiness settings saved.");
    } catch (error: any) {
      toast.error(error?.message || "Failed to save e-invoicing settings.");
    } finally {
      setSaving(false);
    }
  }

  async function exportReadinessJson() {
    const payload = await buildInternalEInvoicePayload({
      seller: company,
      buyer: { type: "sample", note: "Readiness export only - not an official tax payload." },
      invoiceNumber: "READINESS-SAMPLE",
      invoiceDate: new Date().toISOString(),
      invoiceType: "unknown",
      lineItems: [makeEInvoiceLine("Readiness sample line", 1, 100, Number(company.vatRate || 5) / 100)],
      paymentStatus: "sample",
      sourceSystemId: "aaed2",
    });
    downloadJsonFile(`Fawtara_Readiness_${new Date().toISOString().slice(0, 10)}.json`, {
      disclaimer: "Internal E-Invoice Payload for readiness review only. Not submitted to Oman Tax Authority.",
      company,
      provider,
      readiness: checks,
      samplePayload: payload,
    });
  }

  const updateCompany = <K extends keyof CompanyTaxProfile>(key: K, value: CompanyTaxProfile[K]) =>
    setCompany((current) => ({ ...current, [key]: value }));
  const updateProvider = <K extends keyof ServiceProviderSettings>(key: K, value: ServiceProviderSettings[K]) =>
    setProvider((current) => ({ ...current, [key]: value }));

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings")}>
              <ArrowLeft className="rtl:rotate-180" />
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <ShieldCheck className="text-primary" />
                Oman E-Invoicing / Fawtara Readiness
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Internal readiness only. This page does not claim government approval or official Tax Authority connection.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportReadinessJson} className="gap-2">
              <FileJson size={16} /> JSON readiness export
            </Button>
            <Button onClick={save} disabled={saving || loading} className="gap-2">
              <Save size={16} /> Save
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <ReadinessCard label="Daily accounting" value={readinessSummary.dailyAccounting as ReadinessStatus} />
          <ReadinessCard label="VAT reporting" value={readinessSummary.vatReporting as ReadinessStatus} />
          <ReadinessCard label="Official e-invoicing" value={readinessSummary.official as ReadinessStatus} />
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Internal readiness score</div>
              <div className="text-2xl font-bold mt-1">{readinessSummary.score}%</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="company" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto justify-start">
            <TabsTrigger value="company">Company Tax Profile</TabsTrigger>
            <TabsTrigger value="provider">Service Provider</TabsTrigger>
            <TabsTrigger value="readiness">Readiness Checklist</TabsTrigger>
          </TabsList>

          <TabsContent value="company">
            <Card>
              <CardHeader><CardTitle>Company Tax Profile</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Company Legal Name Arabic" value={company.legalNameAr} onChange={(v) => updateCompany("legalNameAr", v)} />
                <Field label="Company Legal Name English" value={company.legalNameEn} onChange={(v) => updateCompany("legalNameEn", v)} />
                <Field label="Commercial Registration Number CR" value={company.commercialRegistration} onChange={(v) => updateCompany("commercialRegistration", v)} />
                <Field label="VAT Registration Number" value={company.vatRegistrationNumber} onChange={(v) => updateCompany("vatRegistrationNumber", v)} />
                <Field label="Taxpayer Identification" value={company.taxpayerIdentification || ""} onChange={(v) => updateCompany("taxpayerIdentification", v)} />
                <Field label="Address" value={company.address} onChange={(v) => updateCompany("address", v)} />
                <Field label="City" value={company.city} onChange={(v) => updateCompany("city", v)} />
                <Field label="Country" value={company.country} onChange={(v) => updateCompany("country", v)} />
                <Field label="Phone" value={company.phone} onChange={(v) => updateCompany("phone", v)} />
                <Field label="Email" value={company.email} onChange={(v) => updateCompany("email", v)} />
                <Field label="Default currency" value={company.defaultCurrency} disabled onChange={() => undefined} />
                <Field label="VAT rate %" value={String(company.vatRate)} onChange={(v) => updateCompany("vatRate", Number(v) || 5)} />
                <div className="space-y-2">
                  <Label>E-invoicing status</Label>
                  <Select value={company.eInvoicingStatus} onValueChange={(v) => updateCompany("eInvoicingStatus", v as CompanyTaxProfile["eInvoicingStatus"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_configured">Not configured</SelectItem>
                      <SelectItem value="ready_for_internal_review">Ready for internal review</SelectItem>
                      <SelectItem value="pending_service_provider">Pending service provider</SelectItem>
                      <SelectItem value="connected_to_service_provider">Connected to service provider</SelectItem>
                      <SelectItem value="officially_verified">Officially verified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="provider">
            <Card>
              <CardHeader><CardTitle>E-Invoicing Service Provider Placeholder</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={provider.status} onValueChange={(v) => updateProvider("status", v as ServiceProviderSettings["status"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_connected">Not connected</SelectItem>
                      <SelectItem value="provider_required">Provider required</SelectItem>
                      <SelectItem value="pending_configuration">Pending configuration</SelectItem>
                      <SelectItem value="connected">Connected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Provider name" value={provider.providerName} onChange={(v) => updateProvider("providerName", v)} />
                <div className="space-y-2">
                  <Label>Environment</Label>
                  <Select value={provider.environment} onValueChange={(v) => updateProvider("environment", v as ServiceProviderSettings["environment"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sandbox">Sandbox</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="API endpoint" value={provider.apiEndpoint} onChange={(v) => updateProvider("apiEndpoint", v)} />
                <Field label="Client ID" value={provider.clientId} onChange={(v) => updateProvider("clientId", v)} />
                <div className="space-y-2">
                  <Label>Certificate status</Label>
                  <Select value={provider.certificateStatus} onValueChange={(v) => updateProvider("certificateStatus", v as ServiceProviderSettings["certificateStatus"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_configured">Not configured</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="installed">Installed</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  No API secrets are stored here. Do not send real invoice data to any provider until the Tax Authority/provider specification is confirmed.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="readiness">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Tax Compliance Readiness Checklist</CardTitle>
                <Button variant="outline" onClick={exportReadinessJson} className="gap-2">
                  <Download size={16} /> Export JSON
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3">Requirement</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Current support</th>
                      <th className="text-left p-3">Missing</th>
                      <th className="text-left p-3">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((check) => (
                      <tr key={check.key} className="border-t border-border">
                        <td className="p-3 font-medium">{check.label}</td>
                        <td className="p-3"><Badge className={STATUS_CLASS[check.status]}>{check.status}</Badge></td>
                        <td className="p-3 text-muted-foreground">{check.currentSupport}</td>
                        <td className="p-3 text-muted-foreground">{check.missing}</td>
                        <td className="p-3 text-muted-foreground">{check.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ReadinessCard({ label, value }: { label: string; value: ReadinessStatus }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <Badge className={`mt-2 ${STATUS_CLASS[value]}`}>{value}</Badge>
      </CardContent>
    </Card>
  );
}
