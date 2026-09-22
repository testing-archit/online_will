import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { assetKindLabel, buildNominationAlignment, mapAssetsToBeneficiaries } from '../lib/assetMapping'
import { buildEstateProfile, type EstateProfileItem } from '../lib/estateProfile'
import { buildEstateSummary } from '../lib/estateSummary'
import { formatInr } from '../lib/money'
import { computeLegalFlags, flagCounts } from '../lib/legalRules'
import type { WillData } from '../lib/types'
import { DataTable, FlagCard, PdfCallout, ReportPage, Section, StatCardRow } from './components'
import { registerPdfFonts } from './fonts'
import { pdfColors } from './theme'

registerPdfFonts()

export type EstateReportType = 'client' | 'advisor' | 'lawyer'

const REPORT_TITLE: Record<EstateReportType, string> = {
  client: 'Client Estate Report',
  advisor: 'Advisor Estate Report',
  lawyer: 'Lawyer Brief',
}

const coverStyles = StyleSheet.create({
  page: {
    backgroundColor: pdfColors.primary,
    padding: 48,
    fontFamily: 'Figtree',
  },
  center: { flex: 1, justifyContent: 'center' },
  eyebrow: { fontSize: 8, letterSpacing: 2, color: '#aab0e8', marginBottom: 16 },
  title: { fontFamily: 'Lexend', fontSize: 30, fontWeight: 700, color: pdfColors.white, lineHeight: 1.2 },
  client: { fontFamily: 'Lexend', fontSize: 16, fontWeight: 700, color: pdfColors.secondary, marginTop: 28 },
  meta: { fontSize: 9, color: '#c7cdfa', marginTop: 6 },
  footer: { borderTopWidth: 1, borderTopColor: '#2a3199', paddingTop: 12 },
  footerText: { fontSize: 7.5, color: '#aab0e8' },
})

export function EstateReportDocument({ data, type }: { data: WillData; type: EstateReportType }) {
  const profile = buildEstateProfile(data)
  const planDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Document title={`${REPORT_TITLE[type]} — ${profile.clientName}`}>
      <Page size="A4" style={coverStyles.page}>
        <View style={coverStyles.center}>
          <Text style={coverStyles.eyebrow}>OCTARAA ESTATE PLANNING</Text>
          <Text style={coverStyles.title}>{REPORT_TITLE[type]}</Text>
          <Text style={coverStyles.client}>{profile.clientName}</Text>
          <Text style={coverStyles.meta}>Generated {planDate}</Text>
        </View>
        <View style={coverStyles.footer}>
          <Text style={coverStyles.footerText}>Strictly confidential · Generated from recorded questionnaire data</Text>
        </View>
      </Page>

      {type === 'client' && <ClientReport data={data} planDate={planDate} />}
      {type === 'advisor' && <AdvisorReport data={data} planDate={planDate} />}
      {type === 'lawyer' && <LawyerReport data={data} planDate={planDate} />}
    </Document>
  )
}

function ClientReport({ data, planDate }: { data: WillData; planDate: string }) {
  const profile = buildEstateProfile(data)

  return (
    <>
      <ReportPage clientName={profile.clientName} planDate={planDate}>
        <StatCardRow
          cards={[
            { label: 'ESTATE PREPARATION', value: `${profile.completion.overall}%`, caption: 'Workflow completeness' },
            { label: 'ASSETS RECORDED', value: String(profile.assets.length), caption: `${profile.liabilities.length} liability item(s)` },
            { label: 'OPEN ITEMS', value: String(profile.missingInformation.length), caption: 'To complete or review', variant: profile.missingInformation.length ? 'accent' : 'default' },
          ]}
        />
        <Section title="Estate Overview">
          <ItemTable items={summaryItems(data)} empty="No estate information recorded yet." />
        </Section>
        <Section title="Assets">
          <ItemTable items={profile.assets} empty="No assets recorded yet." />
        </Section>
        <Section title="Family Structure">
          <ItemTable items={profile.familyMembers} empty="No family members recorded yet." />
        </Section>
        <Section title="Intended Distribution">
          <ItemTable items={profile.distributionInstructions} empty="No distribution instructions recorded yet." />
        </Section>
      </ReportPage>
      <ReportPage clientName={profile.clientName} planDate={planDate}>
        <Section title="Missing Information">
          <ItemTable items={profile.missingInformation} empty="No open mandatory items detected." />
        </Section>
        <Section title="Next Steps">
          <PdfCallout tone="info">
            Review the open information, upload supporting documents where requested, then share the Lawyer Brief for legal review before printing and signing.
          </PdfCallout>
        </Section>
      </ReportPage>
    </>
  )
}

function AdvisorReport({ data, planDate }: { data: WillData; planDate: string }) {
  const profile = buildEstateProfile(data)

  return (
    <ReportPage clientName={profile.clientName} planDate={planDate}>
      <StatCardRow
        cards={[
          { label: 'CLIENT', value: profile.clientName, caption: data.personal.state || 'State not captured' },
          { label: 'ESTIMATED VALUE', value: buildEstateSummary(data).estimatedValue === null ? '—' : formatInr(buildEstateSummary(data).estimatedValue ?? 0), caption: `${nonEmptyAssetCategories(data)} categories · ${profile.assets.length} item(s)` },
          { label: 'PLANNING GAPS', value: String(profile.missingInformation.length), variant: profile.missingInformation.length ? 'accent' : 'default' },
        ]}
      />
      <Section title="Client Summary">
        <ItemTable items={summaryItems(data)} empty="No client data recorded." />
      </Section>
      <Section title="Family">
        <ItemTable items={profile.familyMembers} empty="No client/family data recorded." />
      </Section>
      <Section title="Asset Categories">
        <ItemTable items={profile.assets} empty="No assets recorded." />
      </Section>
      <Section title="Beneficiaries">
        <ItemTable items={profile.beneficiaries} empty="No beneficiaries recorded." />
      </Section>
      <Section title="Asset to Beneficiary Mapping">
        <ItemTable items={mappingItems(data)} empty="No assets recorded." />
      </Section>
      <Section title="Planning Gaps">
        <ItemTable items={profile.missingInformation} empty="No gaps detected." />
      </Section>
    </ReportPage>
  )
}

function LawyerReport({ data, planDate }: { data: WillData; planDate: string }) {
  const profile = buildEstateProfile(data)
  const flags = computeLegalFlags(data)
  const counts = flagCounts(flags)

  return (
    <>
      <ReportPage clientName={profile.clientName} planDate={planDate}>
        <StatCardRow
          cards={[
            { label: 'LEGAL REVIEW ITEMS', value: String(counts.critical), caption: `${counts.warning} warning(s)` },
            { label: 'BENEFICIARIES', value: String(profile.beneficiaries.length) },
            { label: 'DOCUMENT REQUESTS', value: String(profile.documents.length) },
          ]}
        />
        <Section title="Client">
          <ItemTable items={profile.familyMembers} empty="No client details recorded." />
        </Section>
        <Section title="Assets, Liabilities, Insurance">
          <ItemTable items={[...profile.assets, ...profile.liabilities, ...profile.insurance]} empty="No estate assets recorded." />
        </Section>
        <Section title="Distribution">
          <ItemTable items={profile.distributionInstructions} empty="No distribution instructions recorded." />
        </Section>
        <Section title="Asset to Beneficiary Mapping">
          <ItemTable items={mappingItems(data)} empty="No assets recorded." />
        </Section>
      </ReportPage>
      <ReportPage clientName={profile.clientName} planDate={planDate}>
        <Section title="Executors & Guardians">
          <ItemTable items={[...profile.executors, ...profile.guardians]} empty="No executors or guardians recorded." />
        </Section>
        <Section title="Nominations vs Intended Beneficiaries">
          <ItemTable items={alignmentItems(data)} empty="No nominations recorded." />
        </Section>
        <Section title="Open Questions">
          <ItemTable items={profile.missingInformation} empty="No open questions detected." />
        </Section>
        <Section title="Potential Inconsistencies / Legal Flags">
          {flags.length ? flags.map((flag) => <FlagCard key={flag.id} severity={flag.severity} title={flag.title} description={flag.description} />) : <PdfCallout tone="info">No flags detected.</PdfCallout>}
        </Section>
      </ReportPage>
    </>
  )
}

function summaryItems(data: WillData): EstateProfileItem[] {
  const summary = buildEstateSummary(data)
  return [
    {
      id: 'value',
      title: 'Estimated estate value',
      subtitle: summary.estimatedValue === null ? 'Not enough values recorded' : formatInr(summary.estimatedValue),
      meta: summary.valueNote,
    },
    { id: 'family', title: 'Family', subtitle: summary.family.join(', ') || 'No family members recorded' },
    { id: 'assets', title: 'Assets', subtitle: summary.assets.join(', ') || 'None recorded' },
    { id: 'primary', title: 'Primary beneficiary', subtitle: summary.primaryBeneficiary },
    { id: 'bequests', title: 'Specific bequests', subtitle: summary.specificBequests.join('; ') || 'None recorded' },
  ]
}

function mappingItems(data: WillData): EstateProfileItem[] {
  return mapAssetsToBeneficiaries(data).map(({ asset, targets }) => ({
    id: asset.id,
    title: asset.title,
    subtitle: assetKindLabel(asset.kind),
    meta: targets.length ? targets.map((target) => `${target.name} (${target.basis})`).join(', ') : 'Recipient not recorded',
  }))
}

function alignmentItems(data: WillData): EstateProfileItem[] {
  return buildNominationAlignment(data).map((row) => ({
    id: row.assetId,
    title: row.assetTitle,
    subtitle: `Nominee: ${row.nominee || 'not recorded'} · Intended: ${row.intendedBeneficiaries.join(', ') || 'not recorded'}`,
    meta: row.status === 'aligned' ? 'Aligned' : row.status === 'mismatch' ? 'DIFFERS — flag for legal review' : row.status.replace(/-/g, ' '),
  }))
}

function ItemTable({ items, empty }: { items: EstateProfileItem[]; empty: string }) {
  if (!items.length) {
    return <PdfCallout tone="info">{empty}</PdfCallout>
  }

  return (
    <DataTable
      columns={[
        { key: 'title', label: 'Item', width: 34 },
        { key: 'subtitle', label: 'Details', width: 33 },
        { key: 'meta', label: 'Notes', width: 33 },
      ]}
      rows={items.map((item) => ({
        title: item.title,
        subtitle: item.subtitle ?? '',
        meta: item.meta ?? '',
      }))}
    />
  )
}

function nonEmptyAssetCategories(data: WillData) {
  return [
    data.assets.immovableAssets.length,
    data.assets.bankAccounts.length,
    data.assets.investments.length,
    data.assets.valuables.length,
    data.insurance.policies.length,
  ].filter((count) => count > 0).length
}
